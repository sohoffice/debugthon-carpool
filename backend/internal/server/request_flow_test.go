package server

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type statusResp struct {
	requestResp
	BoardedAt       *time.Time   `json:"boarded_at"`
	CompletedAt     *time.Time   `json:"completed_at"`
	ReassignedCount int          `json:"reassigned_count"`
	PickupPoint     *pickupPoint `json:"pickup_point"`
	Vehicle         *vehicleView `json:"vehicle"`
	ETAS            *int         `json:"eta_s"`
	Trip            *tripView    `json:"trip"`
}

type driverListResp struct {
	TripID  *int64 `json:"trip_id"`
	Pending []struct {
		ID                 int64       `json:"id"`
		Status             string      `json:"status"`
		PassengerName      string      `json:"passenger_name"`
		PickupPoint        pickupPoint `json:"pickup_point"`
		Dropoff            dropoffView `json:"dropoff"`
		ResponseDeadlineAt *time.Time  `json:"response_deadline_at"`
	} `json:"pending"`
	Passengers []struct {
		ID      int64       `json:"id"`
		Status  string      `json:"status"`
		Boarded bool        `json:"boarded"`
		Dropoff dropoffView `json:"dropoff"`
	} `json:"passengers"`
}

// driverToken is the bearer token of the trip's driver.
func (e *supplyEnv) driverToken(t *testing.T, tripID int64) string {
	t.Helper()
	var name string
	if err := e.tx.QueryRow(context.Background(), `SELECT u.username FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.id = $1`, tripID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return roleDriver + ":" + name
}

func (e *supplyEnv) do(t *testing.T, method, path, token string, want int) statusResp {
	t.Helper()
	w := call(t, e.tx, method, path, token, "")
	wantStatus(t, w, want, "")
	if want >= 300 {
		return statusResp{}
	}
	return decode[statusResp](t, w)
}

func (e *supplyEnv) status(t *testing.T, id int64) statusResp {
	t.Helper()
	return e.do(t, http.MethodGet, fmt.Sprintf("/api/passenger/requests/%d", id), e.token, http.StatusOK)
}

// answer posts a driver action (accept, decline, board, complete) on a request.
func (e *supplyEnv) answer(t *testing.T, action string, id int64, token string, want int) statusResp {
	t.Helper()
	return e.do(t, http.MethodPost, fmt.Sprintf("/api/driver/requests/%d/%s", id, action), token, want)
}

// passengerAct posts a passenger action (board, complete) on a request.
func (e *supplyEnv) passengerAct(t *testing.T, action string, id int64, token string, want int) statusResp {
	t.Helper()
	return e.do(t, http.MethodPost, fmt.Sprintf("/api/passenger/requests/%d/%s", id, action), token, want)
}

func (e *supplyEnv) outcomes(t *testing.T, id int64) map[int]string {
	t.Helper()
	rows, err := e.tx.Query(context.Background(), `SELECT rank, COALESCE(outcome, '') FROM request_candidates WHERE request_id = $1`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[int]string{}
	for rows.Next() {
		var rank int
		var o string
		if err := rows.Scan(&rank, &o); err != nil {
			t.Fatal(err)
		}
		out[rank] = o
	}
	return out
}

// overdue moves a waiting request's deadline into the past, as if the time limit had run out.
func (e *supplyEnv) overdue(t *testing.T, id int64) {
	t.Helper()
	mustExec(t, e.tx, `UPDATE ride_requests SET response_deadline_at = now() - interval '1 second' WHERE id = $1`, id)
}

func assigned(t *testing.T, r requestResp, trip int64) {
	t.Helper()
	if r.Status != reqWaitingDriver || r.TripID == nil || *r.TripID != trip {
		t.Fatalf("request = %+v, want waiting on trip %d", r, trip)
	}
}

// confirmedRide submits a request to a fresh car and has the driver accept it.
func (e *supplyEnv) confirmedRide(t *testing.T) (trip int64, driver string, id int64) {
	t.Helper()
	trip = e.addTrip(t, tripSpec{})
	driver = e.driverToken(t, trip)
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)
	e.answer(t, "accept", r.ID, driver, http.StatusOK)
	return trip, driver, r.ID
}

// REQ-049: the driver sees the request with the pickup point and the drop-off.
func TestDriverListsPendingRequestsWithPickupAndDropoff(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)

	w := call(t, e.tx, http.MethodGet, "/api/driver/requests", driver, "")
	wantStatus(t, w, http.StatusOK, "")
	if l := decode[driverListResp](t, w); len(l.Pending) != 0 || len(l.Passengers) != 0 {
		t.Fatalf("list = %+v, want nothing before any request", l)
	}

	r := e.submit(t, e.near(), nil)
	w = call(t, e.tx, http.MethodGet, "/api/driver/requests", driver, "")
	wantStatus(t, w, http.StatusOK, "")
	l := decode[driverListResp](t, w)
	if l.TripID == nil || *l.TripID != trip || len(l.Pending) != 1 || len(l.Passengers) != 0 {
		t.Fatalf("list = %+v, want one pending request on trip %d", l, trip)
	}
	p := l.Pending[0]
	if p.ID != r.ID || p.PickupPoint.ID != e.pickupID || p.ResponseDeadlineAt == nil || p.PassengerName == "" {
		t.Errorf("pending = %+v, want request %d at pickup %d with a deadline", p, r.ID, e.pickupID)
	}
	if p.Dropoff.Name == "" || p.Dropoff.Lat == 0 {
		t.Errorf("dropoff = %+v, want a named drop-off", p.Dropoff)
	}

	// Another driver sees nothing of it; a request that is answered leaves the pending list.
	other := e.driverToken(t, e.addTrip(t, tripSpec{}))
	w = call(t, e.tx, http.MethodGet, "/api/driver/requests", other, "")
	if l := decode[driverListResp](t, w); len(l.Pending) != 0 {
		t.Errorf("another driver sees %+v", l.Pending)
	}
	e.answer(t, "accept", r.ID, driver, http.StatusOK)
	w = call(t, e.tx, http.MethodGet, "/api/driver/requests", driver, "")
	l = decode[driverListResp](t, w)
	if len(l.Pending) != 0 || len(l.Passengers) != 1 || l.Passengers[0].Boarded {
		t.Errorf("list after accept = %+v, want one confirmed passenger, not boarded", l)
	}
}

