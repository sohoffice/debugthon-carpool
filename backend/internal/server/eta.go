package server

import "context"

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
	route, err := s.routes.Route(ctx, car, pickup)
	if err != nil {
		return nil, err
	}
	return &etaView{DurationS: route.DurationS, Simulated: route.Simulated}, nil
}
