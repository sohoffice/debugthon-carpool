package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type driverProfileResp struct {
	DisplayName      string       `json:"display_name"`
	UsualPickupPoint *pickupPoint `json:"usual_pickup_point"`
	UsualDestination *place       `json:"usual_destination"`
	Capacity         *int         `json:"capacity"`
	Vehicle          *vehicleView `json:"vehicle"`
	PointBalance     *int         `json:"point_balance"`
}

type meResp struct {
	DisplayName string `json:"display_name"`
}

type pointsResp struct {
	Points []struct {
		Delta           int       `json:"delta"`
		Reason          string    `json:"reason"`
		ServiceRecordID *int64    `json:"service_record_id"`
		CreatedAt       time.Time `json:"created_at"`
	} `json:"points"`
}

// driverPoints reads a driver's balance and ledger sum straight from the tables.
func driverPoints(t *testing.T, tx pgx.Tx, driverID int64) (balance, ledgerSum, rows int64) {
	t.Helper()
	if err := tx.QueryRow(context.Background(), `
		SELECT COALESCE((SELECT point_balance FROM driver_profiles WHERE user_id = $1), 0),
		       (SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger WHERE driver_id = $1),
		       (SELECT count(*) FROM driver_point_ledger WHERE driver_id = $1)`, driverID).Scan(&balance, &ledgerSum, &rows); err != nil {
		t.Fatal(err)
	}
	return
}

func tripDriver(t *testing.T, tx pgx.Tx, tripID int64) int64 {
	t.Helper()
	return queryInt(t, tx, `SELECT driver_id FROM trips WHERE id = $1`, tripID)
}

// REQ-071, REQ-072, DD-34: completing one passenger's ride, by either side, credits the driver
// points_per_ride with one ledger row that points at the ride's service record.
func TestCompletingARideCreditsTheDriver(t *testing.T) {
	for _, by := range []string{"passenger", "driver"} {
		t.Run("by the "+by, func(t *testing.T) {
			e := newSupplyEnv(t)
			trip, driver, id := e.confirmedRide(t)
			driverID := tripDriver(t, e.tx, trip)
			if b, _, n := driverPoints(t, e.tx, driverID); b != 0 || n != 0 {
				t.Fatalf("before: balance %d rows %d, want 0 0", b, n)
			}

			if by == "passenger" {
				e.passengerAct(t, "complete", id, e.token, http.StatusOK)
			} else {
				e.answer(t, "complete", id, driver, http.StatusOK)
			}

			balance, sum, rows := driverPoints(t, e.tx, driverID)
			if balance != 10 || sum != 10 || rows != 1 {
				t.Errorf("balance %d ledger sum %d rows %d, want 10 10 1", balance, sum, rows)
			}
			if n := queryInt(t, e.tx, `
				SELECT count(*) FROM driver_point_ledger l JOIN service_records s ON s.id = l.service_record_id
				 WHERE l.driver_id = $1 AND l.reason = 'ride' AND l.delta = 10 AND s.request_id = $2`, driverID, id); n != 1 {
				t.Errorf("ride rows pointing at the service record = %d, want 1", n)
			}
			p := decode[driverProfileResp](t, call(t, e.tx, http.MethodGet, "/api/driver/profile", driver, ""))
			if p.PointBalance == nil || *p.PointBalance != 10 {
				t.Errorf("profile point_balance = %v, want 10", p.PointBalance)
			}
		})
	}
}

// REQ-067, REQ-072: completing an already completed ride, from either side, credits nothing more.
func TestCompletingTwiceCreditsOnce(t *testing.T) {
	e := newSupplyEnv(t)
	trip, driver, id := e.confirmedRide(t)
	driverID := tripDriver(t, e.tx, trip)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	e.answer(t, "complete", id, driver, http.StatusOK)
	if balance, sum, rows := driverPoints(t, e.tx, driverID); balance != 10 || sum != 10 || rows != 1 {
		t.Errorf("balance %d ledger sum %d rows %d, want 10 10 1", balance, sum, rows)
	}
}