// REQ-049, DD-12, DD-25: accepting turns the held seat into a confirmed one.
func TestDriverAcceptConfirmsSeatAndLinksTheActivity(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	act := declare(t, e.tx, e.token)
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)

	got := e.answer(t, "accept", r.ID, driver, http.StatusOK)
	if got.Status != reqConfirmed || got.ConfirmedAt == nil || got.ResponseDeadlineAt != nil {
		t.Fatalf("after accept = %+v, want confirmed with no deadline", got.requestResp)
	}
	if held, confirmed := e.seats(t, trip); held != 0 || confirmed != 1 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/1", held, confirmed)
	}
	if o := e.outcomes(t, r.ID); o[1] != "accepted" {
		t.Errorf("candidate outcomes = %v, want rank 1 accepted", o)
	}
	var linked *int64
	if err := e.tx.QueryRow(context.Background(), `SELECT trip_id FROM activities WHERE id = $1`, act.ID).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked == nil || *linked != trip {
		t.Errorf("passenger activity trip = %v, want %d", linked, trip)
	}
	// Answering twice is refused, and changes nothing.
	e.answer(t, "accept", r.ID, driver, http.StatusConflict)
	e.answer(t, "decline", r.ID, driver, http.StatusConflict)
	if held, confirmed := e.seats(t, trip); held != 0 || confirmed != 1 {
		t.Errorf("seats after refused answers = %d/%d, want 0/1", held, confirmed)
	}
}

func TestRequestActionsAreLimitedToTheirParties(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	otherDriver := e.driverToken(t, e.addTrip(t, tripSpec{northM: 3000}))
	_, otherPassenger := newUser(t, e.tx, rolePassenger)
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)

	for _, action := range []string{"accept", "decline", "board", "complete"} {
		path := fmt.Sprintf("/api/driver/requests/%d/%s", r.ID, action)
		wantStatus(t, call(t, e.tx, http.MethodPost, path, otherDriver, ""), http.StatusNotFound, "not_found")
		wantStatus(t, call(t, e.tx, http.MethodPost, path, e.token, ""), http.StatusForbidden, "forbidden")
		wantStatus(t, call(t, e.tx, http.MethodPost, path, "", ""), http.StatusUnauthorized, "")
	}
	for _, action := range []string{"board", "complete"} {
		path := fmt.Sprintf("/api/passenger/requests/%d/%s", r.ID, action)
		wantStatus(t, call(t, e.tx, http.MethodPost, path, otherPassenger, ""), http.StatusNotFound, "not_found")
		wantStatus(t, call(t, e.tx, http.MethodPost, path, driver, ""), http.StatusForbidden, "forbidden")
	}
	wantStatus(t, call(t, e.tx, http.MethodGet, fmt.Sprintf("/api/passenger/requests/%d", r.ID), otherPassenger, ""), http.StatusNotFound, "not_found")
	wantStatus(t, call(t, e.tx, http.MethodGet, "/api/passenger/requests/999999999", e.token, ""), http.StatusNotFound, "not_found")
	wantStatus(t, call(t, e.tx, http.MethodGet, "/api/driver/requests", e.token, ""), http.StatusForbidden, "forbidden")
	wantStatus(t, call(t, e.tx, http.MethodGet, "/api/driver/requests", "", ""), http.StatusUnauthorized, "")
	if got := e.status(t, r.ID); got.Status != reqWaitingDriver {
		t.Errorf("status = %s after refused actions, want waiting_driver", got.Status)
	}
}

