package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRequestTransitions(t *testing.T) {
	statuses := []string{reqSubmitted, reqRejected, reqWaitingDriver, reqNoMatch, reqConfirmed, reqCompleted}
	allowed := map[[2]string]bool{
		{reqSubmitted, reqRejected}:          true, // beyond the submit distance
		{reqSubmitted, reqWaitingDriver}:     true, // assigned to the first ranked car
		{reqSubmitted, reqNoMatch}:           true, // no car passes screening
		{reqWaitingDriver, reqConfirmed}:     true, // driver confirms / auto-accept
		{reqWaitingDriver, reqWaitingDriver}: true, // declined or timed out: next car
		{reqWaitingDriver, reqNoMatch}:       true, // no car left in the ranking
		{reqConfirmed, reqCompleted}:         true,
	}
	for _, from := range statuses {
		for _, to := range statuses {
			if got := canTransition(from, to); got != allowed[[2]string{from, to}] {
				t.Errorf("canTransition(%s, %s) = %v, want %v", from, to, got, !got)
			}
		}
	}
}

func TestTransitionRefusesForbiddenAndStaleMoves(t *testing.T) {
	e := newSupplyEnv(t)
	r := e.submit(t, e.near(), nil)
	ctx := context.Background()
	if err := transition(ctx, e.tx, r.ID, reqRejected, reqConfirmed, ""); err == nil {
		t.Error("rejected -> confirmed was allowed")
	}
	// The request is waiting_driver or no_match, not submitted any more: a stale move changes nothing.
	if err := transition(ctx, e.tx, r.ID, reqSubmitted, reqRejected, ""); err == nil {
		t.Error("a request that left submitted was moved from submitted")
	}
}

type requestResp struct {
	ID                 int64      `json:"id"`
	Status             string     `json:"status"`
	Reason             *string    `json:"reason"`
	Message            *string    `json:"message"`
	Relaxed            bool       `json:"relaxed"`
	PickupPointID      int64      `json:"pickup_point_id"`
	SubmittedLat       float64    `json:"submitted_lat"`
	SubmittedLng       float64    `json:"submitted_lng"`
	TripID             *int64     `json:"trip_id"`
	DropoffBusStopID   *int64     `json:"dropoff_bus_stop_id"`
	ResponseDeadlineAt *time.Time `json:"response_deadline_at"`
	ConfirmedAt        *time.Time `json:"confirmed_at"`
}

// near is the passenger standing at the pickup point.
func (e *supplyEnv) near() latLng { return e.pickup }

// body builds a submission from the env's passenger; extra is spliced in as further JSON members.
func (e *supplyEnv) body(at latLng, extra string) string {
	b := fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":%s,"lng":%s},"destination":{"name":"目的地","lat":%s,"lng":%s},"stop_ids":[%d]`,
		e.pickupID, ftoa(at.Lat), ftoa(at.Lng), ftoa(e.dest.Lat), ftoa(e.dest.Lng), e.stopID)
	if extra != "" {
		b += "," + extra
	}
	return b + "}"
}

// submit sends a request as the env's passenger and expects 201.
func (e *supplyEnv) submit(t *testing.T, at latLng, extra *string) requestResp {
	t.Helper()
	x := ""
	if extra != nil {
		x = *extra
	}
	return e.submitAs(t, e.token, e.body(at, x))
}

func (e *supplyEnv) submitAs(t *testing.T, token, body string) requestResp {
	t.Helper()
	w := call(t, e.tx, http.MethodPost, "/api/passenger/requests", token, body)
	wantStatus(t, w, http.StatusCreated, "")
	return decode[requestResp](t, w)
}

