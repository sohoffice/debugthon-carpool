package server

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// City dashboard, live section (Phase 2, REQ-078, REQ-081, DD-39, DD-40 step 5). Every /api/city/*
// response carries the commute now, today and whether demo_clock is set, since a city token cannot
// call /api/commute/weather (DD-39, DD-41). No account, name or plate leaves these handlers.

// cityClock is the top bar's time (DD-41): the UI does not compute now itself.
func cityClock(m commuteMoment) gin.H {
	return gin.H{"now": m.Now, "today": m.Today.Format(dateLayout), "demo_clock": m.DemoClock}
}

// withClock adds the clock fields to a response body.
func withClock(m commuteMoment, body gin.H) gin.H {
	for k, v := range cityClock(m) {
		body[k] = v
	}
	return body
}

type cityPlace struct {
	ID   int64   `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

// cityPickupPoints lists the pickup points in id order; the dashboard has no other source (DD-39).
func (s *Server) cityPickupPoints(ctx context.Context) ([]cityPlace, error) {
	rows, err := s.db.Query(ctx, `SELECT id, name, lat, lng FROM pickup_points ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []cityPlace
	for rows.Next() {
		var p cityPlace
		if err := rows.Scan(&p.ID, &p.Name, &p.Lat, &p.Lng); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type liveVehicle struct {
	Lat        float64  `json:"lat"`
	Lng        float64  `json:"lng"`
	HeadingDeg *float64 `json:"heading_deg"` // null until a real car has reported two positions
	OnBoard    int      `json:"on_board"`
	Simulated  bool     `json:"simulated"` // REQ-063
}

type liveCounts struct {
	Vehicles int `json:"vehicles"` // cars on a trip
	OnBoard  int `json:"on_board"` // passengers in a car
	Waiting  int `json:"waiting"`  // passengers waiting to be matched
	Matched  int `json:"matched"`  // matched, not on board yet
}

func (a liveCounts) plus(b liveCounts) liveCounts {
	return liveCounts{a.Vehicles + b.Vehicles, a.OnBoard + b.OnBoard, a.Waiting + b.Waiting, a.Matched + b.Matched}
}

type livePickup struct {
	cityPlace
	Waiting          int `json:"waiting"`           // real and simulated
	SimulatedWaiting int `json:"simulated_waiting"` // the simulated part (REQ-063)
}

// getCityLive returns the cars on a trip and the passengers waiting, matched and on board right
// now (REQ-078): today's real trips and requests merged with the live simulation round, which the
// first query after a Demo reset starts (DD-40 step 5).
func (s *Server) getCityLive(c *gin.Context) {
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
	vehicles, real, err := s.realLiveVehicles(c)
	if err != nil {
		s.internalError(c, err)
		return
	}
	reqCounts, waitingAt, err := s.realLiveRequests(c, realNow)
	if err != nil {
		s.internalError(c, err)
		return
	}
	real = real.plus(reqCounts)

	sim := s.liveSim(m, realNow)
	simCounts := liveCounts{Vehicles: len(sim.Cars)}
	for _, car := range sim.Cars {
		h := car.HeadingDeg
		vehicles = append(vehicles, liveVehicle{Lat: car.Pos.Lat, Lng: car.Pos.Lng, HeadingDeg: &h, OnBoard: car.OnBoard, Simulated: true})
	}
	pickups := make([]livePickup, 0, len(points))
	for _, p := range points {
		sp := sim.Pickups[p.Name]
		simCounts = simCounts.plus(liveCounts{OnBoard: sp.OnBoard, Waiting: sp.Waiting, Matched: sp.Matched})
		pickups = append(pickups, livePickup{cityPlace: p, Waiting: waitingAt[p.ID] + sp.Waiting, SimulatedWaiting: sp.Waiting})
	}
	warnUnknownPickups(sim.Pickups, points)

	c.JSON(http.StatusOK, withClock(m, gin.H{
		"vehicles":         vehicles,
		"counts":           real.plus(simCounts),
		"simulated_counts": simCounts, // REQ-063
		"pickup_points":    pickups,
		"simulated":        len(sim.Cars) > 0 || simCounts != (liveCounts{}),
	}))
}

// realLiveVehicles is every active trip's car at its latest driver report, without the trip,
// driver or vehicle (REQ-081). A trip not heard from yet counts but has no position.
func (s *Server) realLiveVehicles(ctx context.Context) ([]liveVehicle, liveCounts, error) {
	rows, err := s.db.Query(ctx, `
		SELECT t.id, r.lat, r.lng, p.lat, p.lng,
		       (SELECT count(*) FROM ride_requests q WHERE q.trip_id = t.id AND q.status = 'boarded')
		  FROM trips t
		  LEFT JOIN LATERAL (
		        SELECT lr.id, lr.lat, lr.lng FROM location_reports lr JOIN activities a ON a.id = lr.activity_id
		         WHERE a.trip_id = t.id AND a.role = 'driver' ORDER BY lr.id DESC LIMIT 1) r ON true
		  LEFT JOIN LATERAL (
		        SELECT lr.lat, lr.lng FROM location_reports lr JOIN activities a ON a.id = lr.activity_id
		         WHERE a.trip_id = t.id AND a.role = 'driver' AND lr.id < r.id AND (lr.lat, lr.lng) <> (r.lat, r.lng)
		         ORDER BY lr.id DESC LIMIT 1) p ON true
		 WHERE t.status = 'active'
		 ORDER BY t.id`)
	if err != nil {
		return nil, liveCounts{}, err
	}
	defer rows.Close()
	vehicles := []liveVehicle{}
	var n int
	for rows.Next() {
		var id int64
		var lat, lng, prevLat, prevLng *float64
		var onBoard int
		if err := rows.Scan(&id, &lat, &lng, &prevLat, &prevLng, &onBoard); err != nil {
			return nil, liveCounts{}, err
		}
		n++
		if lat == nil {
			continue
		}
		v := liveVehicle{Lat: *lat, Lng: *lng, OnBoard: onBoard}
		if prevLat != nil {
			h := bearingDeg(latLng{*prevLat, *prevLng}, latLng{*lat, *lng}) // DD-31
			v.HeadingDeg = &h
		}
		vehicles = append(vehicles, v)
	}
	return vehicles, liveCounts{Vehicles: n}, rows.Err()
}

// realLiveRequests counts today's open requests (the real Taipei date, as commute_real_rides):
// sent and not matched yet (waiting for a driver's answer), confirmed, and boarded (REQ-078).
// Requests on a trip that has ended are left out.
func (s *Server) realLiveRequests(ctx context.Context, realNow time.Time) (liveCounts, map[int64]int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT q.pickup_point_id,
		       count(*) FILTER (WHERE q.status IN ('submitted', 'waiting_driver')),
		       count(*) FILTER (WHERE q.status = 'confirmed'),
		       count(*) FILTER (WHERE q.status = 'boarded')
		  FROM ride_requests q LEFT JOIN trips t ON t.id = q.trip_id
		 WHERE q.status IN ('submitted', 'waiting_driver', 'confirmed', 'boarded')
		   AND (q.created_at AT TIME ZONE 'Asia/Taipei')::date = ($1::timestamptz AT TIME ZONE 'Asia/Taipei')::date
		   AND (t.id IS NULL OR t.status = 'active')
		 GROUP BY q.pickup_point_id`, realNow)
	if err != nil {
		return liveCounts{}, nil, err
	}
	defer rows.Close()
	var total liveCounts
	waitingAt := map[int64]int{}
	for rows.Next() {
		var id int64
		var waiting, matched, onBoard int
		if err := rows.Scan(&id, &waiting, &matched, &onBoard); err != nil {
			return liveCounts{}, nil, err
		}
		total = total.plus(liveCounts{OnBoard: onBoard, Waiting: waiting, Matched: matched})
		waitingAt[id] = waiting
	}
	return total, waitingAt, rows.Err()
}

// warnUnknownPickups logs a simulation route whose pickup point is not in pickup_points; its
// passengers would be left out of the per-pickup counts.
func warnUnknownPickups[T any](byName map[string]T, points []cityPlace) {
	known := map[string]bool{}
	for _, p := range points {
		known[p.Name] = true
	}
	for name := range byName {
		if !known[name] {
			log.Printf("city live simulation: pickup point %q is not in pickup_points", name)
		}
	}
}