// REQ-050: a decline hands the request to the next ranked car and frees the seat.
func TestDeclineReassignsToTheNextCar(t *testing.T) {
	e := newSupplyEnv(t)
	first := e.addTrip(t, tripSpec{northM: 500})
	second := e.addTrip(t, tripSpec{northM: 2000})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, first)

	got := e.answer(t, "decline", r.ID, e.driverToken(t, first), http.StatusOK)
	assigned(t, got.requestResp, second)
	if got.ResponseDeadlineAt == nil || !got.ResponseDeadlineAt.After(time.Now()) {
		t.Errorf("deadline = %v, want a fresh one in the future", got.ResponseDeadlineAt)
	}
	if held, _ := e.seats(t, first); held != 0 {
		t.Errorf("declined car still holds %d seats", held)
	}
	if held, _ := e.seats(t, second); held != 1 {
		t.Errorf("next car holds %d seats, want 1", held)
	}
	if o := e.outcomes(t, r.ID); o[1] != "declined" || o[2] != "" {
		t.Errorf("outcomes = %v, want rank 1 declined and rank 2 open", o)
	}
	if s := e.status(t, r.ID); s.ReassignedCount != 1 {
		t.Errorf("reassigned_count = %d, want 1", s.ReassignedCount)
	}
	// The declined driver no longer owns the request.
	e.answer(t, "accept", r.ID, e.driverToken(t, first), http.StatusNotFound)
	e.answer(t, "accept", r.ID, e.driverToken(t, second), http.StatusOK)
}

// Acceptance: consecutive declines until no car is left.
func TestConsecutiveDeclinesEndInNoMatch(t *testing.T) {
	e := newSupplyEnv(t)
	trips := []int64{e.addTrip(t, tripSpec{northM: 500}), e.addTrip(t, tripSpec{northM: 1500}), e.addTrip(t, tripSpec{northM: 2500})}
	r := e.submit(t, e.near(), nil)
	for i, trip := range trips {
		got := e.status(t, r.ID)
		assigned(t, got.requestResp, trip)
		e.answer(t, "decline", r.ID, e.driverToken(t, trip), http.StatusOK)
		if held, _ := e.seats(t, trip); held != 0 {
			t.Errorf("car %d still holds a seat after declining", i)
		}
	}
	got := e.status(t, r.ID)
	if got.Status != reqNoMatch || got.TripID != nil || got.ResponseDeadlineAt != nil || got.ReassignedCount != 3 {
		t.Fatalf("request = %+v, want no_match, no trip, no deadline, 3 reassignments", got)
	}
	if got.Reason == nil || *got.Reason != "no_match" || got.Message == nil {
		t.Errorf("reason/message = %v/%v, want the no-car notice", got.Reason, got.Message)
	}
	if o := e.outcomes(t, r.ID); o[1] != "declined" || o[2] != "declined" || o[3] != "declined" {
		t.Errorf("outcomes = %v, want all declined", o)
	}
	// A request with no car is over: the passenger may ask again, nothing is current.
	w := call(t, e.tx, http.MethodGet, "/api/passenger/requests/current", e.token, "")
	wantStatus(t, w, http.StatusOK, "")
	if cur := decode[struct {
		Request *statusResp `json:"request"`
	}](t, w); cur.Request != nil {
		t.Errorf("current = %+v, want none", cur.Request)
	}
}