func (e *supplyEnv) seats(t *testing.T, tripID int64) (held, confirmed int) {
	t.Helper()
	if err := e.tx.QueryRow(context.Background(), `SELECT seats_held, seats_confirmed FROM trips WHERE id = $1`, tripID).
		Scan(&held, &confirmed); err != nil {
		t.Fatal(err)
	}
	return
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func TestSubmitRejectedBeyondSubmitDistance(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})

	// REQ-034, boundary on both sides of the 200 m default.
	inside := e.submit(t, offsetM(e.pickup, 190), nil)
	if inside.Status == reqRejected {
		t.Fatalf("190 m from the pickup point was rejected: %+v", inside)
	}
	outside := e.submit(t, offsetM(e.pickup, 210), nil)
	if outside.Status != reqRejected || str(outside.Reason) != "too_far" || str(outside.Message) == "" {
		t.Fatalf("210 m away = %+v, want rejected with reason too_far and a message", outside)
	}
	if outside.TripID != nil {
		t.Errorf("a rejected request got trip %d", *outside.TripID)
	}
	// The position the passenger sent is kept on the request (DD-25).
	var lat, lng float64
	var status string
	if err := e.tx.QueryRow(context.Background(), `SELECT status, submitted_lat, submitted_lng FROM ride_requests WHERE id = $1`, outside.ID).
		Scan(&status, &lat, &lng); err != nil {
		t.Fatal(err)
	}
	want := offsetM(e.pickup, 210)
	if status != reqRejected || lat != want.Lat || lng != want.Lng {
		t.Errorf("stored = %s (%v, %v), want rejected at %+v", status, lat, lng, want)
	}
	if held, _ := e.seats(t, trip); held != 1 { // only the accepted 190 m request holds a seat
		t.Errorf("seats_held = %d, want 1", held)
	}
}

func TestSubmitDistanceFollowsTheSetting(t *testing.T) {
	e := newSupplyEnv(t)
	e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `UPDATE system_settings SET value = 100 WHERE key = 'submit_distance'`)
	if r := e.submit(t, offsetM(e.pickup, 90), nil); r.Status == reqRejected {
		t.Errorf("90 m with a 100 m limit: %+v", r)
	}
	if r := e.submit(t, offsetM(e.pickup, 110), nil); r.Status != reqRejected {
		t.Errorf("110 m with a 100 m limit: %+v", r)
	}
}

