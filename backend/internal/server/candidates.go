package server

import "context"

// Loading the inputs of the matching engine (DD-10, DD-11) from the database. Shared by the supply
// query and the request flow, so both screen the same cars with the same rules.

// tripCandidate is an active trip at a pickup point, as screening sees it, plus what the request
// flow needs to assign it.
type tripCandidate struct {
	Trip       matchTrip
	AutoAccept bool
	Simulated  bool // the trip, or its ETA, is simulated (REQ-063)
}

// loadCandidates reads every active trip at the pickup point with its route stops, the driver's
// filters and tags, and the ETA from the car's latest reported position (T06A).
func (s *Server) loadCandidates(ctx context.Context, db DB, pickupID int64) ([]tripCandidate, error) {
	rows, err := db.Query(ctx, `
		SELECT t.id, t.driver_id, t.passed_pickup, t.destination_lat, t.destination_lng, t.capacity,
		       t.seats_held, t.seats_confirmed, t.auto_accept, t.simulated
		  FROM trips t WHERE t.status = 'active' AND t.pickup_point_id = $1 ORDER BY t.id`, pickupID)
	if err != nil {
		return nil, err
	}
	type row struct {
		c        tripCandidate
		driverID int64
	}
	var list []row
	for rows.Next() {
		var r row
		t := &r.c.Trip
		if err := rows.Scan(&t.ID, &r.driverID, &t.PassedPickup, &t.Destination.Lat, &t.Destination.Lng, &t.Capacity,
			&t.SeatsHeld, &t.SeatsConfirmed, &r.c.AutoAccept, &r.c.Simulated); err != nil {
			rows.Close()
			return nil, err
		}
		t.PickupPointID, t.Active = pickupID, true
		list = append(list, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]tripCandidate, 0, len(list))
	for _, r := range list {
		c := r.c
		// A simulated trip made with SQL gets its route on first use (DD-21).
		if err := s.ensureRoute(ctx, c.Trip.ID); err != nil {
			return nil, err
		}
		if c.Trip.RouteStops, err = int64s(ctx, db, `SELECT bus_stop_id FROM trip_route_stops WHERE trip_id = $1 ORDER BY seq`, c.Trip.ID); err != nil {
			return nil, err
		}
		if c.Trip.Filters, err = tripFilters(ctx, db, `SELECT tag_id, intent FROM trip_tag_filters WHERE trip_id = $1`, c.Trip.ID); err != nil {
			return nil, err
		}
		if c.Trip.Tags, err = userTags(ctx, db, r.driverID); err != nil {
			return nil, err
		}
		eta, err := s.vehicleETA(ctx, c.Trip.ID)
		if err != nil {
			return nil, err
		}
		if eta != nil {
			c.Trip.ETASeconds = &eta.DurationS
			c.Simulated = c.Simulated || eta.Simulated
		}
		out = append(out, c)
	}
	return out, nil
}

func userTags(ctx context.Context, db DB, userID int64) ([]int64, error) {
	return int64s(ctx, db, `SELECT tag_id FROM user_tags WHERE user_id = $1`, userID)
}

func int64s(ctx context.Context, db DB, sql string, args ...any) ([]int64, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func tripFilters(ctx context.Context, db DB, sql string, arg any) ([]tagFilter, error) {
	rows, err := db.Query(ctx, sql, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []tagFilter
	for rows.Next() {
		var f tagFilter
		if err := rows.Scan(&f.TagID, &f.Intent); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// stopPositions returns where each bus stop is, for pricing drop-offs (REQ-043).
func stopPositions(ctx context.Context, db DB) (map[int64]latLng, error) {
	rows, err := db.Query(ctx, `SELECT id, lat, lng FROM bus_stops`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]latLng{}
	for rows.Next() {
		var id int64
		var p latLng
		if err := rows.Scan(&id, &p.Lat, &p.Lng); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

// relaxedFor reports whether the car carries fewer than all the passenger's preferred tags (REQ-047).
func relaxedFor(r matchRequest, t matchTrip) bool {
	have := make(map[int64]bool, len(t.Tags))
	for _, id := range t.Tags {
		have[id] = true
	}
	for _, f := range r.Filters {
		if f.Intent == "preferred" && !have[f.TagID] {
			return true
		}
	}
	return false
}