// DD-13: the backend times a waiting request out and reassigns it.
func TestTimeoutReassignsAndOnlyWhenDue(t *testing.T) {
	e := newSupplyEnv(t)
	first := e.addTrip(t, tripSpec{northM: 500})
	second := e.addTrip(t, tripSpec{northM: 2000})
	r := e.submit(t, e.near(), nil)
	ctx := context.Background()

	// Before the deadline: nothing moves.
	if n, err := SweepTimeouts(ctx, e.tx); err != nil || n != 0 {
		t.Fatalf("sweep before the deadline = %d, %v, want 0", n, err)
	}
	assigned(t, e.status(t, r.ID).requestResp, first)

	// The time limit comes from system_settings on every assignment (DD-20).
	mustExec(t, e.tx, `UPDATE system_settings SET value = 30 WHERE key = 'driver_confirm_timeout'`)
	e.overdue(t, r.ID)
	if n, err := SweepTimeouts(ctx, e.tx); err != nil || n != 1 {
		t.Fatalf("sweep after the deadline = %d, %v, want 1", n, err)
	}
	got := e.status(t, r.ID)
	assigned(t, got.requestResp, second)
	if d := time.Until(*got.ResponseDeadlineAt); d < 20*time.Second || d > 31*time.Second {
		t.Errorf("new deadline in %v, want about the 30 s setting", d)
	}
	if held, _ := e.seats(t, first); held != 0 {
		t.Errorf("timed-out car still holds %d seats", held)
	}
	if o := e.outcomes(t, r.ID); o[1] != "timed_out" {
		t.Errorf("outcomes = %v, want rank 1 timed_out", o)
	}

	// Run out of cars: no_match.
	e.overdue(t, r.ID)
	if _, err := SweepTimeouts(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if got := e.status(t, r.ID); got.Status != reqNoMatch || got.ReassignedCount != 2 {
		t.Errorf("request = %+v, want no_match after two timeouts", got.requestResp)
	}
	for _, trip := range []int64{first, second} {
		if held, _ := e.seats(t, trip); held != 0 {
			t.Errorf("trip %d holds %d seats at the end", trip, held)
		}
	}
	// Idempotent: a finished request is not touched again.
	if n, _ := SweepTimeouts(ctx, e.tx); n != 0 {
		t.Errorf("sweep over a finished request moved %d", n)
	}
}

// A timeout after the driver already accepted changes nothing, and an answer after the timeout
// is refused: whichever comes first wins.
func TestTimeoutAndAnswerResolveToOneOutcome(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	accepted := e.submit(t, e.near(), nil)
	e.answer(t, "accept", accepted.ID, driver, http.StatusOK)
	e.overdue(t, accepted.ID) // late clock: still not waiting
	if n, _ := SweepTimeouts(context.Background(), e.tx); n != 0 {
		t.Errorf("sweep moved %d confirmed requests", n)
	}
	if got := e.status(t, accepted.ID); got.Status != reqConfirmed {
		t.Errorf("status = %s, want confirmed", got.Status)
	}

	_, token2 := newUser(t, e.tx, rolePassenger)
	late := e.submitAs(t, token2, e.body(e.near(), ""))
	e.overdue(t, late.ID)
	assigned(t, late, trip)
	if _, err := SweepTimeouts(context.Background(), e.tx); err != nil {
		t.Fatal(err)
	}
	e.answer(t, "accept", late.ID, driver, http.StatusNotFound) // timed out with no other car: no trip any more
}

// A car that filled up (or ended) since the ranking is skipped; its outcome stays empty.
func TestReassignSkipsACarThatNoLongerHasASeat(t *testing.T) {
	e := newSupplyEnv(t)
	first := e.addTrip(t, tripSpec{northM: 500})
	full := e.addTrip(t, tripSpec{northM: 1500})
	third := e.addTrip(t, tripSpec{northM: 2500})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, first)
	mustExec(t, e.tx, `UPDATE trips SET seats_confirmed = capacity WHERE id = $1`, full)

	got := e.answer(t, "decline", r.ID, e.driverToken(t, first), http.StatusOK)
	assigned(t, got.requestResp, third)
	if o := e.outcomes(t, r.ID); o[1] != "declined" || o[2] != "" || o[3] != "" {
		t.Errorf("outcomes = %v, want only rank 1 decided", o)
	}
	// The next decline must continue after the skipped car, not return to it.
	mustExec(t, e.tx, `UPDATE trips SET seats_confirmed = 0 WHERE id = $1`, full)
	got = e.answer(t, "decline", r.ID, e.driverToken(t, third), http.StatusOK)
	if got.Status != reqNoMatch {
		t.Errorf("status = %s, want no_match: the candidates before the declined one are not revisited", got.Status)
	}
}

