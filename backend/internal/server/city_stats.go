package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// City dashboard, today and history sections (Phase 2, REQ-080, REQ-082, REQ-083, DD-37, DD-40).

type todayCounts struct {
	Requests  int  `json:"requests"`  // requests sent
	Matched   int  `json:"matched"`   // of them, matched
	NoMatch   int  `json:"no_match"`  // no car to match
	Completed int  `json:"completed"` // rides completed
	Simulated bool `json:"simulated"` // the counts hold simulated data (REQ-063)
}

func (a todayCounts) plus(b todayCounts) todayCounts {
	return todayCounts{a.Requests + b.Requests, a.Matched + b.Matched, a.NoMatch + b.NoMatch, a.Completed + b.Completed,
		a.Simulated || b.Simulated}
}

type todayPickup struct {
	cityPlace
	Completed int `json:"completed"`
}

// getCityToday returns today's results (REQ-080): rides completed, the share of requests matched,
// the times no car could be matched and the car trips saved (an estimate: one car fewer into the
// park per ride, G1), with each pickup point's rides. Today is the simulated statistics before now,
// plus today's real requests and rides, plus the live simulation's passengers who have arrived
// (DD-40 steps 4 and 5).
func (s *Server) getCityToday(c *gin.Context) {
	realNow := s.now()
	m, err := commuteNow(c, s.db, realNow)
	if err != nil {
		s.internalError(c, err)
		return
	}
	points, err := s.cityPickupPoints(c)
	if err != nil {
		s.internalError(c, err)
		return
	}
	byPickup, err := s.todayByPickup(c, m, realNow)
	if err != nil {
		s.internalError(c, err)
		return
	}
	arrived := s.liveSimArrived(m, realNow)
	warnUnknownPickups(arrived, points)

	var total todayCounts
	pickups := make([]todayPickup, 0, len(points))
	for _, p := range points {
		t := byPickup[p.ID]
		// A simulated passenger who arrived is one request sent and matched, and one ride (DD-40 step 5).
		if n := arrived[p.Name]; n > 0 {
			t = t.plus(todayCounts{Requests: n, Matched: n, Completed: n, Simulated: true})
		}
		total = total.plus(t)
		pickups = append(pickups, todayPickup{cityPlace: p, Completed: t.Completed})
	}
	var rate *float64
	if total.Requests > 0 {
		r := float64(total.Matched) / float64(total.Requests)
		rate = &r
	}
	c.JSON(http.StatusOK, withClock(m, gin.H{
		"completed":            total.Completed,
		"requests":             total.Requests,
		"matched":              total.Matched,
		"match_rate":           rate, // matched / requests; null without requests
		"no_match":             total.NoMatch,
		"trips_saved":          total.Completed,
		"trips_saved_estimate": true, // REQ-063: an estimate, labelled as such
		"pickup_points":        pickups,
		"simulated":            total.Simulated,
	}))
}

