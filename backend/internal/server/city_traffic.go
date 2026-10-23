package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// City dashboard, traffic section (Phase 2, REQ-079, DD-36, DD-39, DD-41, DD-44).

// cityGateway is one of the 16 gateways into Neihu in one slot, with the detector standing for it.
// The slot's values are null when the gateway has no row in that slot.
type cityGateway struct {
	VDID          string `json:"vd_id"`
	Source        string `json:"source"` // city or freeway
	Gateway       string `json:"gateway"`
	RoadName      string `json:"road_name"`
	RoadDirection string `json:"road_direction"`
	Bearing       string `json:"bearing"` // direction into Neihu, e.g. NE; drawn from lat/lng when shape is null
	// Place and number on screen, UD-28's grid order; gateways come in this order.
	SortOrder    int             `json:"sort_order"`
	LocationNote string          `json:"location_note"`
	Lat          float64         `json:"lat"`
	Lng          float64         `json:"lng"`
	Shape        json.RawMessage `json:"shape"` // [{lat, lng}, ...] in the direction of travel, or null
	Proxy        bool            `json:"proxy"`
	ProxyNote    *string         `json:"proxy_note"` // where a proxy detector really is
	// All-day p85 speed, the base of the congestion levels (DD-44).
	ReferenceSpeedKmh float64  `json:"reference_speed_kmh"`
	Volume            *int     `json:"volume"`
	AvgSpeedKmh       *float64 `json:"avg_speed_kmh"`
	OccupancyPct      *float64 `json:"occupancy_pct"`
	CoveragePct       *float64 `json:"coverage_pct"` // lane-minutes received out of those expected
	// Mean speed at the same time of day over the past 10 workdays before today (DD-41), the slot's
	// own day left out (4.20); null without data.
	PastAvgSpeedKmh *float64 `json:"past_avg_speed_kmh"`
	PastMinSpeedKmh *float64 `json:"past_min_speed_kmh"` // the same days' slowest and fastest
	PastMaxSpeedKmh *float64 `json:"past_max_speed_kmh"`
	Simulated       bool     `json:"simulated"` // REQ-063; false without data
}

type citySlot struct {
	SlotStart time.Time       `json:"slot_start"`
	Gateways  []cityGateway   `json:"detectors"`
	Weather   json.RawMessage `json:"weather"` // one copy per slot (DD-36); null without data
	// Traffic and weather are marked apart: a measured slot still has simulated weather (DD-36).
	Simulated        bool `json:"simulated"`
	WeatherSimulated bool `json:"weather_simulated"`
}

// cityClockFields are cityClock's fields as a struct, so a response can embed them.
type cityClockFields struct {
	Now       time.Time `json:"now"`
	Today     string    `json:"today"`
	DemoClock bool      `json:"demo_clock"`
}

func clockFields(m commuteMoment) cityClockFields {
	return cityClockFields{Now: m.Now, Today: m.Today.Format(dateLayout), DemoClock: m.DemoClock}
}

// citySlotResponse is one slot with the clock: the same slot shape as each of ?date='s slots.
type citySlotResponse struct {
	cityClockFields
	citySlot
}