// DD-34: the unique service_record_id refuses a second credit for the same ride even outside the
// complete-once guard.
func TestOneRideCannotBeCreditedTwice(t *testing.T) {
	e := newSupplyEnv(t)
	trip, _, id := e.confirmedRide(t)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	recordID := queryInt(t, e.tx, `SELECT id FROM service_records WHERE request_id = $1`, id)
	ctx := context.Background()
	sp, err := e.tx.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = creditRide(ctx, sp, tripDriver(t, e.tx, trip), recordID)
	_ = sp.Rollback(ctx)
	if err == nil || !strings.Contains(err.Error(), "driver_point_ledger_service_record_id_key") {
		t.Errorf("second credit err = %v, want the unique service_record_id violation", err)
	}
}

// REQ-070, REQ-072: the rides a trip end completes are credited once per passenger.
func TestTripEndCreditsEachPassenger(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driverID := tripDriver(t, e.tx, trip)
	confirmed, driver := e.confirmedOn(t, trip)
	_, other := newUser(t, e.tx, rolePassenger)
	boarded := e.submitAs(t, other, e.body(e.near(), ""))
	assigned(t, boarded, trip)
	e.answer(t, "accept", boarded.ID, driver, http.StatusOK)
	e.answer(t, "board", boarded.ID, driver, http.StatusOK)

	e.passPickup(t, driver)
	if r := report(t, e.tx, driver, e.dest); !ended(r) {
		t.Fatalf("arrival did not end the trip")
	}
	if balance, sum, rows := driverPoints(t, e.tx, driverID); balance != 20 || sum != 20 || rows != 2 {
		t.Errorf("balance %d ledger sum %d rows %d, want 20 20 2", balance, sum, rows)
	}
	if n := queryInt(t, e.tx, `
		SELECT count(DISTINCT s.request_id) FROM driver_point_ledger l JOIN service_records s ON s.id = l.service_record_id
		 WHERE l.driver_id = $1 AND s.request_id IN ($2, $3)`, driverID, confirmed, boarded.ID); n != 2 {
		t.Errorf("credited requests = %d, want both", n)
	}

	// Ending an already completed ride again changes nothing.
	e.passengerAct(t, "complete", confirmed, e.token, http.StatusOK)
	if balance, _, rows := driverPoints(t, e.tx, driverID); balance != 20 || rows != 2 {
		t.Errorf("after a repeat complete: balance %d rows %d, want 20 2", balance, rows)
	}
}

// REQ-060, DD-20, DD-34: points_per_ride is read on every completion, so a changed value applies
// to the next ride.
func TestPointsPerRideIsReadOnEveryCompletion(t *testing.T) {
	e := newSupplyEnv(t)
	if v := queryInt(t, e.tx, `SELECT value::int FROM system_settings WHERE key = 'points_per_ride'`); v != 10 {
		t.Fatalf("seeded points_per_ride = %d, want 10", v)
	}
	trip := e.addTrip(t, tripSpec{})
	driverID := tripDriver(t, e.tx, trip)
	first, driver := e.confirmedOn(t, trip)
	e.passengerAct(t, "complete", first, e.token, http.StatusOK)

	mustExec(t, e.tx, `UPDATE system_settings SET value = 25 WHERE key = 'points_per_ride'`)
	_, other := newUser(t, e.tx, rolePassenger)
	second := e.submitAs(t, other, e.body(e.near(), ""))
	assigned(t, second, trip)
	e.answer(t, "accept", second.ID, driver, http.StatusOK)
	e.passengerAct(t, "complete", second.ID, other, http.StatusOK)

	if balance, sum, rows := driverPoints(t, e.tx, driverID); balance != 35 || sum != 35 || rows != 2 {
		t.Errorf("balance %d ledger sum %d rows %d, want 35 35 2", balance, sum, rows)
	}
	if n := queryInt(t, e.tx, `
		SELECT l.delta FROM driver_point_ledger l JOIN service_records s ON s.id = l.service_record_id
		 WHERE s.request_id = $1`, second.ID); n != 25 {
		t.Errorf("second ride delta = %d, want 25", n)
	}
}