func TestSubmitAssignsTheFirstRankedCarAndHoldsASeat(t *testing.T) {
	e := newSupplyEnv(t)
	far := e.addTrip(t, tripSpec{northM: 2000})
	near := e.addTrip(t, tripSpec{northM: 500})
	mustExec(t, e.tx, `UPDATE system_settings SET value = 90 WHERE key = 'driver_confirm_timeout'`)

	before := time.Now()
	r := e.submit(t, e.near(), nil)
	if r.Status != reqWaitingDriver || r.TripID == nil || *r.TripID != near {
		t.Fatalf("request = %+v, want waiting_driver on the nearer trip %d", r, near)
	}
	if held, confirmed := e.seats(t, near); held != 1 || confirmed != 0 {
		t.Errorf("near seats held/confirmed = %d/%d, want 1/0", held, confirmed)
	}
	if held, _ := e.seats(t, far); held != 0 {
		t.Errorf("the second car also holds %d seats", held)
	}
	// The confirmation time limit comes from the setting.
	if r.ResponseDeadlineAt == nil || r.ResponseDeadlineAt.Sub(before) < 89*time.Second || r.ResponseDeadlineAt.Sub(before) > 92*time.Second {
		t.Errorf("response_deadline_at = %v, want about 90 s after %v", r.ResponseDeadlineAt, before)
	}
	// The whole ranking is kept for reassignment (T13), nothing decided yet.
	rows, err := e.tx.Query(context.Background(), `SELECT trip_id, outcome FROM request_candidates WHERE request_id = $1 ORDER BY rank`, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []int64
	for rows.Next() {
		var id int64
		var outcome *string
		if err := rows.Scan(&id, &outcome); err != nil {
			t.Fatal(err)
		}
		if outcome != nil {
			t.Errorf("candidate %d outcome = %s, want none", id, *outcome)
		}
		got = append(got, id)
	}
	if len(got) != 2 || got[0] != near || got[1] != far {
		t.Errorf("candidates = %v, want [%d %d]", got, near, far)
	}
}

func TestSubmitWithNoCarAnswersNoMatch(t *testing.T) {
	e := newSupplyEnv(t)
	e.addTrip(t, tripSpec{northM: 6000}) // beyond the wait limit
	r := e.submit(t, e.near(), nil)
	if r.Status != reqNoMatch || str(r.Reason) != "no_match" || str(r.Message) != "目前沒有可搭的車" || r.TripID != nil {
		t.Fatalf("request = %+v, want no_match with the 目前沒有可搭的車 message and no trip", r)
	}
	var status string
	if err := e.tx.QueryRow(context.Background(), `SELECT status FROM ride_requests WHERE id = $1`, r.ID).Scan(&status); err != nil || status != reqNoMatch {
		t.Errorf("stored status = %q (%v)", status, err)
	}
}

// REQ-048: the last seat goes to the request that came first; the next one skips the full car.
func TestSecondRequestSkipsTheFullCar(t *testing.T) {
	e := newSupplyEnv(t)
	nearOne := e.addTrip(t, tripSpec{northM: 500, capacity: 1})
	farther := e.addTrip(t, tripSpec{northM: 1500})
	_, second := newUser(t, e.tx, rolePassenger)

	first := e.submit(t, e.near(), nil)
	later := e.submitAs(t, second, e.body(e.near(), ""))
	if first.TripID == nil || *first.TripID != nearOne {
		t.Fatalf("first request = %+v, want the near one-seat trip %d", first, nearOne)
	}
	if later.TripID == nil || *later.TripID != farther {
		t.Fatalf("second request = %+v, want the farther trip %d", later, farther)
	}
	if held, _ := e.seats(t, nearOne); held != 1 {
		t.Errorf("near trip holds %d seats, want 1", held)
	}
}

func TestRequestBehindTheLastSeatGetsNoMatch(t *testing.T) {
	e := newSupplyEnv(t)
	e.addTrip(t, tripSpec{capacity: 1})
	_, second := newUser(t, e.tx, rolePassenger)
	if r := e.submit(t, e.near(), nil); r.Status != reqWaitingDriver {
		t.Fatalf("first = %+v", r)
	}
	if r := e.submitAs(t, second, e.body(e.near(), "")); r.Status != reqNoMatch {
		t.Errorf("second for the last seat = %+v, want no_match", r)
	}
}

func TestAutoAcceptConfirmsAndLinksTheActivity(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `UPDATE trips SET auto_accept = true WHERE id = $1`, trip)
	oldAct := declare(t, e.tx, e.token) // an earlier activity must stay unlinked
	newAct := declare(t, e.tx, e.token)

	r := e.submit(t, e.near(), nil)
	if r.Status != reqConfirmed || r.ConfirmedAt == nil || r.ResponseDeadlineAt != nil || r.TripID == nil || *r.TripID != trip {
		t.Fatalf("request = %+v, want confirmed on trip %d at once, no deadline", r, trip)
	}
	if held, confirmed := e.seats(t, trip); held != 0 || confirmed != 1 {
		t.Errorf("seats held/confirmed = %d/%d, want 0/1", held, confirmed)
	}
	var outcome string
	if err := e.tx.QueryRow(context.Background(), `SELECT outcome FROM request_candidates WHERE request_id = $1 AND rank = 1`, r.ID).Scan(&outcome); err != nil || outcome != "accepted" {
		t.Errorf("candidate outcome = %q (%v), want accepted", outcome, err)
	}
	linked := func(id int64) *int64 {
		var tid *int64
		if err := e.tx.QueryRow(context.Background(), `SELECT trip_id FROM activities WHERE id = $1`, id).Scan(&tid); err != nil {
			t.Fatal(err)
		}
		return tid
	}
	if got := linked(newAct.ID); got == nil || *got != trip {
		t.Errorf("latest activity trip = %v, want %d", got, trip)
	}
	if got := linked(oldAct.ID); got != nil {
		t.Errorf("older activity trip = %d, want none", *got)
	}
}

func TestAutoAcceptWithoutAnActivityStillConfirms(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `UPDATE trips SET auto_accept = true WHERE id = $1`, trip)
	if r := e.submit(t, e.near(), nil); r.Status != reqConfirmed {
		t.Errorf("request = %+v, want confirmed", r)
	}
}

