package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
)

// resetCall posts the demo reset without a token to a router built with or without DemoReset.
func resetCall(t *testing.T, db DB, enabled bool) *httptest.ResponseRecorder {
	t.Helper()
	deps := testDeps(t)
	deps.DemoReset = enabled
	w := httptest.NewRecorder()
	NewRouter(db, deps).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/demo/reset", nil))
	return w
}

// DD-29: the reset API exists only when the demo environment turns it on, and needs no token.
func TestDemoResetOnlyWhenEnabled(t *testing.T) {
	tx := testTx(t)
	wantStatus(t, resetCall(t, tx, false), http.StatusNotFound, "not_found")
	wantStatus(t, resetCall(t, tx, true), http.StatusNoContent, "")
}

// demoSnapshot is what the seed sets for the demo (DD-19): passenger1's profile and driver4's defaults.
type demoSnapshot struct {
	Profile  string
	Defaults defaultsResp
}

func takeDemoSnapshot(t *testing.T, tx pgx.Tx) demoSnapshot {
	t.Helper()
	return demoSnapshot{
		Profile:  call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger1", "").Body.String(),
		Defaults: decode[defaultsResp](t, call(t, tx, http.MethodGet, "/api/driver/trips/defaults", "driver:driver4", "")),
	}
}

// DD-19, DD-29: the function the reset calls writes the same values as the seed migration.
func TestDemoSeedFunctionMatchesMigration(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)
	seeded := takeDemoSnapshot(t, tx)

	mustExec(t, tx, `DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1')`)
	mustExec(t, tx, `SELECT seed_demo_habitual_data()`)
	if got := takeDemoSnapshot(t, tx); !reflect.DeepEqual(got, seeded) {
		t.Errorf("after the function = %+v, want the migration's %+v", got, seeded)
	}
}

func queryInt(t *testing.T, tx pgx.Tx, sql string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

// demoFixture plays part of a demo and adds an account outside the demo. All ids are database ids.
type demoFixture struct {
	pickupID                int64
	oldTrips                map[string]int64 // driver1-3's simulated trips before the reset
	otherTrip, otherRequest int64            // a non-demo driver's trip and a non-demo passenger's request on it
	reportsBefore           int64
}

func playDemo(t *testing.T, tx pgx.Tx) demoFixture {
	t.Helper()
	f := demoFixture{oldTrips: map[string]int64{}}
	f.pickupID = queryInt(t, tx, `SELECT id FROM pickup_points WHERE name = '松山車站'`)
	for _, d := range []string{"driver1", "driver2", "driver3"} {
		f.oldTrips[d] = queryInt(t, tx, `
			SELECT t.id FROM trips t JOIN users u ON u.id = t.driver_id
			 WHERE u.username = $1 AND t.simulated AND t.status = 'active'`, d)
	}

	// driver1's simulator reports a position; driver4 departs with other settings.
	wantStatus(t, call(t, tx, http.MethodPost, "/api/location", "driver:driver1", `{"lat":25.0491,"lng":121.5780}`), http.StatusCreated, "")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", "driver:driver4",
		`{"pickup_point_id":`+itoa(f.pickupID)+`,"destination":{"name":"別處","lat":25.0768,"lng":121.5738},"capacity":2,"auto_accept":true,"tag_filters":[]}`),
		http.StatusCreated, "")

	// passenger1 rides with driver1 and completes (service record, recomputed profile);
	// passenger2 is confirmed on driver1 and waits for driver4.
	mustExec(t, tx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng,
		                           status, trip_id, completed_at)
		SELECT u.id, $1, '別處', 25.08, 121.57, 'completed', $2, now() FROM users u WHERE u.username = 'passenger1'`,
		f.pickupID, f.oldTrips["driver1"])
	mustExec(t, tx, `
		INSERT INTO service_records (request_id, trip_id, driver_id, passenger_id, pickup_point_id, dropoff_name, dropoff_lat, dropoff_lng)
		SELECT q.id, q.trip_id, t.driver_id, q.passenger_id, q.pickup_point_id, q.destination_name, q.destination_lat, q.destination_lng
		  FROM ride_requests q JOIN trips t ON t.id = q.trip_id WHERE q.trip_id = $1`, f.oldTrips["driver1"])
	mustExec(t, tx, `UPDATE passenger_profiles SET usual_destination_name = '別處' WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1')`)
	mustExec(t, tx, `INSERT INTO driver_profiles (user_id, capacity) SELECT id, 2 FROM users WHERE username = 'driver1'`)
	mustExec(t, tx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng, status, trip_id)
		SELECT u.id, $1, '別處', 25.08, 121.57, 'confirmed', $2 FROM users u WHERE u.username = 'passenger2'`,
		f.pickupID, f.oldTrips["driver1"])
	mustExec(t, tx, `UPDATE trips SET seats_confirmed = 1 WHERE id = $1`, f.oldTrips["driver1"])

	// Outside the demo: a driver with an active trip, a passenger confirmed on it, and passenger1
	// waiting for the same car (holding a seat).
	otherDriver := queryInt(t, tx, `INSERT INTO users (username, display_name, is_driver) VALUES ('t17-driver', 'T17', true) RETURNING id`)
	otherPassenger := queryInt(t, tx, `INSERT INTO users (username, display_name, is_passenger) VALUES ('t17-passenger', 'T17', true) RETURNING id`)
	f.otherTrip = queryInt(t, tx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status,
		                   seats_held, seats_confirmed)
		VALUES ($1, $2, 'Office', 25.08, 121.57, 3, 'active', 1, 1) RETURNING id`, otherDriver, f.pickupID)
	f.otherRequest = queryInt(t, tx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng, status, trip_id)
		VALUES ($1, $2, 'Office', 25.08, 121.57, 'confirmed', $3) RETURNING id`, otherPassenger, f.pickupID, f.otherTrip)
	mustExec(t, tx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng, status, trip_id)
		SELECT u.id, $1, 'Office', 25.08, 121.57, 'waiting_driver', $2 FROM users u WHERE u.username = 'passenger1'`,
		f.pickupID, f.otherTrip)

	f.reportsBefore = queryInt(t, tx, `SELECT count(*) FROM location_reports`)
	return f
}

