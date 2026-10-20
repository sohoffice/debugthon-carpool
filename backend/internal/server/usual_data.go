package server

import "context"

// Usual data (REQ-006, REQ-007, DD-19). Whenever a ride completes, both profiles are recomputed
// from all of the user's service records, so the profile always reflects the rides taken. For
// each field the most frequent value wins; a tie goes to the value of the most recent ride
// (the highest service record id, since completed_at can tie).

// usualTimeZone is where "the usual arrival time" is read: the park is in Taipei.
const usualTimeZone = "Asia/Taipei"

// recomputeUsualData refreshes the driver's and the passenger's profile. db must be the
// transaction that completes the ride.
func recomputeUsualData(ctx context.Context, db DB, driverID, passengerID int64) error {
	if err := recomputeDriverProfile(ctx, db, driverID); err != nil {
		return err
	}
	return recomputePassengerProfile(ctx, db, passengerID)
}

// The driver's pickup point, destination and capacity are those of the trips driven.
func recomputeDriverProfile(ctx context.Context, db DB, driverID int64) error {
	const from = `FROM service_records sr JOIN trips t ON t.id = sr.trip_id WHERE sr.driver_id = $1`
	const rank = ` ORDER BY count(*) DESC, max(sr.id) DESC LIMIT 1`
	var pickupID int64
	if err := db.QueryRow(ctx, `SELECT t.pickup_point_id `+from+` GROUP BY t.pickup_point_id`+rank, driverID).Scan(&pickupID); err != nil {
		return err
	}
	var dest place
	if err := db.QueryRow(ctx, `SELECT t.destination_name, t.destination_lat, t.destination_lng `+from+
		` GROUP BY t.destination_name, t.destination_lat, t.destination_lng`+rank, driverID).Scan(&dest.Name, &dest.Lat, &dest.Lng); err != nil {
		return err
	}
	var capacity int
	if err := db.QueryRow(ctx, `SELECT t.capacity `+from+` GROUP BY t.capacity`+rank, driverID).Scan(&capacity); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `
		INSERT INTO driver_profiles (user_id, usual_pickup_point_id, usual_destination_name, usual_destination_lat,
		                             usual_destination_lng, capacity)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id) DO UPDATE SET usual_pickup_point_id = $2, usual_destination_name = $3,
		       usual_destination_lat = $4, usual_destination_lng = $5, capacity = $6`,
		driverID, pickupID, dest.Name, dest.Lat, dest.Lng, capacity)
	return err
}

// The passenger's final destination is the one asked for in the requests (not the drop-off
// stop); the arrival time is the median time of day of the completions; the accepted stops are
// the bus stops actually used (a null drop-off is the trip's destination, not a stop).
func recomputePassengerProfile(ctx context.Context, db DB, passengerID int64) error {
	var dest place
	if err := db.QueryRow(ctx, `
		SELECT q.destination_name, q.destination_lat, q.destination_lng
		  FROM service_records sr JOIN ride_requests q ON q.id = sr.request_id
		 WHERE sr.passenger_id = $1
		 GROUP BY q.destination_name, q.destination_lat, q.destination_lng
		 ORDER BY count(*) DESC, max(sr.id) DESC LIMIT 1`, passengerID).Scan(&dest.Name, &dest.Lat, &dest.Lng); err != nil {
		return err
	}
	// The median of the seconds since local midnight; an even count averages the middle two.
	var arrival string
	if err := db.QueryRow(ctx, `
		SELECT (round(percentile_cont(0.5) WITHIN GROUP (
		           ORDER BY extract(epoch FROM (completed_at AT TIME ZONE '`+usualTimeZone+`')::time))) * interval '1 second')::time::text
		  FROM service_records WHERE passenger_id = $1`, passengerID).Scan(&arrival); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO passenger_profiles (user_id, usual_arrival_time, usual_destination_name, usual_destination_lat, usual_destination_lng)
		VALUES ($1, $2::time, $3, $4, $5)
		ON CONFLICT (user_id) DO UPDATE SET usual_arrival_time = $2::time, usual_destination_name = $3,
		       usual_destination_lat = $4, usual_destination_lng = $5`,
		passengerID, arrival, dest.Name, dest.Lat, dest.Lng); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `DELETE FROM passenger_accepted_stops WHERE user_id = $1`, passengerID); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `
		INSERT INTO passenger_accepted_stops (user_id, bus_stop_id)
		SELECT DISTINCT passenger_id, dropoff_bus_stop_id FROM service_records
		 WHERE passenger_id = $1 AND dropoff_bus_stop_id IS NOT NULL`, passengerID)
	return err
}