// todayByPickup is today's simulated statistics and real requests and rides per pickup point.
// The simulated part counts every match as a ride (no car = passengers - rides, DD-40). The real
// part follows the request status: no car is no_match, matched is confirmed, boarded or completed,
// and an open request is neither. Requests rejected at submission (too far from the pickup point,
// REQ-034) never entered matching, so they are not requests sent at the pickup point. Rides come
// from commute_real_rides, the rule pickup-rides uses too (REQ-083), slots outside the window
// included: they count for the day's total.
func (s *Server) todayByPickup(ctx context.Context, m commuteMoment, realNow time.Time) (map[int64]todayCounts, error) {
	rows, err := s.db.Query(ctx, `
		WITH sim AS (
		    SELECT pickup_point_id, sum(passenger_count) AS passengers, sum(ride_count) AS rides, bool_or(simulated) AS simulated
		      FROM supply_demand_stats
		     WHERE slot_start >= ($1::date::timestamp AT TIME ZONE 'Asia/Taipei')
		       AND slot_start < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Taipei')
		       AND slot_start <= $3
		     GROUP BY pickup_point_id),
		real_requests AS (
		    SELECT pickup_point_id,
		           count(*) FILTER (WHERE status <> 'rejected') AS sent,
		           count(*) FILTER (WHERE status IN ('confirmed', 'boarded', 'completed')) AS matched,
		           count(*) FILTER (WHERE status = 'no_match') AS no_match
		      FROM ride_requests
		     WHERE (created_at AT TIME ZONE 'Asia/Taipei')::date = ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::date
		     GROUP BY pickup_point_id),
		real_rides AS (
		    SELECT pickup_point_id, sum(rides) AS rides FROM commute_real_rides($2) GROUP BY pickup_point_id)
		SELECT p.id,
		       COALESCE(sim.passengers, 0) + COALESCE(q.sent, 0),
		       COALESCE(sim.rides, 0) + COALESCE(q.matched, 0),
		       COALESCE(sim.passengers - sim.rides, 0) + COALESCE(q.no_match, 0),
		       COALESCE(sim.rides, 0) + COALESCE(r.rides, 0),
		       COALESCE(sim.simulated, false)
		  FROM pickup_points p
		  LEFT JOIN sim ON sim.pickup_point_id = p.id
		  LEFT JOIN real_requests q ON q.pickup_point_id = p.id
		  LEFT JOIN real_rides r ON r.pickup_point_id = p.id`, m.Today.Format(dateLayout), realNow, m.Now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]todayCounts{}
	for rows.Next() {
		var id int64
		var t todayCounts
		if err := rows.Scan(&id, &t.Requests, &t.Matched, &t.NoMatch, &t.Completed, &t.Simulated); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

type historyDay struct {
	Date    string `json:"date"`
	Weekday int    `json:"weekday"` // ISO: 1 Monday .. 5 Friday
	Rides   int    `json:"rides"`   // the pickup points' rides added up (REQ-083)
	// The day's weather: the slot with the most rain, as on the commute heatmaps (DD-38), from the
	// traffic table (DD-36); null for a day without observations.
	Weather   json.RawMessage `json:"weather"`
	Simulated bool            `json:"simulated"`
}

type historyPickup struct {
	cityPlace
	// Per day over the past 10 workdays: the 10 days' sum over 10, to one decimal (REQ-080).
	DriversPerDay    float64 `json:"drivers_per_day"`
	PassengersPerDay float64 `json:"passengers_per_day"`
	RidesPerDay      float64 `json:"rides_per_day"`
}

// getCityHistory returns the past 10 workdays before today (DD-41), newest first, each with its
// rides, weekday and weather (REQ-082), and each pickup point's drivers, passengers and rides per
// day over those days (REQ-080). The days are the ones /api/commute/traffic shows.
func (s *Server) getCityHistory(c *gin.Context) {
	m, err := commuteNow(c, s.db, s.now())
	if err != nil {
		s.internalError(c, err)
		return
	}
	days, err := s.historyDays(c, m)
	if err != nil {
		s.internalError(c, err)
		return
	}
	pickups, err := s.historyPickups(c, m)
	if err != nil {
		s.internalError(c, err)
		return
	}
	simulated := false
	for _, d := range days {
		simulated = simulated || d.Simulated
	}
	c.JSON(http.StatusOK, withClock(m, gin.H{
		"days":          days,
		"pickup_points": pickups,
		"simulated":     simulated, // REQ-063
	}))
}

func (s *Server) historyDays(ctx context.Context, m commuteMoment) ([]historyDay, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.day, extract(isodow FROM d.day)::int, COALESCE(st.rides, 0), w.weather, COALESCE(st.simulated, false)
		  FROM commute_past_workdays($1::date, $2) d (day)
		  LEFT JOIN LATERAL (
		        SELECT sum(ride_count)::int AS rides, bool_or(simulated) AS simulated FROM supply_demand_stats
		         WHERE slot_start >= (d.day::timestamp AT TIME ZONE 'Asia/Taipei')
		           AND slot_start < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Taipei')) st ON true
		  LEFT JOIN LATERAL (
		        SELECT o.weather FROM traffic_observations o
		         WHERE o.slot_start >= (d.day::timestamp AT TIME ZONE 'Asia/Taipei')
		           AND o.slot_start < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Taipei')
		         ORDER BY (o.weather->>'precipitation')::numeric DESC, o.slot_start, o.vd_id
		         LIMIT 1) w ON true
		 ORDER BY d.day DESC`, m.Today.Format(dateLayout), commutePastWorkdays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []historyDay{}
	for rows.Next() {
		var day time.Time
		var d historyDay
		var weather []byte
		if err := rows.Scan(&day, &d.Weekday, &d.Rides, &weather, &d.Simulated); err != nil {
			return nil, err
		}
		d.Date = day.Format(dateLayout)
		d.Weather = nullIfEmpty(weather)
		days = append(days, d)
	}
	return days, rows.Err()
}

func (s *Server) historyPickups(ctx context.Context, m commuteMoment) ([]historyPickup, error) {
	rows, err := s.db.Query(ctx, `
		SELECT p.id, p.name, p.lat, p.lng,
		       round(COALESCE(sum(st.driver_count), 0)::numeric / $2, 1)::float8,
		       round(COALESCE(sum(st.passenger_count), 0)::numeric / $2, 1)::float8,
		       round(COALESCE(sum(st.ride_count), 0)::numeric / $2, 1)::float8
		  FROM pickup_points p
		  LEFT JOIN supply_demand_stats st
		         ON st.pickup_point_id = p.id
		        AND (st.slot_start AT TIME ZONE 'Asia/Taipei')::date IN (SELECT commute_past_workdays($1::date, $2))
		 GROUP BY p.id
		 ORDER BY p.id`, m.Today.Format(dateLayout), commutePastWorkdays)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []historyPickup{}
	for rows.Next() {
		var p historyPickup
		if err := rows.Scan(&p.ID, &p.Name, &p.Lat, &p.Lng, &p.DriversPerDay, &p.PassengersPerDay, &p.RidesPerDay); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