// DD-29, REQ-065: the reset deletes the demo accounts' requests and service records, puts the
// habitual data back to the seed, ends the unfinished trips and starts the simulated trips again
// as new trips; location reports and non-demo data stay.
func TestDemoReset(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)
	seeded := takeDemoSnapshot(t, tx)
	f := playDemo(t, tx)

	wantStatus(t, resetCall(t, tx, true), http.StatusNoContent, "")

	t.Run("demo requests and service records are gone", func(t *testing.T) {
		if n := queryInt(t, tx, `SELECT count(*) FROM ride_requests q JOIN users u ON u.id = q.passenger_id WHERE u.simulated`); n != 0 {
			t.Errorf("demo requests = %d, want 0", n)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM service_records s JOIN users u ON u.id = s.passenger_id WHERE u.simulated`); n != 0 {
			t.Errorf("demo service records = %d, want 0", n)
		}
		for _, p := range []string{"passenger1", "passenger2"} {
			w := call(t, tx, http.MethodGet, "/api/passenger/requests/current", "passenger:"+p, "")
			if w.Body.String() != `{"request":null}` {
				t.Errorf("%s current request = %s, want none", p, w.Body.String())
			}
		}
	})

	t.Run("habitual data is the seed again", func(t *testing.T) {
		if got := takeDemoSnapshot(t, tx); !reflect.DeepEqual(got, seeded) {
			t.Errorf("after reset = %+v, want the seed %+v", got, seeded)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM driver_profiles p JOIN users u ON u.id = p.user_id WHERE u.simulated`); n != 0 {
			t.Errorf("demo driver profiles = %d, want 0", n)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM passenger_profiles p JOIN users u ON u.id = p.user_id WHERE u.username = 'passenger2'`); n != 0 {
			t.Errorf("passenger2 profiles = %d, want 0", n)
		}
	})

	t.Run("unfinished demo trips are cancelled", func(t *testing.T) {
		if n := queryInt(t, tx, `
			SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id
			 WHERE u.simulated AND t.status IN ('active', 'scheduled') AND NOT t.simulated`); n != 0 {
			t.Errorf("unfinished non-simulated demo trips = %d, want 0", n)
		}
		for d, id := range f.oldTrips {
			if n := queryInt(t, tx, `SELECT count(*) FROM trips WHERE id = $1 AND status = 'cancelled' AND ended_at IS NOT NULL`, id); n != 1 {
				t.Errorf("%s's old trip %d is not cancelled", d, id)
			}
		}
		wantStatus(t, call(t, tx, http.MethodGet, "/api/driver/trips/current", "driver:driver4", ""), http.StatusNotFound, "")
	})

	t.Run("simulated trips start again as new trips", func(t *testing.T) {
		for d, old := range f.oldTrips {
			var id, activityTrip int64
			var same, fresh bool
			if err := tx.QueryRow(context.Background(), `
				SELECT n.id,
				       (n.pickup_point_id, n.destination_name, n.destination_lat, n.destination_lng, n.capacity, n.auto_accept)
				         = (o.pickup_point_id, o.destination_name, o.destination_lat, o.destination_lng, o.capacity, o.auto_accept),
				       n.simulated AND n.settings_locked AND NOT n.passed_pickup AND n.seats_held = 0 AND n.seats_confirmed = 0,
				       (SELECT a.trip_id FROM activities a WHERE a.user_id = n.driver_id ORDER BY a.id DESC LIMIT 1)
				  FROM trips n JOIN trips o ON o.id = $1
				 WHERE n.driver_id = o.driver_id AND n.status = 'active'`, old).Scan(&id, &same, &fresh, &activityTrip); err != nil {
				t.Fatalf("%s: no active trip after reset: %v", d, err)
			}
			if id == old || !same || !fresh || activityTrip != id {
				t.Errorf("%s: trip %d (old %d) same settings=%v fresh=%v activity trip=%d", d, id, old, same, fresh, activityTrip)
			}
		}
		// driver2 restarts the moved destination (20261020120100), not the first seeded one.
		if n := queryInt(t, tx, `
			SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id
			 WHERE u.username = 'driver2' AND t.status = 'active' AND t.destination_lat = 25.0815`); n != 1 {
			t.Errorf("driver2's restarted trip is not the moved destination")
		}
		// The simulator reports straight into the new trip; driver4 can depart again.
		wantStatus(t, call(t, tx, http.MethodPost, "/api/location", "driver:driver1", `{"lat":25.0491,"lng":121.5780}`), http.StatusCreated, "")
		wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", "driver:driver4",
			`{"pickup_point_id":`+itoa(f.pickupID)+`,"destination":{"name":"瑞光路 513 巷","lat":25.0765,"lng":121.5742},"capacity":3,"auto_accept":false,"tag_filters":[]}`),
			http.StatusCreated, "")
	})

	t.Run("location reports and non-demo data stay", func(t *testing.T) {
		if n := queryInt(t, tx, `SELECT count(*) FROM location_reports`); n < f.reportsBefore {
			t.Errorf("location reports = %d, want at least %d", n, f.reportsBefore)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM ride_requests WHERE id = $1 AND status = 'confirmed' AND trip_id = $2`, f.otherRequest, f.otherTrip); n != 1 {
			t.Errorf("the non-demo request changed")
		}
		// passenger1's held seat on that trip is given back; the non-demo passenger keeps theirs.
		var status string
		var held, confirmed int
		if err := tx.QueryRow(context.Background(), `SELECT status, seats_held, seats_confirmed FROM trips WHERE id = $1`, f.otherTrip).
			Scan(&status, &held, &confirmed); err != nil {
			t.Fatal(err)
		}
		if status != "active" || held != 0 || confirmed != 1 {
			t.Errorf("non-demo trip status=%s held=%d confirmed=%d, want active 0 1", status, held, confirmed)
		}
	})
}

// DD-29: resetting twice leaves one active trip per simulated driver.
func TestDemoResetTwice(t *testing.T) {
	tx := testTx(t)
	wantStatus(t, resetCall(t, tx, true), http.StatusNoContent, "")
	wantStatus(t, resetCall(t, tx, true), http.StatusNoContent, "")
	if n := queryInt(t, tx, `
		SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id
		 WHERE u.username IN ('driver1', 'driver2', 'driver3') AND t.status = 'active' AND t.simulated`); n != 3 {
		t.Errorf("active simulated trips = %d, want 3", n)
	}
}
