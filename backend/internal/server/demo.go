package server

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// resetDemo puts the demo accounts (users.simulated) back to the start of the demo (DD-29), in one
// transaction. Location reports are append-only (DD-06), so nothing that they hang off is deleted:
// trips are ended and the seeded simulated trips start again as new trips. Other accounts keep
// their data, except that seats held for deleted demo requests are given back.
func (s *Server) resetDemo(c *gin.Context) {
	if err := s.inTx(c, func(db DB) error { return resetDemoData(c, db, s.now()) }); err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func resetDemoData(ctx context.Context, db DB, realNow time.Time) error {
	steps := []string{
		// Seats held or taken by the demo passengers' requests go back to their trips (DD-12).
		`UPDATE trips t
		    SET seats_held = t.seats_held - r.held, seats_confirmed = t.seats_confirmed - r.confirmed
		   FROM (SELECT q.trip_id,
		                count(*) FILTER (WHERE q.status = 'waiting_driver') AS held,
		                count(*) FILTER (WHERE q.status IN ('confirmed', 'boarded')) AS confirmed
		           FROM ride_requests q JOIN users u ON u.id = q.passenger_id
		          WHERE u.simulated AND q.trip_id IS NOT NULL
		          GROUP BY q.trip_id) r
		  WHERE t.id = r.trip_id`,
		// Ride points go before the service records they reference (DD-34): the demo drivers' and
		// those earned by carrying a demo passenger, whose service record is deleted next.
		`DELETE FROM driver_point_ledger l
		  WHERE l.reason = 'ride'
		    AND (l.driver_id IN (SELECT id FROM users WHERE simulated)
		         OR l.service_record_id IN (SELECT s.id FROM service_records s JOIN users u ON u.id = s.passenger_id
		                                    WHERE u.simulated))`,
		// A non-demo driver who carried a demo passenger keeps a balance equal to the ledger (REQ-071).
		`UPDATE driver_profiles p
		    SET point_balance = (SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger l WHERE l.driver_id = p.user_id)
		   FROM users u
		  WHERE u.id = p.user_id AND NOT u.simulated
		    AND p.point_balance <> (SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger l WHERE l.driver_id = p.user_id)`,
		// Service records reference the requests; tag filters and candidates cascade with them.
		`DELETE FROM service_records s USING users u WHERE u.id = s.passenger_id AND u.simulated`,
		`DELETE FROM ride_requests q USING users u WHERE u.id = q.passenger_id AND u.simulated`,
		// Habitual data goes back to the seed (DD-19); accepted stops cascade with the passenger
		// profile. The demo drivers keep their rows (DD-34): only the habitual fields are cleared, and
		// seed_demo_driver_points puts the balance back to the seed rows' sum.
		`UPDATE driver_profiles p
		    SET usual_pickup_point_id = NULL, usual_destination_name = NULL, usual_destination_lat = NULL,
		        usual_destination_lng = NULL, capacity = NULL
		   FROM users u WHERE u.id = p.user_id AND u.simulated`,
		`DELETE FROM passenger_profiles p USING users u WHERE u.id = p.user_id AND u.simulated`,
		`SELECT seed_demo_habitual_data()`,
		`SELECT seed_demo_driver_points()`,
		// End every unfinished demo trip. cancelled, not completed: the trip did not arrive (DD-30),
		// so the driver UI does not show the trip-ended screen for it.
		`UPDATE trips t SET status = 'cancelled', ended_at = now()
		   FROM users u
		  WHERE u.id = t.driver_id AND u.simulated AND t.status IN ('scheduled', 'active')`,
	}
	for _, sql := range steps {
		if _, err := db.Exec(ctx, sql); err != nil {
			return err
		}
	}
	if err := restartSimulatedTrips(ctx, db); err != nil {
		return err
	}
	// Phase 2 simulated traffic and weather, again for today (DD-29, DD-40, DD-41).
	return regenerateCommuteSimulation(ctx, db, realNow)
}

// restartSimulatedTrips starts each demo driver's latest simulated trip again as a new active trip
// with the same settings, and links the driver's new activity to it (DD-14, DD-25),
// so the simulator can report positions right away. A real route is copied; a simulated one is
// left out, so the new trip builds its route on first use from the current source (DD-09, DD-21)
// and a demo that started offline gets real routes back after a reset.
func restartSimulatedTrips(ctx context.Context, db DB) error {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT ON (t.driver_id) t.id
		  FROM trips t JOIN users u ON u.id = t.driver_id
		 WHERE t.simulated AND u.simulated
		 ORDER BY t.driver_id, t.id DESC`)
	if err != nil {
		return err
	}
	var sources []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		sources = append(sources, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, src := range sources {
		var tripID, driverID int64
		if err := db.QueryRow(ctx, `
			INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
			                   capacity, auto_accept, status, settings_locked, started_at,
			                   route_polyline, route_distance_m, route_duration_s, route_simulated, simulated)
			SELECT driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
			       capacity, auto_accept, 'active', true, now(),
			       r.polyline, r.distance_m, r.duration_s, r.simulated, true
			  FROM trips t
			  LEFT JOIN LATERAL (SELECT t.route_polyline, t.route_distance_m, t.route_duration_s, t.route_simulated
			                      WHERE NOT t.route_simulated) r (polyline, distance_m, duration_s, simulated) ON true
			 WHERE t.id = $1
			RETURNING id, driver_id`, src).Scan(&tripID, &driverID); err != nil {
			return err
		}
		for _, sql := range []string{
			`INSERT INTO trip_route_stops (trip_id, seq, bus_stop_id)
			 SELECT $2, s.seq, s.bus_stop_id FROM trip_route_stops s JOIN trips t ON t.id = s.trip_id
			  WHERE s.trip_id = $1 AND NOT t.route_simulated`,
			`INSERT INTO trip_tag_filters (trip_id, tag_id, intent) SELECT $2, tag_id, intent FROM trip_tag_filters WHERE trip_id = $1`,
		} {
			if _, err := db.Exec(ctx, sql, src, tripID); err != nil {
				return err
			}
		}
		if _, err := db.Exec(ctx, `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2)`,
			driverID, tripID); err != nil {
			return err
		}
	}
	return nil
}