// REQ-022: a car that auto-accepts confirms a reassigned request at once.
func TestReassignToAnAutoAcceptCarConfirms(t *testing.T) {
	e := newSupplyEnv(t)
	first := e.addTrip(t, tripSpec{northM: 500})
	second := e.addTrip(t, tripSpec{northM: 2000})
	mustExec(t, e.tx, `UPDATE trips SET auto_accept = true WHERE id = $1`, second)
	act := declare(t, e.tx, e.token)
	r := e.submit(t, e.near(), nil)
	assigned(t, r, first)

	got := e.answer(t, "decline", r.ID, e.driverToken(t, first), http.StatusOK)
	if got.Status != reqConfirmed || got.TripID == nil || *got.TripID != second {
		t.Fatalf("request = %+v, want confirmed on trip %d", got.requestResp, second)
	}
	if held, confirmed := e.seats(t, second); held != 0 || confirmed != 1 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/1", held, confirmed)
	}
	var linked *int64
	if err := e.tx.QueryRow(context.Background(), `SELECT trip_id FROM activities WHERE id = $1`, act.ID).Scan(&linked); err != nil || linked == nil || *linked != second {
		t.Errorf("activity trip = %v (%v), want %d", linked, err, second)
	}
}

// REQ-047: the "relaxed" mark follows the car the request is on now.
func TestReassignRecomputesRelaxed(t *testing.T) {
	e := newSupplyEnv(t)
	var tag int64
	if err := e.tx.QueryRow(context.Background(), `SELECT id FROM tags ORDER BY id LIMIT 1`).Scan(&tag); err != nil {
		t.Fatal(err)
	}
	first := e.addTrip(t, tripSpec{northM: 500, tagIDs: []int64{tag}})
	second := e.addTrip(t, tripSpec{northM: 2000})
	extra := fmt.Sprintf(`"tag_filters":[{"tag_id":%d,"intent":"preferred"}]`, tag)
	r := e.submit(t, e.near(), &extra)
	assigned(t, r, first)
	if r.Relaxed {
		t.Fatal("the first car has the tag, the request should not be relaxed")
	}
	got := e.answer(t, "decline", r.ID, e.driverToken(t, first), http.StatusOK)
	assigned(t, got.requestResp, second)
	if !got.Relaxed {
		t.Error("the second car lacks the preferred tag, want relaxed")
	}
}

// REQ-052, DD-27: the confirmed request carries what the passenger needs; boarding removes it.
func TestPassengerStatusByPhase(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `INSERT INTO vehicles (user_id, plate, description) SELECT driver_id, 'TST-0001', '測試車' FROM trips WHERE id = $1`, trip)
	driver := e.driverToken(t, trip)
	r := e.submit(t, e.near(), nil)

	waiting := e.status(t, r.ID)
	if waiting.Status != reqWaitingDriver || waiting.PickupPoint != nil || waiting.Vehicle != nil || waiting.ETAS != nil || waiting.Trip != nil {
		t.Errorf("waiting = %+v, want no pickup, vehicle, ETA or route yet", waiting)
	}

	e.answer(t, "accept", r.ID, driver, http.StatusOK)
	conf := e.status(t, r.ID)
	if conf.Status != reqConfirmed || conf.PickupPoint == nil || conf.PickupPoint.ID != e.pickupID {
		t.Fatalf("confirmed = %+v, want the pickup point", conf)
	}
	if conf.Vehicle == nil || conf.Vehicle.Plate != "TST-0001" || conf.Vehicle.Description != "測試車" {
		t.Errorf("vehicle = %+v, want the driver's car", conf.Vehicle)
	}
	if conf.ETAS == nil || *conf.ETAS <= 0 {
		t.Errorf("eta_s = %v, want a positive ETA", conf.ETAS)
	}
	if conf.Trip == nil || conf.Trip.ID != trip || conf.Trip.Route == nil {
		t.Errorf("trip = %+v, want the trip with its route", conf.Trip)
	}
	w := call(t, e.tx, http.MethodGet, "/api/passenger/requests/current", e.token, "")
	wantStatus(t, w, http.StatusOK, "")
	if cur := decode[struct {
		Request *statusResp `json:"request"`
	}](t, w); cur.Request == nil || cur.Request.ID != r.ID {
		t.Errorf("current = %+v, want request %d (REQ-069)", cur.Request, r.ID)
	}

	e.passengerAct(t, "board", r.ID, e.token, http.StatusOK)
	boarded := e.status(t, r.ID)
	if boarded.Status != reqBoarded || boarded.BoardedAt == nil {
		t.Fatalf("boarded = %+v", boarded)
	}
	if boarded.PickupPoint != nil || boarded.Vehicle != nil || boarded.ETAS != nil || boarded.Trip != nil {
		t.Errorf("boarded still carries pickup %v, vehicle %v, eta %v, trip %v", boarded.PickupPoint, boarded.Vehicle, boarded.ETAS, boarded.Trip)
	}
	w = call(t, e.tx, http.MethodGet, "/api/passenger/requests/current", e.token, "")
	if cur := decode[struct {
		Request *statusResp `json:"request"`
	}](t, w); cur.Request == nil || cur.Request.Status != reqBoarded {
		t.Errorf("current while boarded = %+v, want the boarded request", cur.Request)
	}
}

