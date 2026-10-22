package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// City dashboard, traffic section (Phase 2, REQ-079, DD-36, DD-39, DD-41).

type cityDetector struct {
	VDID          string   `json:"vd_id"`
	RoadName      string   `json:"road_name"`
	RoadDirection string   `json:"road_direction"`
	Lat           float64  `json:"lat"`
	Lng           float64  `json:"lng"`
	Volume        int      `json:"volume"`
	AvgSpeedKmh   *float64 `json:"avg_speed_kmh"`
	Simulated     bool     `json:"simulated"` // REQ-063
}

type cityRoad struct {
	RoadName string `json:"road_name"`
	// Volume-weighted over the road's detectors in the slot; null when no vehicle passed.
	AvgSpeedKmh *float64 `json:"avg_speed_kmh"`
	// The same time of day over the past 10 workdays before today (DD-41); null without data.
	PastAvgSpeedKmh *float64 `json:"past_avg_speed_kmh"`
}

// getCityTraffic returns each detector's volume in one slot for the heatmap, and the main roads'
// average speed in that slot next to the same time of day over the past 10 workdays (REQ-079).
// slot (RFC 3339, the slot's start) picks a past slot; without it, the latest slot: the last
// complete 15-minute slot before now (DD-41), 08:00-08:15 in the Demo. A slot without data is
// not found.
func (s *Server) getCityTraffic(c *gin.Context) {
	m, err := commuteNow(c, s.db, s.now())
	if err != nil {
		s.internalError(c, err)
		return
	}
	var slot time.Time
	if raw := c.Query("slot"); raw != "" {
		slot, err = time.Parse(time.RFC3339, raw)
		if err != nil || slot.Sub(slot.Truncate(commuteSlotMinutes*time.Minute)) != 0 {
			apiError(c, http.StatusBadRequest, "invalid_request", "slot 須為 15 分鐘時段的開始時間（RFC 3339，例如 2026-10-23T08:00:00+08:00）")
			return
		}
	} else {
		// The latest complete slot before now that has data: at 08:15 in the Demo, 08:00.
		var latest *time.Time
		if err := s.db.QueryRow(c, `
			SELECT max(slot_start) FROM traffic_observations WHERE slot_start + interval '15 minutes' <= $1`,
			m.Now).Scan(&latest); err != nil {
			s.internalError(c, err)
			return
		}
		if latest == nil {
			apiError(c, http.StatusNotFound, "not_found", "目前沒有車流資料")
			return
		}
		slot = *latest
	}

	detectors, err := s.cityDetectors(c, slot)
	if err != nil {
		s.internalError(c, err)
		return
	}
	if len(detectors) == 0 {
		apiError(c, http.StatusNotFound, "not_found", "這個時段沒有車流資料")
		return
	}
	roads, err := s.cityRoads(c, slot, m)
	if err != nil {
		s.internalError(c, err)
		return
	}
	simulated := false
	for _, d := range detectors {
		simulated = simulated || d.Simulated
	}
	c.JSON(http.StatusOK, withClock(m, gin.H{
		"slot_start": slot.In(taipei),
		"detectors":  detectors,
		"roads":      roads,
		"simulated":  simulated,
	}))
}

func (s *Server) cityDetectors(c *gin.Context, slot time.Time) ([]cityDetector, error) {
	rows, err := s.db.Query(c, `
		SELECT d.vd_id, d.road_name, d.road_direction, d.lat, d.lng, o.volume, o.avg_speed_kmh::float8, o.simulated
		  FROM traffic_observations o JOIN traffic_detectors d ON d.vd_id = o.vd_id
		 WHERE o.slot_start = $1
		 ORDER BY d.vd_id`, slot)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cityDetector{}
	for rows.Next() {
		var d cityDetector
		if err := rows.Scan(&d.VDID, &d.RoadName, &d.RoadDirection, &d.Lat, &d.Lng, &d.Volume, &d.AvgSpeedKmh, &d.Simulated); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// cityRoads is each road's speed in slot and at the same time of day over the past 10 workdays
// before today (DD-41), both weighted by volume.
func (s *Server) cityRoads(c *gin.Context, slot time.Time, m commuteMoment) ([]cityRoad, error) {
	rows, err := s.db.Query(c, `
		WITH speeds AS (
		    SELECT d.road_name,
		           o.slot_start = $1 AS current,
		           o.slot_start <> $1 AND (o.slot_start AT TIME ZONE 'Asia/Taipei')::date IN
		               (SELECT commute_past_workdays($2::date, $3)) AS past,
		           o.volume, o.avg_speed_kmh
		      FROM traffic_observations o JOIN traffic_detectors d ON d.vd_id = o.vd_id
		     WHERE (o.slot_start AT TIME ZONE 'Asia/Taipei')::time = ($1::timestamptz AT TIME ZONE 'Asia/Taipei')::time)
		SELECT road_name,
		       (sum(volume * avg_speed_kmh) FILTER (WHERE current)
		          / NULLIF(sum(volume) FILTER (WHERE current), 0))::float8,
		       (sum(volume * avg_speed_kmh) FILTER (WHERE past)
		          / NULLIF(sum(volume) FILTER (WHERE past), 0))::float8
		  FROM speeds
		 GROUP BY road_name
		HAVING bool_or(current)
		 ORDER BY road_name`, slot, m.Today.Format(dateLayout), commutePastWorkdays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cityRoad{}
	for rows.Next() {
		var r cityRoad
		if err := rows.Scan(&r.RoadName, &r.AvgSpeedKmh, &r.PastAvgSpeedKmh); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