// DD-34: a driver without a profile row gets one on the first credit, with the habitual data
// still empty.
func TestFirstCreditCreatesTheProfileRow(t *testing.T) {
	e := newSupplyEnv(t)
	trip, _, id := e.confirmedRide(t)
	driverID := tripDriver(t, e.tx, trip)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	recordID := queryInt(t, e.tx, `SELECT id FROM service_records WHERE request_id = $1`, id)
	// Start over as a driver who has never had a row: drop the ride's credit and the row.
	mustExec(t, e.tx, `DELETE FROM driver_point_ledger WHERE driver_id = $1`, driverID)
	mustExec(t, e.tx, `DELETE FROM driver_profiles WHERE user_id = $1`, driverID)

	if err := creditRide(context.Background(), e.tx, driverID, recordID); err != nil {
		t.Fatal(err)
	}
	if n := queryInt(t, e.tx, `
		SELECT count(*) FROM driver_profiles WHERE user_id = $1 AND point_balance = 10
		   AND num_nonnulls(usual_pickup_point_id, usual_destination_name, usual_destination_lat, usual_destination_lng, capacity) = 0`,
		driverID); n != 1 {
		t.Errorf("new profile rows with balance 10 and empty habitual data = %d, want 1", n)
	}
}

// DD-19, DD-34: recomputing the usual data never touches the balance; only credits change it.
func TestRecomputingUsualDataKeepsTheBalance(t *testing.T) {
	e := newSupplyEnv(t)
	trip, _, id := e.confirmedRide(t)
	driverID := tripDriver(t, e.tx, trip)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	mustExec(t, e.tx, `UPDATE driver_profiles SET capacity = 1 WHERE user_id = $1`, driverID)

	if err := recomputeUsualData(context.Background(), e.tx, driverID, e.userID); err != nil {
		t.Fatal(err)
	}
	if balance, _, _ := driverPoints(t, e.tx, driverID); balance != 10 {
		t.Errorf("balance after recompute = %d, want 10", balance)
	}
	if n := queryInt(t, e.tx, `SELECT capacity FROM driver_profiles WHERE user_id = $1`, driverID); n != 3 {
		t.Errorf("capacity = %d, want the recomputed 3", n)
	}
}

// REQ-073, DD-34: after the seed every demo driver has a non-zero balance equal to its seed rows,
// and driver4 has the most rows.
func TestSeedGivesEveryDemoDriverPoints(t *testing.T) {
	tx := testTx(t)
	rows, err := tx.Query(context.Background(), `
		SELECT u.username, p.point_balance,
		       (SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger l WHERE l.driver_id = u.id AND l.reason = 'seed'),
		       (SELECT count(*) FROM driver_point_ledger l WHERE l.driver_id = u.id AND l.reason = 'seed')
		  FROM users u LEFT JOIN driver_profiles p ON p.user_id = u.id
		 WHERE u.simulated AND u.is_driver ORDER BY u.username`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	counts := map[string]int64{}
	for rows.Next() {
		var name string
		var balance *int64
		var sum, n int64
		if err := rows.Scan(&name, &balance, &sum, &n); err != nil {
			t.Fatal(err)
		}
		if balance == nil || *balance <= 0 || *balance != sum {
			t.Errorf("%s: balance %v, seed sum %d; want a positive balance equal to the sum", name, balance, sum)
		}
		counts[name] = n
	}
	if len(counts) != 5 {
		t.Fatalf("demo drivers = %v, want driver1..driver5", counts)
	}
	for name, n := range counts {
		if name != "driver4" && n >= counts["driver4"] {
			t.Errorf("%s has %d seed rows, driver4 %d; want driver4 to have the most", name, n, counts["driver4"])
		}
	}
}

// DD-34: running the seed function again adds no seed rows and keeps the balances.
func TestSeedDriverPointsIsRepeatable(t *testing.T) {
	tx := testTx(t)
	q := `SELECT (SELECT count(*) FROM driver_point_ledger), (SELECT COALESCE(sum(point_balance), 0) FROM driver_profiles)`
	var rows1, sum1, rows2, sum2 int64
	if err := tx.QueryRow(context.Background(), q).Scan(&rows1, &sum1); err != nil {
		t.Fatal(err)
	}
	mustExec(t, tx, `SELECT seed_demo_driver_points()`)
	if err := tx.QueryRow(context.Background(), q).Scan(&rows2, &sum2); err != nil {
		t.Fatal(err)
	}
	if rows1 != rows2 || sum1 != sum2 {
		t.Errorf("ledger rows %d -> %d, balances %d -> %d; want unchanged", rows1, rows2, sum1, sum2)
	}
}

// REQ-074, DD-35, DD-34: driver5 has never completed a ride: the habitual data is null, but the
// name, the vehicle and the seeded balance are there.
func TestDriverProfileWithoutRides(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)
	p := decode[driverProfileResp](t, call(t, tx, http.MethodGet, "/api/driver/profile", "driver:driver5", ""))
	if p.UsualPickupPoint != nil || p.UsualDestination != nil || p.Capacity != nil {
		t.Errorf("habitual data = %+v, want null", p)
	}
	if p.PointBalance == nil || *p.PointBalance <= 0 {
		t.Errorf("point_balance = %v, want the seeded positive balance", p.PointBalance)
	}
	if want := int(queryInt(t, tx, `
		SELECT point_balance FROM driver_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'driver5')`)); p.PointBalance != nil && *p.PointBalance != want {
		t.Errorf("point_balance = %d, want %d", *p.PointBalance, want)
	}
	if p.Vehicle == nil || p.Vehicle.Plate != "ABC-0005" || p.Vehicle.Description == "" {
		t.Errorf("vehicle = %+v, want ABC-0005 with a description", p.Vehicle)
	}
	if me := decode[meResp](t, call(t, tx, http.MethodGet, "/api/me", "driver:driver5", "")); p.DisplayName == "" || p.DisplayName != me.DisplayName {
		t.Errorf("display_name = %q, want /api/me's %q", p.DisplayName, me.DisplayName)
	}
}

