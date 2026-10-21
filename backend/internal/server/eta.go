package server

import (
	"context"
	"time"
)

// etaView is the driving time from a car's current position to its pickup point.
type etaView struct {
	DurationS int
	Simulated bool
}

// vehicleETA estimates how long the trip's car needs to reach its pickup point, from the
// latest position the driver reported (DD-06). It is nil when there is nothing to estimate:
// the trip is not active, the car has not been heard from yet, or it has already passed the
// pickup, after which it is no longer tracked. Passenger reports on the same trip are ignored.
func (s *Server) vehicleETA(ctx context.Context, tripID int64) (*etaView, error) {
	return s.vehicleETAWithin(ctx, ctx, tripID)
}

// vehicleETAWithin is vehicleETA with a separate context for the estimate: a time budget (DD-09)
// must bound only the estimate, never the database reads, which use ctx.
func (s *Server) vehicleETAWithin(ctx, estCtx context.Context, tripID int64) (*etaView, error) {
	var status string
	var passed bool
	var pickup, car latLng
	err := s.db.QueryRow(ctx, `
		SELECT t.status, t.passed_pickup, p.lat, p.lng
		  FROM trips t JOIN pickup_points p ON p.id = t.pickup_point_id
		 WHERE t.id = $1`, tripID).Scan(&status, &passed, &pickup.Lat, &pickup.Lng)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil || status != "active" || passed {
		return nil, err
	}
	err = s.db.QueryRow(ctx, `
		SELECT r.lat, r.lng FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.trip_id = $1 AND a.role = 'driver' ORDER BY r.id DESC LIMIT 1`, tripID).Scan(&car.Lat, &car.Lng)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t, err := s.drives.DriveTime(estCtx, car, pickup)
	if err != nil {
		return nil, err
	}
	return &etaView{DurationS: t.DurationS, Simulated: t.Simulated}, nil
}

// vehiclePosition is where the trip's car was last heard from and which way it is heading.
type vehiclePosition struct {
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	HeadingDeg *float64  `json:"heading_deg"` // null until the car has reported two different positions
	ReportedAt time.Time `json:"reported_at"`
}

// vehicleTrack reads the trip's driver reports for the passenger's request status (DD-31): the
// latest position with the heading from the latest earlier report at a different position, and
// whether the car has passed the pickup (DD-06). The position is nil when the car has not been
// heard from. The heading is computed here, not stored; passenger reports on the trip are ignored.
func (s *Server) vehicleTrack(ctx context.Context, tripID int64) (pos *vehiclePosition, passed bool, err error) {
	if err = s.db.QueryRow(ctx, `SELECT passed_pickup FROM trips WHERE id = $1`, tripID).Scan(&passed); err != nil {
		return nil, false, err
	}
	var p vehiclePosition
	err = s.db.QueryRow(ctx, `
		SELECT r.lat, r.lng, r.reported_at FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.trip_id = $1 AND a.role = 'driver' ORDER BY r.id DESC LIMIT 1`, tripID).Scan(&p.Lat, &p.Lng, &p.ReportedAt)
	if isNoRows(err) {
		return nil, passed, nil
	}
	if err != nil {
		return nil, passed, err
	}
	var prev latLng
	err = s.db.QueryRow(ctx, `
		SELECT r.lat, r.lng FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.trip_id = $1 AND a.role = 'driver' AND (r.lat, r.lng) <> ($2, $3)
		 ORDER BY r.id DESC LIMIT 1`, tripID, p.Lat, p.Lng).Scan(&prev.Lat, &prev.Lng)
	if err != nil && !isNoRows(err) {
		return nil, passed, err
	}
	if err == nil {
		h := bearingDeg(prev, latLng{p.Lat, p.Lng})
		p.HeadingDeg = &h
	}
	return &p, passed, nil
}