func TestAutoAcceptLeavesOtherActivitiesAlone(t *testing.T) {
	tripOf := func(e *supplyEnv, id int64) *int64 {
		var tid *int64
		if err := e.tx.QueryRow(context.Background(), `SELECT trip_id FROM activities WHERE id = $1`, id).Scan(&tid); err != nil {
			t.Fatal(err)
		}
		return tid
	}

	t.Run("latest activity is a driver activity", func(t *testing.T) {
		e := newSupplyEnv(t)
		trip := e.addTrip(t, tripSpec{})
		mustExec(t, e.tx, `UPDATE trips SET auto_accept = true WHERE id = $1`, trip)
		other := e.addTrip(t, tripSpec{}) // the account's own trip as a driver
		var act int64
		if err := e.tx.QueryRow(context.Background(), `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2) RETURNING id`,
			e.userID, other).Scan(&act); err != nil {
			t.Fatal(err)
		}
		r := e.submit(t, e.near(), nil)
		if r.Status != reqConfirmed {
			t.Fatalf("request = %+v, want confirmed", r)
		}
		if got := tripOf(e, act); got == nil || *got != other {
			t.Errorf("driver activity trip = %v, want it left at %d", got, other)
		}
	})

	t.Run("latest passenger activity already belongs to an earlier trip", func(t *testing.T) {
		e := newSupplyEnv(t)
		trip := e.addTrip(t, tripSpec{})
		mustExec(t, e.tx, `UPDATE trips SET auto_accept = true WHERE id = $1`, trip)
		earlier := e.addTrip(t, tripSpec{})
		act := declare(t, e.tx, e.token)
		mustExec(t, e.tx, `UPDATE activities SET trip_id = $2 WHERE id = $1`, act.ID, earlier)
		r := e.submit(t, e.near(), nil)
		if r.Status != reqConfirmed {
			t.Fatalf("request = %+v, want confirmed", r)
		}
		if got := tripOf(e, act.ID); got == nil || *got != earlier {
			t.Errorf("earlier ride's activity trip = %v, want it left at %d", got, earlier)
		}
	})
}

func TestDriverWithoutAutoAcceptKeepsTheRequestWaiting(t *testing.T) {
	e := newSupplyEnv(t)
	trip := e.addTrip(t, tripSpec{})
	r := e.submit(t, e.near(), nil)
	if r.Status != reqWaitingDriver || r.ConfirmedAt != nil {
		t.Fatalf("request = %+v, want waiting_driver", r)
	}
	if held, confirmed := e.seats(t, trip); held != 1 || confirmed != 0 {
		t.Errorf("seats held/confirmed = %d/%d, want 1/0", held, confirmed)
	}
}

func TestRelaxedWhenPreferredTagsAreMissing(t *testing.T) {
	e := newSupplyEnv(t)
	tags := tagIDs(t, e.tx, 2)
	a, b := tags[0], tags[1]
	prefer := func(ids ...int64) *string {
		s := `"tag_filters":[`
		for i, id := range ids {
			if i > 0 {
				s += ","
			}
			s += `{"tag_id":` + strconv.FormatInt(id, 10) + `,"intent":"preferred"}`
		}
		s += "]"
		return &s
	}

	e.addTrip(t, tripSpec{tagIDs: []int64{a}})
	for _, c := range []struct {
		name    string
		extra   *string
		relaxed bool
	}{
		{"no preferred tag asked", nil, false},
		{"every preferred tag carried", prefer(a), false},
		{"one of two preferred tags missing", prefer(a, b), true},
		{"the only preferred tag missing", prefer(b), true},
	} {
		_, tok := newUser(t, e.tx, rolePassenger)
		x := ""
		if c.extra != nil {
			x = *c.extra
		}
		r := e.submitAs(t, tok, e.body(e.near(), x))
		if r.TripID == nil {
			t.Fatalf("%s: not assigned: %+v", c.name, r)
		}
		if r.Relaxed != c.relaxed {
			t.Errorf("%s: relaxed = %v, want %v", c.name, r.Relaxed, c.relaxed)
		}
		var stored bool
		if err := e.tx.QueryRow(context.Background(), `SELECT relaxed FROM ride_requests WHERE id = $1`, r.ID).Scan(&stored); err != nil || stored != c.relaxed {
			t.Errorf("%s: stored relaxed = %v (%v)", c.name, stored, err)
		}
		// capacity 3 and four requests: free the seat so every case sees the car
		mustExec(t, e.tx, `UPDATE trips SET seats_held = 0`+" WHERE id = $1", *r.TripID)
	}
}