// DD-35: the drawer takes the name from the profile; it is /api/me's display_name for a driver
// with rides too.
func TestDriverProfileNameMatchesMe(t *testing.T) {
	tx := testTx(t)
	for _, token := range []string{"driver:driver1", "driver:driver4"} {
		p := decode[driverProfileResp](t, call(t, tx, http.MethodGet, "/api/driver/profile", token, ""))
		me := decode[meResp](t, call(t, tx, http.MethodGet, "/api/me", token, ""))
		if p.DisplayName == "" || p.DisplayName != me.DisplayName {
			t.Errorf("%s: display_name = %q, want /api/me's %q", token, p.DisplayName, me.DisplayName)
		}
	}
}

// DD-34: a driver with no profile row and no vehicle reads a zero balance and a null vehicle.
func TestDriverProfileForANewDriver(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	p := decode[driverProfileResp](t, call(t, tx, http.MethodGet, "/api/driver/profile", token, ""))
	if p.PointBalance == nil || *p.PointBalance != 0 || p.Vehicle != nil {
		t.Errorf("profile = %+v, want balance 0 and no vehicle", p)
	}
}

// REQ-074, DD-35: /api/driver/points lists the caller's latest rows, newest first, 5 by default.
func TestDriverPointsListsTheLatestRows(t *testing.T) {
	tx := testTx(t)
	driverID, token := newUser(t, tx, roleDriver)
	for i := 1; i <= 7; i++ {
		mustExec(t, tx, `INSERT INTO driver_point_ledger (driver_id, delta, reason, created_at)
			VALUES ($1, $2, 'seed', now() - make_interval(hours => $3))`, driverID, i, 10-i)
	}
	// Another driver's rows never show.
	otherID, _ := newUser(t, tx, roleDriver)
	mustExec(t, tx, `INSERT INTO driver_point_ledger (driver_id, delta, reason) VALUES ($1, 99, 'seed')`, otherID)

	got := decode[pointsResp](t, call(t, tx, http.MethodGet, "/api/driver/points", token, ""))
	if len(got.Points) != 5 {
		t.Fatalf("rows = %d, want 5", len(got.Points))
	}
	for i, p := range got.Points {
		if p.Delta != 7-i || p.Reason != "seed" || p.ServiceRecordID != nil || p.CreatedAt.IsZero() {
			t.Errorf("row %d = %+v, want delta %d seed without a service record", i, p, 7-i)
		}
	}
	if got := decode[pointsResp](t, call(t, tx, http.MethodGet, "/api/driver/points?limit=2", token, "")); len(got.Points) != 2 || got.Points[0].Delta != 7 {
		t.Errorf("limit=2 = %+v, want the newest 2", got.Points)
	}
	if got := decode[pointsResp](t, call(t, tx, http.MethodGet, "/api/driver/points?limit=50", token, "")); len(got.Points) != 7 {
		t.Errorf("limit=50 rows = %d, want all 7", len(got.Points))
	}
	for _, bad := range []string{"0", "51", "x", "-1"} {
		wantStatus(t, call(t, tx, http.MethodGet, "/api/driver/points?limit="+bad, token, ""), http.StatusBadRequest, "invalid_request")
	}

	_, fresh := newUser(t, tx, roleDriver)
	if w := call(t, tx, http.MethodGet, "/api/driver/points", fresh, ""); w.Body.String() != `{"points":[]}` {
		t.Errorf("no rows = %s, want an empty list", w.Body.String())
	}
}