// DD-27: either side marks boarding, once; the seat count does not change.
func TestBoardingIsMarkedOnceByEitherSide(t *testing.T) {
	for _, first := range []string{"passenger", "driver"} {
		t.Run(first+" first", func(t *testing.T) {
			e := newSupplyEnv(t)
			trip, driver, id := e.confirmedRide(t)
			board := func(who string) statusResp {
				if who == "passenger" {
					return e.passengerAct(t, "board", id, e.token, http.StatusOK)
				}
				return e.answer(t, "board", id, driver, http.StatusOK)
			}
			second := map[string]string{"passenger": "driver", "driver": "passenger"}[first]

			a := board(first)
			if a.Status != reqBoarded || a.BoardedAt == nil {
				t.Fatalf("after %s boards = %+v", first, a)
			}
			b := board(second) // the latecomer gets the same answer
			if b.Status != reqBoarded || !b.BoardedAt.Equal(*a.BoardedAt) {
				t.Errorf("after %s boards too = %+v, want the first boarded_at %v", second, b, a.BoardedAt)
			}
			if _, confirmed := e.seats(t, trip); confirmed != 1 {
				t.Errorf("seats_confirmed = %d, want 1 (boarding keeps the seat)", confirmed)
			}
			w := call(t, e.tx, http.MethodGet, "/api/driver/requests", driver, "")
			l := decode[driverListResp](t, w)
			if len(l.Passengers) != 1 || !l.Passengers[0].Boarded || l.Passengers[0].Status != reqBoarded {
				t.Errorf("driver list = %+v, want the passenger marked boarded", l.Passengers)
			}
		})
	}
}

func TestBoardingNeedsAConfirmedRequest(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)
	e.passengerAct(t, "board", r.ID, e.token, http.StatusConflict)
	e.answer(t, "board", r.ID, e.driverToken(t, trip), http.StatusConflict)
	if got := e.status(t, r.ID); got.Status != reqWaitingDriver || got.BoardedAt != nil {
		t.Errorf("status = %+v, want still waiting", got)
	}
}