func TestSubmitKeepsAndAppliesTagFilters(t *testing.T) {
	e := newSupplyEnv(t)
	tags := tagIDs(t, e.tx, 2)
	e.addTrip(t, tripSpec{})
	req := fmt.Sprintf(`"tag_filters":[{"tag_id":%d,"intent":"required"},{"tag_id":%d,"intent":"preferred"}]`, tags[0], tags[1])
	r := e.submit(t, e.near(), &req)
	// REQ-040: the only car does not carry the required tag.
	if r.Status != reqNoMatch {
		t.Fatalf("request = %+v, want no_match for a missing required tag", r)
	}
	rows, err := e.tx.Query(context.Background(), `SELECT tag_id, intent FROM request_tag_filters WHERE request_id = $1 ORDER BY tag_id`, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[int64]string{}
	for rows.Next() {
		var id int64
		var intent string
		if err := rows.Scan(&id, &intent); err != nil {
			t.Fatal(err)
		}
		got[id] = intent
	}
	if len(got) != 2 || got[tags[0]] != "required" || got[tags[1]] != "preferred" {
		t.Errorf("stored filters = %v", got)
	}
}

func TestSubmitRequestValidationAndAccess(t *testing.T) {
	e := newSupplyEnv(t)
	post := func(token, body string) *httptest.ResponseRecorder {
		return call(t, e.tx, http.MethodPost, "/api/passenger/requests", token, body)
	}
	good := e.body(e.near(), "")
	wantStatus(t, post("", good), http.StatusUnauthorized, "")
	_, driver := newUser(t, e.tx, roleDriver)
	wantStatus(t, post(driver, good), http.StatusForbidden, "")

	for _, c := range []struct{ name, body, code string }{
		{"not json", `x`, "invalid_request"},
		{"no pickup point", `{"location":{"lat":25,"lng":121}}`, "invalid_request"},
		{"unknown pickup point", `{"pickup_point_id":999999,"location":{"lat":25,"lng":121}}`, "invalid_pickup_point"},
		{"no location", fmt.Sprintf(`{"pickup_point_id":%d}`, e.pickupID), "invalid_location"},
		{"location out of range", fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":91,"lng":121}}`, e.pickupID), "invalid_location"},
		{"no destination and no habit", fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":25,"lng":121}}`, e.pickupID), "destination_required"},
		{"no stops and no habit", fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":25,"lng":121},"destination":{"name":"x","lat":25,"lng":121}}`, e.pickupID), "stops_required"},
		{"unknown stop", e.body(e.near(), `"stop_ids":[999999]`), "invalid_stop"},
		{"unknown tag", e.body(e.near(), `"tag_filters":[{"tag_id":999999,"intent":"required"}]`), "invalid_tag"},
		{"bad intent", e.body(e.near(), `"tag_filters":[{"tag_id":1,"intent":"maybe"}]`), "invalid_request"},
	} {
		w := post(e.token, c.body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400 (%s)", c.name, w.Code, w.Body.String())
			continue
		}
		if got := decode[errBody](t, w).Error.Code; got != c.code {
			t.Errorf("%s: code %q, want %q", c.name, got, c.code)
		}
	}
	var n int
	if err := e.tx.QueryRow(context.Background(), `SELECT count(*) FROM ride_requests WHERE passenger_id = $1`, e.userID).Scan(&n); err != nil || n != 0 {
		t.Errorf("refused submissions left %d requests (%v)", n, err)
	}
}

func TestSubmitFallsBackToHabitualData(t *testing.T) {
	e := newSupplyEnv(t)
	e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng) VALUES ($1, '常用', $2, $3)`,
		e.userID, e.dest.Lat, e.dest.Lng)
	mustExec(t, e.tx, `INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) VALUES ($1, $2)`, e.userID, e.stopID)
	body := fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":%s,"lng":%s}}`, e.pickupID, ftoa(e.pickup.Lat), ftoa(e.pickup.Lng))
	if r := e.submitAs(t, e.token, body); r.Status != reqWaitingDriver {
		t.Errorf("request = %+v, want waiting_driver", r)
	}
}

// Two passengers race for the last seat over committed transactions (acceptance: the one that
// submitted first gets it). Fixtures are committed, so cleanup removes them (the driver stays, see raceFixture.cleanup).
func TestLastSeatGoesToTheFirstSubmitter(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close) // registered first, so it runs after the fixture's own cleanup
	f := newRaceFixture(t, pool)

	// A deterministic order: the first request holds the seat in a transaction that is still
	// open while the second one is submitted; the second must wait on the seat and then lose it.
	s := &Server{db: pool, routes: straightRoute{}, drives: straightRoute{}, walks: straightWalk{}}
	first, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback(ctx)
	r1, err := s.placeRequest(ctx, first, f.input(f.passengers[0]))
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan requestView, 1)
	go func() {
		second, err := pool.Begin(ctx)
		if err != nil {
			t.Error(err)
			done <- requestView{}
			return
		}
		defer second.Rollback(ctx)
		r2, err := s.placeRequest(ctx, second, f.input(f.passengers[1]))
		if err != nil {
			t.Error(err)
		} else if err := second.Commit(ctx); err != nil {
			t.Error(err)
		}
		done <- r2
	}()
	select {
	case <-done:
		t.Fatal("the second request finished while the first still held the seat")
	case <-time.After(500 * time.Millisecond):
	}
	if err := first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r2 := <-done

	if r1.Status != reqWaitingDriver || r1.TripID == nil || *r1.TripID != f.trip {
		t.Errorf("first = %+v, want the seat on trip %d", r1, f.trip)
	}
	if r2.Status != reqNoMatch {
		t.Errorf("second = %+v, want no_match", r2)
	}
	if held, confirmed := f.seats(t); held != 1 || confirmed != 0 {
		t.Errorf("seats held/confirmed = %d/%d, want 1/0", held, confirmed)
	}
}

