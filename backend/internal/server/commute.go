package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Commute info for drivers and passengers (Phase 2, REQ-076, REQ-077, DD-36, DD-38).

const commutePastWorkdays = 10

const dateLayout = "2006-01-02"

type trafficSlot struct {
	SlotStart   time.Time       `json:"slot_start"`
	Volume      int64           `json:"volume"`        // the 16 gateways' vehicles in the slot
	AvgSpeedKmh *float64        `json:"avg_speed_kmh"` // volume-weighted; null when no vehicle passed
	Weather     json.RawMessage `json:"weather"`       // one copy per slot (DD-36)
	// Traffic and weather are marked apart: measured traffic still has simulated weather (DD-36).
	Simulated        bool `json:"simulated"`
	WeatherSimulated bool `json:"weather_simulated"`
}

type trafficDay struct {
	Date    string        `json:"date"`
	Weekday int           `json:"weekday"` // ISO: 1 Monday .. 5 Friday
	Slots   []trafficSlot `json:"slots"`
}

// getCommuteTraffic returns the past 10 workdays before today (DD-41), newest first, each with
// every commute slot's total volume over the 16 gateways, average speed and weather (REQ-077).
// simulated and weather_simulated at the top are true when any slot's are.
func (s *Server) getCommuteTraffic(c *gin.Context) {
	m, err := commuteNow(c, s.db, s.now())
	if err != nil {
		s.internalError(c, err)
		return
	}
	rows, err := s.db.Query(c, `
		SELECT d.day, extract(isodow FROM d.day)::int, o.slot_start, o.volume, o.avg_speed, o.weather, o.simulated,
		       o.weather_simulated
		  FROM commute_past_workdays($1::date, $2) d (day)
		  LEFT JOIN LATERAL (
		        SELECT slot_start, sum(volume) AS volume,
		               (sum(volume * avg_speed_kmh) / NULLIF(sum(volume), 0))::float8 AS avg_speed,
		               (array_agg(weather ORDER BY vd_id))[1] AS weather, bool_or(simulated) AS simulated,
		               bool_or(weather_simulated) AS weather_simulated
		          FROM traffic_observations
		         WHERE slot_start >= (d.day::timestamp AT TIME ZONE 'Asia/Taipei')
		           AND slot_start < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Taipei')
		         GROUP BY slot_start) o ON true
		 ORDER BY d.day DESC, o.slot_start`, m.Today.Format(dateLayout), commutePastWorkdays)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	days := []trafficDay{}
	simulated, weatherSimulated := false, false
	for rows.Next() {
		var day time.Time
		var weekday int
		var slotStart *time.Time
		var volume *int64
		var speed *float64
		var weather []byte
		var sim, weatherSim *bool
		if err := rows.Scan(&day, &weekday, &slotStart, &volume, &speed, &weather, &sim, &weatherSim); err != nil {
			s.internalError(c, err)
			return
		}
		date := day.Format(dateLayout)
		if len(days) == 0 || days[len(days)-1].Date != date {
			days = append(days, trafficDay{Date: date, Weekday: weekday, Slots: []trafficSlot{}})
		}
		if slotStart == nil { // a workday without data
			continue
		}
		last := &days[len(days)-1]
		last.Slots = append(last.Slots, trafficSlot{
			SlotStart: slotStart.In(taipei), Volume: *volume, AvgSpeedKmh: speed, Weather: nullIfEmpty(weather),
			Simulated: *sim, WeatherSimulated: *weatherSim,
		})
		simulated = simulated || *sim
		weatherSimulated = weatherSimulated || *weatherSim
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"now":               m.Now,
		"today":             m.Today.Format(dateLayout),
		"days":              days,
		"simulated":         simulated, // REQ-063
		"weather_simulated": weatherSimulated,
	})
}

// getCommuteWeather returns today's latest weather observed at or before now (REQ-077, DD-41),
// with now and today's date, so the UI takes "now" from here instead of the device clock.
// weather is null when today has no observation yet. weather_simulated says whether the weather
// is simulated; this API has no traffic, so it has no traffic flag (DD-36).
func (s *Server) getCommuteWeather(c *gin.Context) {
	m, err := commuteNow(c, s.db, s.now())
	if err != nil {
		s.internalError(c, err)
		return
	}
	var weather []byte
	var weatherSimulated bool
	err = s.db.QueryRow(c, `
		SELECT weather, weather_simulated FROM traffic_observations
		 WHERE weather IS NOT NULL AND slot_start >= ($1::date::timestamp AT TIME ZONE 'Asia/Taipei')
		   AND (weather->>'obs_time')::timestamptz <= $2
		 ORDER BY (weather->>'obs_time')::timestamptz DESC, vd_id
		 LIMIT 1`, m.Today.Format(dateLayout), m.Now).Scan(&weather, &weatherSimulated)
	if err != nil && !isNoRows(err) {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"now":               m.Now,
		"today":             m.Today.Format(dateLayout),
		"weather":           json.RawMessage(nullIfEmpty(weather)),
		"weather_simulated": weatherSimulated, // REQ-063
	})
}

func nullIfEmpty(b []byte) []byte {
	if len(b) == 0 {
		return []byte("null")
	}
	return b
}
