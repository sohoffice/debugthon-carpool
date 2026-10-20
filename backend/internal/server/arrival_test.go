package server

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

// passPickup drives the trip's car into the pickup range and out beyond range plus pass_margin (DD-06).
func (e *supplyEnv) passPickup(t *testing.T, driver string) {
	t.Helper()
	report(t, e.tx, driver, e.pickup)
	if r := report(t, e.tx, driver, offsetM(e.pickup, e.radiusM+100)); r.PassedPickup == nil || !*r.PassedPickup {
		t.Fatalf("report = %+v, want the pickup passed", r)
	}
}

func (e *supplyEnv) tripStatus(t *testing.T, tripID int64) string {
	t.Helper()
	var status string
	if err := e.tx.QueryRow(context.Background(), `SELECT status FROM trips WHERE id = $1`, tripID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func ended(r reportView) bool { return r.TripEnded != nil && *r.TripEnded }

// REQ-070, DD-30: entering the destination before the pickup point is passed does not end the trip.
func TestArrivalBeforePassingThePickupDoesNotEndTheTrip(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)

	if r := report(t, e.tx, driver, e.dest); ended(r) || r.PassedPickup == nil || *r.PassedPickup {
		t.Fatalf("report at the destination = %+v, want not passed and not ended", r)
	}
	if s := e.tripStatus(t, trip); s != "active" {
		t.Errorf("trip status = %s, want active", s)
	}
}

// REQ-070, DD-30: after the pickup point, a report within the arrival radius (50 m) ends the
// trip; one just outside does not. The driver sees the ended trip.
func TestArrivalAfterThePickupEndsTheTrip(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	e.passPickup(t, driver)

	if r := report(t, e.tx, driver, offsetM(e.dest, 55)); ended(r) {
		t.Fatalf("55 m from the destination ended the trip")
	}
	if s := e.tripStatus(t, trip); s != "active" {
		t.Fatalf("trip status = %s after 55 m, want active", s)
	}
	if r := report(t, e.tx, driver, offsetM(e.dest, 45)); !ended(r) {
		t.Fatalf("report 45 m from the destination = %+v, want the trip ended", r)
	}

	w := call(t, e.tx, http.MethodGet, fmt.Sprintf("/api/trips/%d", trip), driver, "")
	wantStatus(t, w, http.StatusOK, "")
	v := decode[tripView](t, w)
	if v.Status != "completed" || v.EndedAt == nil || v.CompletedRides != 0 {
		t.Errorf("trip = status %s ended_at %v completed_rides %d, want completed, set, 0", v.Status, v.EndedAt, v.CompletedRides)
	}
	if l := decode[driverListResp](t, call(t, e.tx, http.MethodGet, "/api/driver/requests", driver, "")); l.TripID != nil {
		t.Errorf("driver requests trip_id = %v, want null after the trip ended", *l.TripID)
	}
	wantStatus(t, call(t, e.tx, http.MethodGet, "/api/driver/trips/current", driver, ""), http.StatusNotFound, "")
	// Later reports are still stored (DD-06) and keep saying the trip is over.
	if r := report(t, e.tx, driver, e.dest); !ended(r) {
		t.Errorf("report after the end = %+v, want trip_ended true", r)
	}
}

// DD-20: the arrival radius is read on every report, so a changed value applies to the next one.
func TestArrivalRadiusIsReadOnEveryReport(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	e.passPickup(t, driver)

	if r := report(t, e.tx, driver, offsetM(e.dest, 80)); ended(r) {
		t.Fatalf("80 m ended the trip with the default 50 m radius")
	}
	mustExec(t, e.tx, `UPDATE system_settings SET value = 100 WHERE key = 'arrival_radius'`)
	if r := report(t, e.tx, driver, offsetM(e.dest, 80)); !ended(r) {
		t.Fatalf("80 m did not end the trip with a 100 m radius")
	}
}

// REQ-067, REQ-055, DD-30: the end of the trip completes the rides still on it, confirmed or
// boarded, each with a service record and the usual data, and frees their seats.
func TestTripEndCompletesConfirmedAndBoardedRides(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
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

	ctx := context.Background()
	for _, id := range []int64{confirmed, boarded.ID} {
		var status string
		var completed, records int
		if err := e.tx.QueryRow(ctx, `
			SELECT q.status, (q.completed_at IS NOT NULL)::int, (SELECT count(*) FROM service_records s WHERE s.request_id = q.id AND s.trip_id = $2)
			  FROM ride_requests q WHERE q.id = $1`, id, trip).Scan(&status, &completed, &records); err != nil {
			t.Fatal(err)
		}
		if status != reqCompleted || completed != 1 || records != 1 {
			t.Errorf("request %d: status %s completed_at set %d service records %d, want completed, 1, 1", id, status, completed, records)
		}
	}
	if held, conf := e.seats(t, trip); held != 0 || conf != 0 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/0", held, conf)
	}
	var profiles int
	if err := e.tx.QueryRow(ctx, `
		SELECT count(*) FROM driver_profiles p JOIN trips t ON t.driver_id = p.user_id WHERE t.id = $1 AND p.capacity IS NOT NULL`, trip).
		Scan(&profiles); err != nil {
		t.Fatal(err)
	}
	if profiles != 1 {
		t.Errorf("driver usual data was not recomputed")
	}
	if v := decode[tripView](t, call(t, e.tx, http.MethodGet, fmt.Sprintf("/api/trips/%d", trip), driver, "")); v.CompletedRides != 2 {
		t.Errorf("completed_rides = %d, want 2", v.CompletedRides)
	}
	if s := e.status(t, confirmed); s.Status != reqCompleted || s.CompletedAt == nil {
		t.Errorf("passenger sees %+v, want completed", s.requestResp)
	}
}

// REQ-050, DD-30: a request still waiting for the driver whose trip ends moves to the next car.
func TestTripEndReassignsAWaitingRequest(t *testing.T) {
	e := newSupplyEnv(t)
	first := e.addTrip(t, tripSpec{northM: 500})
	second := e.addTrip(t, tripSpec{northM: 2000})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, first)

	driver := e.driverToken(t, first)
	e.passPickup(t, driver)
	if rep := report(t, e.tx, driver, e.dest); !ended(rep) {
		t.Fatalf("arrival did not end the trip")
	}

	got := e.status(t, r.ID)
	assigned(t, got.requestResp, second)
	if got.ReassignedCount != 1 {
		t.Errorf("reassigned_count = %d, want 1", got.ReassignedCount)
	}
	if o := e.outcomes(t, r.ID); o[1] != "trip_ended" || o[2] != "" {
		t.Errorf("outcomes = %v, want rank 1 trip_ended and rank 2 open", o)
	}
	if held, _ := e.seats(t, first); held != 0 {
		t.Errorf("ended trip still holds %d seats", held)
	}
	if held, _ := e.seats(t, second); held != 1 {
		t.Errorf("next car holds %d seats, want 1", held)
	}
}

// REQ-050: with no other car the waiting request ends as no_match.
func TestTripEndWithoutAnotherCarIsNoMatch(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)

	driver := e.driverToken(t, trip)
	e.passPickup(t, driver)
	report(t, e.tx, driver, e.dest)

	if got := e.status(t, r.ID); got.Status != reqNoMatch || got.TripID != nil {
		t.Errorf("request = %+v, want no_match without a trip", got.requestResp)
	}
	if held, _ := e.seats(t, trip); held != 0 {
		t.Errorf("ended trip still holds %d seats", held)
	}
}