// slowWalk blocks its first call until released, standing in for a slow external provider.
type slowWalk struct {
	blocked atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (w *slowWalk) Walk(ctx context.Context, from, to latLng) (Walk, error) {
	if w.blocked.CompareAndSwap(false, true) { // only the very first call waits
		close(w.entered)
		<-w.release
	}
	return straightWalk{}.Walk(ctx, from, to)
}

// REQ-048: the first submitted gets the seat even when its ranking is slow. The first request is
// held up after it was inserted; a second one, submitted meanwhile, must wait for it and lose.
func TestSlowRankingDoesNotLetALaterRequestOvertake(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	f := newRaceFixture(t, pool)

	slow := &slowWalk{entered: make(chan struct{}), release: make(chan struct{})}
	s := &Server{db: pool, routes: straightRoute{}, drives: straightRoute{}, walks: slow}
	var wg sync.WaitGroup
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(slow.release) }) }
	// However the test ends, let the stuck request go and wait for it, so the fixture can be removed.
	defer func() {
		release()
		wg.Wait()
	}()
	submit := func(p raceUser) <-chan requestView {
		out := make(chan requestView, 1)
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Error(err)
				out <- requestView{}
				return
			}
			defer tx.Rollback(ctx)
			v, err := s.placeRequest(ctx, tx, f.input(p))
			if err == nil {
				err = tx.Commit(ctx)
			}
			if err != nil {
				t.Error(err)
			}
			out <- v
		}()
		return out
	}

	first := submit(f.passengers[0])
	<-slow.entered // the first request is inserted and stuck in ranking
	second := submit(f.passengers[1])
	select {
	case v := <-second:
		t.Fatalf("a later request finished while the first was still ranking: %+v", v)
	case <-time.After(500 * time.Millisecond):
	}
	release()
	r1, r2 := <-first, <-second

	if r1.Status != reqWaitingDriver || r1.TripID == nil || *r1.TripID != f.trip {
		t.Errorf("first = %+v, want the seat on trip %d", r1, f.trip)
	}
	if r2.Status != reqNoMatch {
		t.Errorf("second = %+v, want no_match", r2)
	}
	if r1.ID >= r2.ID {
		t.Errorf("request ids %d, %d: the first submitted should have the lower id", r1.ID, r2.ID)
	}
}