// getCityTraffic returns the 16 gateways' traffic in one slot, or in every commute slot of one day,
// each next to the same time of day over the past 10 workdays (REQ-079).
//   - no parameter: the latest slot, the last complete 15-minute slot before now (DD-41), 08:00-08:15
//     in the Demo;
//   - slot (RFC 3339, the slot's start): that slot;
//   - date (YYYY-MM-DD): that day's 12 slots 07:00-09:45 (DD-39); today's slots after the latest
//     slot have no traffic or weather yet, only the past speeds (4.18).
//
// Only today and the past 10 workdays can be asked for; a slot or day without data is not found.
func (s *Server) getCityTraffic(c *gin.Context) {
	m, err := commuteNow(c, s.db, s.now())
	if err != nil {
		s.internalError(c, err)
		return
	}
	rawSlot, rawDate := c.Query("slot"), c.Query("date")
	if rawSlot != "" && rawDate != "" {
		apiError(c, http.StatusBadRequest, "invalid_request", "slot 與 date 只能擇一")
		return
	}
	if rawDate != "" {
		s.cityTrafficDay(c, m, rawDate)
		return
	}

	var slot time.Time
	if rawSlot != "" {
		slot, err = time.Parse(time.RFC3339, rawSlot)
		if err != nil || slot.Sub(slot.Truncate(commuteSlotMinutes*time.Minute)) != 0 {
			apiError(c, http.StatusBadRequest, "invalid_request", "slot 須為 15 分鐘時段的開始時間（RFC 3339，例如 2026-10-23T08:00:00+08:00）")
			return
		}
		// A slot not over yet has no data, even on a measured day that is today (DD-41); nor has one
		// outside the commute window, which today's day query would otherwise fill with nulls.
		at := slot.In(taipei).Hour()*60 + slot.In(taipei).Minute()
		if slot.Add(commuteSlotMinutes*time.Minute).After(m.Now) || at < commuteWindowStart || at >= commuteWindowEnd {
			apiError(c, http.StatusNotFound, "not_found", "這個時段沒有車流資料")
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

	slots, err := s.citySlots(c, m, slot, slot)
	if err != nil {
		s.internalError(c, err)
		return
	}
	if len(slots) == 0 {
		apiError(c, http.StatusNotFound, "not_found", "這個時段沒有車流資料")
		return
	}
	c.JSON(http.StatusOK, citySlotResponse{cityClockFields: clockFields(m), citySlot: slots[0]})
}

// cityTrafficDay answers ?date=: the day's commute slots, for the gateway × slot grid (DD-39).
func (s *Server) cityTrafficDay(c *gin.Context, m commuteMoment, raw string) {
	day, err := time.ParseInLocation(dateLayout, raw, taipei)
	if err != nil || day.Format(dateLayout) != raw {
		apiError(c, http.StatusBadRequest, "invalid_request", "date 須為日期（YYYY-MM-DD，例如 2026-10-22）")
		return
	}
	first := day.Add(commuteWindowStart * time.Minute)
	last := day.Add((commuteWindowEnd - commuteSlotMinutes) * time.Minute)
	slots, err := s.citySlots(c, m, first, last)
	if err != nil {
		s.internalError(c, err)
		return
	}
	if len(slots) == 0 {
		apiError(c, http.StatusNotFound, "not_found", "這一天沒有車流資料")
		return
	}
	simulated, weatherSimulated := false, false
	for _, sl := range slots {
		simulated = simulated || sl.Simulated
		weatherSimulated = weatherSimulated || sl.WeatherSimulated
	}
	c.JSON(http.StatusOK, withClock(m, gin.H{
		"date":              raw,
		"slots":             slots,
		"simulated":         simulated,
		"weather_simulated": weatherSimulated,
	}))
}

// citySlots lists the slots from first through last (one day) with every gateway in each. It is
// empty when the day is not today and either is not one of the past 10 workdays or has no data; a
// slot is kept even without rows, its gateways' values null. A slot not over by now (DD-41) has
// no traffic or weather even if rows exist, only the past speeds: today's 還沒到 (4.18).
func (s *Server) citySlots(ctx context.Context, m commuteMoment, first, last time.Time) ([]citySlot, error) {
	rows, err := s.db.Query(ctx, `
		WITH day AS (
		    SELECT ($1::timestamptz AT TIME ZONE 'Asia/Taipei')::date AS day),
		base AS (
		    SELECT d FROM commute_past_workdays($3::date, $4) d),
		g AS (
		    SELECT s AS slot_start FROM generate_series($1::timestamptz, $2::timestamptz, interval '15 minutes') s),
		-- The past 10 workdays' mean, lowest and highest speed per gateway and time of day, the asked
		-- day left out (4.20).
		past AS (
		    SELECT h.vd_id, (h.slot_start AT TIME ZONE 'Asia/Taipei')::time AS at, round(avg(h.avg_speed_kmh), 1)::float8 AS speed,
		           min(h.avg_speed_kmh)::float8 AS low, max(h.avg_speed_kmh)::float8 AS high
		      FROM traffic_observations h, day
		     WHERE (h.slot_start AT TIME ZONE 'Asia/Taipei')::date IN (SELECT d FROM base)
		       AND (h.slot_start AT TIME ZONE 'Asia/Taipei')::date <> day.day
		     GROUP BY 1, 2)
		SELECT g.slot_start, d.vd_id, d.source, d.gateway, d.road_name, d.road_direction, d.bearing, d.sort_order, d.location_note, d.lat, d.lng,
		       d.shape, d.proxy, d.proxy_note, d.reference_speed_kmh::float8,
		       o.volume, o.avg_speed_kmh::float8, o.occupancy_pct::float8, o.coverage_pct::float8,
		       p.speed, p.low, p.high, COALESCE(o.simulated, false), o.weather, COALESCE(o.weather_simulated, false)
		  FROM day, g CROSS JOIN traffic_detectors d
		  LEFT JOIN traffic_observations o ON o.vd_id = d.vd_id AND o.slot_start = g.slot_start
		       AND o.slot_start + interval '15 minutes' <= $5
		  LEFT JOIN past p ON p.vd_id = d.vd_id AND p.at = (g.slot_start AT TIME ZONE 'Asia/Taipei')::time
		 WHERE day.day = $3::date
		    OR (day.day IN (SELECT d FROM base)
		        AND EXISTS (SELECT 1 FROM traffic_observations x WHERE x.slot_start BETWEEN $1 AND $2))
		 ORDER BY g.slot_start, d.sort_order`,
		first, last, m.Today.Format(dateLayout), commutePastWorkdays, m.Now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []citySlot{}
	for rows.Next() {
		var slotStart time.Time
		var g cityGateway
		var shape, weather []byte
		var simulated, weatherSimulated bool
		if err := rows.Scan(&slotStart, &g.VDID, &g.Source, &g.Gateway, &g.RoadName, &g.RoadDirection, &g.Bearing,
			&g.SortOrder, &g.LocationNote, &g.Lat, &g.Lng, &shape, &g.Proxy, &g.ProxyNote, &g.ReferenceSpeedKmh,
			&g.Volume, &g.AvgSpeedKmh, &g.OccupancyPct, &g.CoveragePct,
			&g.PastAvgSpeedKmh, &g.PastMinSpeedKmh, &g.PastMaxSpeedKmh, &simulated, &weather, &weatherSimulated); err != nil {
			return nil, err
		}
		g.Shape = nullIfEmpty(shape)
		g.Simulated = simulated
		if len(out) == 0 || !out[len(out)-1].SlotStart.Equal(slotStart) {
			out = append(out, citySlot{SlotStart: slotStart.In(taipei), Gateways: []cityGateway{}, Weather: nullIfEmpty(nil)})
		}
		sl := &out[len(out)-1]
		sl.Gateways = append(sl.Gateways, g)
		sl.Simulated = sl.Simulated || simulated
		sl.WeatherSimulated = sl.WeatherSimulated || weatherSimulated
		if len(weather) > 0 && string(sl.Weather) == "null" {
			sl.Weather = weather
		}
	}
	return out, rows.Err()
}