// REQ-074: the ride row carries the service record behind it.
func TestDriverPointsShowsTheRide(t *testing.T) {
	e := newSupplyEnv(t)
	_, driver, id := e.confirmedRide(t)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	recordID := queryInt(t, e.tx, `SELECT id FROM service_records WHERE request_id = $1`, id)
	got := decode[pointsResp](t, call(t, e.tx, http.MethodGet, "/api/driver/points", driver, ""))
	if len(got.Points) != 1 || got.Points[0].Reason != "ride" || got.Points[0].Delta != 10 ||
		got.Points[0].ServiceRecordID == nil || *got.Points[0].ServiceRecordID != recordID {
		t.Errorf("points = %+v, want one ride row for service record %d", got.Points, recordID)
	}
}

// The points API is for drivers only and needs a token.
func TestDriverPointsAccess(t *testing.T) {
	tx := testTx(t)
	wantStatus(t, call(t, tx, http.MethodGet, "/api/driver/points", "passenger:passenger1", ""), http.StatusForbidden, "forbidden")
	wantStatus(t, call(t, tx, http.MethodGet, "/api/driver/points", "", ""), http.StatusUnauthorized, "")
}

// REQ-075: nothing the passenger reads about a confirmed ride carries the driver's points.
func TestPassengerNeverSeesDriverPoints(t *testing.T) {
	e := newSupplyEnv(t)
	trip, _, id := e.confirmedRide(t)
	mustExec(t, e.tx, `INSERT INTO driver_profiles (user_id, point_balance) VALUES ($1, 4321)`, tripDriver(t, e.tx, trip))
	for _, path := range []string{"/api/passenger/requests/" + itoa(id), "/api/passenger/requests/current", "/api/trips/" + itoa(trip)} {
		w := call(t, e.tx, http.MethodGet, path, e.token, "")
		wantStatus(t, w, http.StatusOK, "")
		body := w.Body.String()
		if strings.Contains(body, "point_balance") || strings.Contains(body, `"points"`) || strings.Contains(body, "4321") {
			t.Errorf("%s exposes driver points: %s", path, body)
		}
	}
	// The confirmed request does show the vehicle, so the check above saw a populated response.
	if s := e.status(t, id); s.Vehicle == nil {
		t.Errorf("confirmed request has no vehicle; the response checked was not the confirmed view")
	}
}

// DD-29, DD-34, REQ-071: the reset deletes a demo passenger's service record, so a non-demo
// driver who carried that passenger loses the ride row and the balance follows the ledger.
func TestDemoResetTakesBackPointsForADemoPassengersRide(t *testing.T) {
	e := newSupplyEnv(t)
	freshDemoSeed(t, e.tx)
	mustExec(t, e.tx, `DELETE FROM service_records WHERE passenger_id = (SELECT id FROM users WHERE username = 'passenger1')`)
	mustExec(t, e.tx, `DELETE FROM ride_requests WHERE passenger_id = (SELECT id FROM users WHERE username = 'passenger1')`)
	e.token = "passenger:passenger1"
	trip, _, id := e.confirmedRide(t)
	driverID := tripDriver(t, e.tx, trip)
	mustExec(t, e.tx, `INSERT INTO driver_point_ledger (driver_id, delta, reason) VALUES ($1, 7, 'seed')`, driverID)
	mustExec(t, e.tx, `INSERT INTO driver_profiles (user_id, point_balance) VALUES ($1, 7)`, driverID)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	if balance, _, _ := driverPoints(t, e.tx, driverID); balance != 17 {
		t.Fatalf("balance before reset = %d, want 17", balance)
	}

	wantStatus(t, resetCall(t, e.tx, true), http.StatusNoContent, "")
	if balance, sum, rows := driverPoints(t, e.tx, driverID); balance != 7 || sum != 7 || rows != 1 {
		t.Errorf("after reset: balance %d ledger sum %d rows %d, want 7 7 1", balance, sum, rows)
	}
}