// Fully concurrent submissions through the HTTP handler: exactly one gets the one seat.
func TestConcurrentSubmissionsNeverOversell(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close) // registered first, so it runs after the fixture's own cleanup
	f := newRaceFixture(t, pool)

	var wg sync.WaitGroup
	got := make([]requestResp, len(f.passengers))
	start := make(chan struct{})
	for i, p := range f.passengers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			w := call(t, pool, http.MethodPost, "/api/passenger/requests", "passenger:"+p.name,
				fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":%s,"lng":%s},"destination":{"name":"d","lat":%s,"lng":%s},"stop_ids":[%d]}`,
					f.pickup.ID, ftoa(f.pickup.Lat), ftoa(f.pickup.Lng), ftoa(f.dest.Lat), ftoa(f.dest.Lng), f.stopID))
			if w.Code != http.StatusCreated {
				t.Errorf("status %d: %s", w.Code, w.Body.String())
				return
			}
			got[i] = decode[requestResp](t, w)
		}()
	}
	close(start)
	wg.Wait()

	var assigned, none int
	for _, r := range got {
		switch r.Status {
		case reqWaitingDriver:
			assigned++
		case reqNoMatch:
			none++
		}
	}
	if assigned != 1 || none != len(got)-1 {
		t.Errorf("assigned %d, no_match %d, want 1 and %d (%+v)", assigned, none, len(got)-1, got)
	}
	if held, _ := f.seats(t); held != 1 {
		t.Errorf("seats_held = %d, want 1", held)
	}
}

type raceUser struct {
	id   int64
	name string
}

type raceFixture struct {
	t          *testing.T
	pool       *pgxpool.Pool
	pickup     pickupPoint
	dest       latLng
	stopID     int64
	trip       int64
	passengers []raceUser
	driver     raceUser
}

// newRaceFixture commits a one-seat car at a pickup point with no other active trip, and three
// passengers. Cleanup ends the trip and removes the rest.
func newRaceFixture(t *testing.T, pool *pgxpool.Pool) *raceFixture {
	t.Helper()
	ctx := context.Background()
	f := &raceFixture{t: t, pool: pool, dest: latLng{25.0800, 121.5700}}
	if err := pool.QueryRow(ctx, `
		SELECT id, name, lat, lng, radius_m FROM pickup_points p
		 WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.pickup_point_id = p.id AND t.status = 'active')
		 ORDER BY id DESC LIMIT 1`).Scan(&f.pickup.ID, &f.pickup.Name, &f.pickup.Lat, &f.pickup.Lng, &f.pickup.RadiusM); err != nil {
		t.Skipf("no pickup point without an active trip: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM bus_stops ORDER BY id LIMIT 1`).Scan(&f.stopID); err != nil {
		t.Fatal(err)
	}
	suffix := strconv.FormatInt(time.Now().UnixNano(), 36)
	mk := func(prefix string, driver bool) raceUser {
		u := raceUser{name: "test-race-" + prefix + "-" + suffix}
		if err := pool.QueryRow(ctx, `INSERT INTO users (username, display_name, is_driver, is_passenger) VALUES ($1, $1, $2, $3) RETURNING id`,
			u.name, driver, !driver).Scan(&u.id); err != nil {
			t.Fatal(err)
		}
		return u
	}
	f.driver = mk("driver", true)
	for _, n := range []string{"a", "b", "c"} {
		f.passengers = append(f.passengers, mk(n, false))
	}
	var act int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status,
		                   route_polyline, route_distance_m, route_duration_s, route_simulated)
		VALUES ($1, $2, '測試目的地', $3, $4, 1, 'active', '', 1, 1, true) RETURNING id`, // route present: ranking writes nothing to the trip
		f.driver.id, f.pickup.ID, f.dest.Lat, f.dest.Lng).Scan(&f.trip); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2) RETURNING id`,
		f.driver.id, f.trip).Scan(&act); err != nil {
		t.Fatal(err)
	}
	car := offsetM(latLng{f.pickup.Lat, f.pickup.Lng}, 500)
	if _, err := pool.Exec(ctx, `INSERT INTO location_reports (activity_id, lat, lng) VALUES ($1, $2, $3)`, act, car.Lat, car.Lng); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.cleanup)
	return f
}