// DD-23: completing from confirmed or boarded, by either side, writes one service record.
func TestCompleteFromConfirmedAndBoardedWritesTheServiceRecord(t *testing.T) {
	cases := []struct {
		name   string
		board  bool
		driver bool // who completes
	}{
		{"from confirmed by the passenger", false, false},
		{"from confirmed by the driver", false, true},
		{"from boarded by the passenger", true, false},
		{"from boarded by the driver", true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newSupplyEnv(t)
			trip, driver, id := e.confirmedRide(t)
			var boardedAt *time.Time
			if c.board {
				boardedAt = e.passengerAct(t, "board", id, e.token, http.StatusOK).BoardedAt
			}
			var got statusResp
			if c.driver {
				got = e.answer(t, "complete", id, driver, http.StatusOK)
			} else {
				got = e.passengerAct(t, "complete", id, e.token, http.StatusOK)
			}
			if got.Status != reqCompleted || got.CompletedAt == nil {
				t.Fatalf("after complete = %+v", got)
			}
			if held, confirmed := e.seats(t, trip); held != 0 || confirmed != 0 {
				t.Errorf("seats held/confirmed = %d/%d, want the seat freed", held, confirmed)
			}

			var rec struct {
				trip, driver, passenger, pickup int64
				stop                            *int64
				name                            string
				lat, lng                        float64
				pickedUp                        *time.Time
				completed                       time.Time
			}
			var driverID int64
			if err := e.tx.QueryRow(context.Background(), `SELECT driver_id FROM trips WHERE id = $1`, trip).Scan(&driverID); err != nil {
				t.Fatal(err)
			}
			if err := e.tx.QueryRow(context.Background(), `
				SELECT trip_id, driver_id, passenger_id, pickup_point_id, dropoff_bus_stop_id, dropoff_name, dropoff_lat, dropoff_lng,
				       picked_up_at, completed_at FROM service_records WHERE request_id = $1`, id).
				Scan(&rec.trip, &rec.driver, &rec.passenger, &rec.pickup, &rec.stop, &rec.name, &rec.lat, &rec.lng, &rec.pickedUp, &rec.completed); err != nil {
				t.Fatal(err)
			}
			if rec.trip != trip || rec.driver != driverID || rec.passenger != e.userID || rec.pickup != e.pickupID {
				t.Errorf("record parties = %+v, want trip %d driver %d passenger %d pickup %d", rec, trip, driverID, e.userID, e.pickupID)
			}
			if rec.name == "" || rec.lat == 0 || rec.lng == 0 {
				t.Errorf("record drop-off = %q (%v, %v), want it filled", rec.name, rec.lat, rec.lng)
			}
			if c.board != (rec.pickedUp != nil) || (c.board && !rec.pickedUp.Equal(*boardedAt)) {
				t.Errorf("picked_up_at = %v, want %v", rec.pickedUp, boardedAt)
			}
			if !rec.completed.Equal(*got.CompletedAt) {
				t.Errorf("record completed_at = %v, want %v", rec.completed, got.CompletedAt)
			}

			// The latecomer on the other side is told it is done, and nothing is written twice.
			if c.driver {
				e.passengerAct(t, "complete", id, e.token, http.StatusOK)
			} else {
				e.answer(t, "complete", id, driver, http.StatusOK)
			}
			var n int
			if err := e.tx.QueryRow(context.Background(), `SELECT count(*) FROM service_records WHERE request_id = $1`, id).Scan(&n); err != nil || n != 1 {
				t.Errorf("service records = %d (%v), want 1", n, err)
			}
			if _, confirmed := e.seats(t, trip); confirmed != 0 {
				t.Errorf("seats_confirmed = %d after the second complete, want 0", confirmed)
			}
			// Over: a completed request cannot be boarded, and the passenger has no current one.
			e.passengerAct(t, "board", id, e.token, http.StatusConflict)
		})
	}
}

func TestCompleteNeedsAConfirmedRequest(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)
	e.passengerAct(t, "complete", r.ID, e.token, http.StatusConflict)
	e.answer(t, "complete", r.ID, e.driverToken(t, trip), http.StatusConflict)
	if held, confirmed := e.seats(t, trip); held != 1 || confirmed != 0 {
		t.Errorf("seats held/confirmed = %d/%d, want 1/0", held, confirmed)
	}
}

// Races over committed transactions. The pool connections are real, so the row locks matter.

type flowFixture struct {
	*raceFixture
	pool   *pgxpool.Pool
	driver string
}

func newFlowFixture(t *testing.T) *flowFixture {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	f := newRaceFixture(t, pool)
	return &flowFixture{raceFixture: f, pool: pool, driver: roleDriver + ":" + f.driver.name}
}

func (f *flowFixture) submit(t *testing.T, p raceUser) requestResp {
	t.Helper()
	w := call(t, f.pool, http.MethodPost, "/api/passenger/requests", rolePassenger+":"+p.name,
		fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":%s,"lng":%s},"destination":{"name":"d","lat":%s,"lng":%s},"stop_ids":[%d]}`,
			f.pickup.ID, ftoa(f.pickup.Lat), ftoa(f.pickup.Lng), ftoa(f.dest.Lat), ftoa(f.dest.Lng), f.stopID))
	wantStatus(t, w, http.StatusCreated, "")
	return decode[requestResp](t, w)
}

// both runs two calls at the same moment and returns their responses.
func both(t *testing.T, a, b func() *httpResult) (*httpResult, *httpResult) {
	t.Helper()
	var wg sync.WaitGroup
	var ra, rb *httpResult
	start := make(chan struct{})
	wg.Add(2)
	go func() { defer wg.Done(); <-start; ra = a() }()
	go func() { defer wg.Done(); <-start; rb = b() }()
	close(start)
	wg.Wait()
	return ra, rb
}

