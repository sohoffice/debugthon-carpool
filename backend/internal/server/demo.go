package server

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

const demoUsers = `SELECT id FROM users WHERE simulated`

// resetDemo puts the demo back to its starting point (docs/ui-design.md UD-18): accounts, tags and
// simulated trips stay; the demo accounts' trips, requests and service records are cleared. Only
// demo accounts (users.simulated) are touched, so other accounts, e.g. API tests, are not.
// Location reports are append-only (DD-06) and stay; their activities and trips are closed instead.
// The simulated trips start again as new trips, so the simulator restarts their paths (DD-14).
func (s *Server) resetDemo(c *gin.Context) {
	err := s.inTx(c, func(db DB) error {
		if err := lockAssignments(c, db); err != nil {
			return err
		}
		type simTrip struct {
			driverID, pickupID int64
			name               string
			lat, lng           float64
			capacity           int
		}
		rows, err := db.Query(c, `
			SELECT DISTINCT ON (driver_id) driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity
			  FROM trips WHERE simulated AND driver_id IN (`+demoUsers+`) ORDER BY driver_id, id DESC`)
		if err != nil {
			return err
		}
		var sims []simTrip
		for rows.Next() {
			var t simTrip
			if err := rows.Scan(&t.driverID, &t.pickupID, &t.name, &t.lat, &t.lng, &t.capacity); err != nil {
				rows.Close()
				return err
			}
			sims = append(sims, t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		for _, sql := range []string{
			`DELETE FROM service_records WHERE driver_id IN (` + demoUsers + `) OR passenger_id IN (` + demoUsers + `)`,
			`DELETE FROM ride_requests WHERE passenger_id IN (` + demoUsers + `)`,
			`UPDATE trips SET status = 'completed', ended_at = COALESCE(ended_at, now()), seats_held = 0, seats_confirmed = 0
			  WHERE status = 'active' AND driver_id IN (` + demoUsers + `)`,
			`DELETE FROM driver_profiles WHERE user_id IN (` + demoUsers + `)`,
			`DELETE FROM passenger_profiles WHERE user_id IN (` + demoUsers + `)`,
			`SELECT demo_seed_extras()`,
		} {
			if _, err := db.Exec(c, sql); err != nil {
				return err
			}
		}
		for _, t := range sims {
			if err := restartSimulatedTrip(c, db, t.driverID, t.pickupID, t.name, t.lat, t.lng, t.capacity); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// restartSimulatedTrip is a seeded simulated trip again: under way, auto-accepting, with the
// driver's activity (T03, DD-14, DD-25).
func restartSimulatedTrip(ctx context.Context, db DB, driverID, pickupID int64, name string, lat, lng float64, capacity int) error {
	var id int64
	if err := db.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
		                   capacity, auto_accept, status, settings_locked, started_at, simulated)
		VALUES ($1, $2, $3, $4, $5, $6, true, 'active', true, now(), true) RETURNING id`,
		driverID, pickupID, name, lat, lng, capacity).Scan(&id); err != nil {
		return err
	}
	_, err := db.Exec(ctx, `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2)`, driverID, id)
	return err
}