// cleanup ends the car's trip and removes the requests and passengers. The driver, its activity
// and its location report stay: location_reports is append-only (DD-06) and the app role cannot
// lift that, so an account that reported can never be deleted (same as the Karate drivers).
func (f *raceFixture) cleanup() {
	ctx := context.Background()
	var passengers []int64
	for _, p := range f.passengers {
		passengers = append(passengers, p.id)
	}
	err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1`, f.trip); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM service_records WHERE passenger_id = ANY($1)`, passengers); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM ride_requests WHERE passenger_id = ANY($1)`, passengers); err != nil { // candidates and filters cascade
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`, passengers)
		return err
	})
	if err != nil {
		f.t.Errorf("remove race fixture: %v", err)
	}
}

func (f *raceFixture) input(p raceUser) requestInput {
	return requestInput{PassengerID: p.id, Pickup: f.pickup, At: latLng{f.pickup.Lat, f.pickup.Lng},
		Dest: place{Name: "d", Lat: f.dest.Lat, Lng: f.dest.Lng}, StopIDs: []int64{f.stopID}}
}

func (f *raceFixture) seats(t *testing.T) (held, confirmed int) {
	t.Helper()
	if err := f.pool.QueryRow(context.Background(), `SELECT seats_held, seats_confirmed FROM trips WHERE id = $1`, f.trip).
		Scan(&held, &confirmed); err != nil {
		t.Fatal(err)
	}
	return
}

// REQ-001, DD-32: a final destination outside the park is refused with the departure's error
// code and creates no request; the usual destination is checked too; points on either side of
// the boundary get the opposite answers.
func TestSubmitRefusesAFinalDestinationOutsideThePark(t *testing.T) {
	e := newSupplyEnv(t)
	e.addTrip(t, tripSpec{})
	outside := latLng{25.0478, 121.5170}
	count := func() (n int) {
		if err := e.tx.QueryRow(context.Background(), `SELECT count(*) FROM ride_requests WHERE passenger_id = $1`, e.userID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// given in the body
	body := strings.Replace(e.body(e.near(), ""), ftoa(e.dest.Lat), ftoa(outside.Lat), 1)
	body = strings.Replace(body, ftoa(e.dest.Lng), ftoa(outside.Lng), 1)
	w := call(t, e.tx, http.MethodPost, "/api/passenger/requests", e.token, body)
	wantStatus(t, w, http.StatusBadRequest, "destination_outside_park")
	if count() != 0 {
		t.Fatal("a refused request was stored")
	}

	// prefilled from the usual destination
	mustExec(t, e.tx, `INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng) VALUES ($1, '常用', $2, $3)`,
		e.userID, outside.Lat, outside.Lng)
	mustExec(t, e.tx, `INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) VALUES ($1, $2)`, e.userID, e.stopID)
	habit := fmt.Sprintf(`{"pickup_point_id":%d,"location":{"lat":%s,"lng":%s}}`, e.pickupID, ftoa(e.pickup.Lat), ftoa(e.pickup.Lng))
	wantStatus(t, call(t, e.tx, http.MethodPost, "/api/passenger/requests", e.token, habit), http.StatusBadRequest, "destination_outside_park")
	if count() != 0 {
		t.Fatal("a refused request was stored")
	}

	// inside the park is accepted
	if r := e.submit(t, e.near(), nil); r.Status == reqRejected {
		t.Fatalf("a destination in the park was rejected: %+v", r)
	}
}