type httpResult struct{ code int }

func (f *flowFixture) post(t *testing.T, path, token string) func() *httpResult {
	return func() *httpResult {
		return &httpResult{call(t, f.pool, http.MethodPost, path, token, "").Code}
	}
}

func (f *flowFixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Acceptance: passenger and driver ending the ride at the same time complete it once.
func TestSimultaneousCompletionHappensOnce(t *testing.T) {
	f := newFlowFixture(t)
	p := f.passengers[0]
	r := f.submit(t, p)
	wantStatus(t, call(t, f.pool, http.MethodPost, fmt.Sprintf("/api/driver/requests/%d/accept", r.ID), f.driver, ""), http.StatusOK, "")

	a, b := both(t,
		f.post(t, fmt.Sprintf("/api/passenger/requests/%d/complete", r.ID), rolePassenger+":"+p.name),
		f.post(t, fmt.Sprintf("/api/driver/requests/%d/complete", r.ID), f.driver))
	if a.code != http.StatusOK || b.code != http.StatusOK {
		t.Errorf("responses %d, %d, want both 200 (the loser sees it done)", a.code, b.code)
	}
	if n := f.count(t, `SELECT count(*) FROM service_records WHERE request_id = $1`, r.ID); n != 1 {
		t.Errorf("service records = %d, want 1", n)
	}
	if held, confirmed := f.seats(t); held != 0 || confirmed != 0 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/0", held, confirmed)
	}
}

// Acceptance: passenger and driver marking boarding at the same time mark it once.
func TestSimultaneousBoardingHappensOnce(t *testing.T) {
	f := newFlowFixture(t)
	p := f.passengers[0]
	r := f.submit(t, p)
	wantStatus(t, call(t, f.pool, http.MethodPost, fmt.Sprintf("/api/driver/requests/%d/accept", r.ID), f.driver, ""), http.StatusOK, "")

	a, b := both(t,
		f.post(t, fmt.Sprintf("/api/passenger/requests/%d/board", r.ID), rolePassenger+":"+p.name),
		f.post(t, fmt.Sprintf("/api/driver/requests/%d/board", r.ID), f.driver))
	if a.code != http.StatusOK || b.code != http.StatusOK {
		t.Errorf("responses %d, %d, want both 200", a.code, b.code)
	}
	if n := f.count(t, `SELECT count(*) FROM ride_requests WHERE id = $1 AND status = 'boarded' AND boarded_at IS NOT NULL`, r.ID); n != 1 {
		t.Errorf("boarded rows = %d, want 1", n)
	}
	if held, confirmed := f.seats(t); held != 0 || confirmed != 1 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/1", held, confirmed)
	}
}

// DD-13: the driver's answer and the timeout racing resolve to exactly one outcome, and the
// seat accounting agrees with it.
func TestAnswerRacingTheTimeoutResolvesToOneOutcome(t *testing.T) {
	f := newFlowFixture(t)
	r := f.submit(t, f.passengers[0])
	if _, err := f.pool.Exec(context.Background(), `UPDATE ride_requests SET response_deadline_at = now() - interval '1 second' WHERE id = $1`, r.ID); err != nil {
		t.Fatal(err)
	}

	var accept *httpResult
	var swept int
	var wg sync.WaitGroup
	start := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		accept = f.post(t, fmt.Sprintf("/api/driver/requests/%d/accept", r.ID), f.driver)()
	}()
	go func() {
		defer wg.Done()
		<-start
		var err error
		if swept, err = SweepTimeouts(context.Background(), f.pool); err != nil {
			t.Error(err)
		}
	}()
	close(start)
	wg.Wait()

	var status string
	if err := f.pool.QueryRow(context.Background(), `SELECT status FROM ride_requests WHERE id = $1`, r.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	held, confirmed := f.seats(t)
	switch status {
	case reqConfirmed:
		if accept.code != http.StatusOK || held != 0 || confirmed != 1 {
			t.Errorf("confirmed, but accept = %d and seats = %d/%d", accept.code, held, confirmed)
		}
	case reqNoMatch:
		if accept.code == http.StatusOK || swept < 1 || held != 0 || confirmed != 0 {
			t.Errorf("timed out, but accept = %d, swept %d, seats = %d/%d", accept.code, swept, held, confirmed)
		}
	default:
		t.Errorf("status = %s, want confirmed or no_match", status)
	}
}
