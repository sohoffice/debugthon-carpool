package server

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
)

type supplyResp struct {
	PickupPoint    pickupPoint `json:"pickup_point"`
	Destination    place       `json:"destination"`
	StopIDs        []int64     `json:"accepted_stop_ids"`
	TimelineRangeS int         `json:"timeline_range_s"`
	Card           struct {
		Count            int   `json:"count"`
		FastestETAS      *int  `json:"fastest_eta_s"`
		FastestSimulated *bool `json:"fastest_eta_simulated"`
		SeatsRemaining   int   `json:"seats_remaining"`
	} `json:"card"`
	Cars []struct {
		TripID         int64 `json:"trip_id"`
		ETAS           int   `json:"eta_s"`
		ETASimulated   bool  `json:"eta_simulated"`
		SeatsAvailable int   `json:"seats_available"`
	} `json:"cars"`
}

// supplyEnv is a passenger who wants to reach the destination and a clean slate of trips: the
// seeded trips are ended inside the test transaction, so only the trips a test adds can show up.
type supplyEnv struct {
	tx        pgx.Tx
	token     string
	userID    int64
	pickupID  int64
	pickup    latLng
	radiusM   float64
	dest      latLng
	stopID    int64
	otherStop int64
}

func newSupplyEnv(t *testing.T) *supplyEnv {
	t.Helper()
	tx := testTx(t)
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE status = 'active'`)
	e := &supplyEnv{tx: tx, dest: latLng{25.0800, 121.5700}}
	e.userID, e.token = newUser(t, tx, rolePassenger)
	ctx := context.Background()
	if err := tx.QueryRow(ctx, `SELECT id, lat, lng, radius_m FROM pickup_points ORDER BY id LIMIT 1`).
		Scan(&e.pickupID, &e.pickup.Lat, &e.pickup.Lng, &e.radiusM); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM bus_stops ORDER BY id LIMIT 1`).Scan(&e.stopID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM bus_stops ORDER BY id DESC LIMIT 1`).Scan(&e.otherStop); err != nil {
		t.Fatal(err)
	}
	return e
}

// query builds the supply query; extra holds further parameters.
func (e *supplyEnv) query(extra map[string]string) string {
	q := url.Values{}
	q.Set("pickup_point_id", strconv.FormatInt(e.pickupID, 10))
	q.Set("dest_lat", ftoa(e.dest.Lat))
	q.Set("dest_lng", ftoa(e.dest.Lng))
	q.Set("stop_ids", strconv.FormatInt(e.stopID, 10))
	for k, v := range extra {
		if v == "" {
			q.Del(k)
		} else {
			q.Set(k, v)
		}
	}
	return "/api/passenger/supply?" + q.Encode()
}

func (e *supplyEnv) supply(t *testing.T, extra map[string]string) supplyResp {
	t.Helper()
	w := call(t, e.tx, http.MethodGet, e.query(extra), e.token, "")
	wantStatus(t, w, http.StatusOK, "")
	return decode[supplyResp](t, w)
}

// tripSpec describes one car; the zero value is a car that passes every condition.
type tripSpec struct {
	dest      latLng // zero means the passenger's destination
	capacity  int    // zero means 3
	northM    float64
	noReport  bool
	tagIDs    []int64
	required  []int64 // the driver's required filters
	preferred []int64
}

// addTrip starts a trip for a fresh driver at the env's pickup point and, unless noReport, puts
// the car northM metres from the pickup so it has an ETA.
func (e *supplyEnv) addTrip(t *testing.T, s tripSpec) int64 {
	t.Helper()
	ctx := context.Background()
	driverID, token := newUser(t, e.tx, roleDriver)
	if s.dest == (latLng{}) {
		s.dest = e.dest
	}
	if s.capacity == 0 {
		s.capacity = 3
	}
	if s.northM == 0 {
		s.northM = 1000
	}
	var id int64
	if err := e.tx.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status)
		VALUES ($1, $2, '測試目的地', $3, $4, $5, 'active') RETURNING id`,
		driverID, e.pickupID, s.dest.Lat, s.dest.Lng, s.capacity).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, tag := range s.tagIDs {
		mustExec(t, e.tx, `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)`, driverID, tag)
	}
	for _, tag := range s.required {
		mustExec(t, e.tx, `INSERT INTO trip_tag_filters (trip_id, tag_id, intent) VALUES ($1, $2, 'required')`, id, tag)
	}
	for _, tag := range s.preferred {
		mustExec(t, e.tx, `INSERT INTO trip_tag_filters (trip_id, tag_id, intent) VALUES ($1, $2, 'preferred')`, id, tag)
	}
	declare(t, e.tx, token)
	if !s.noReport {
		report(t, e.tx, token, offsetM(e.pickup, s.northM))
	}
	return id
}

func carIDs(r supplyResp) []int64 {
	out := make([]int64, len(r.Cars))
	for i, c := range r.Cars {
		out[i] = c.TripID
	}
	return out
}

func tagIDs(t *testing.T, tx pgx.Tx, n int) []int64 {
	t.Helper()
	rows, err := tx.Query(context.Background(), `SELECT id FROM tags ORDER BY id LIMIT $1`, n)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if len(ids) < n {
		t.Fatalf("need %d seeded tags, have %d", n, len(ids))
	}
	return ids
}

// REQ-028, DD-10: the list holds exactly the cars eligible() accepts, one per failing condition
// left out, and a second reading through loadMatchTrips + eligible agrees with the endpoint.
func TestSupplyListsOnlyEligibleCars(t *testing.T) {
	e := newSupplyEnv(t)
	ok := e.addTrip(t, tripSpec{northM: 1000})

	passed := e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `UPDATE trips SET passed_pickup = true WHERE id = $1`, passed)
	full := e.addTrip(t, tripSpec{capacity: 1})
	mustExec(t, e.tx, `UPDATE trips SET seats_held = 1 WHERE id = $1`, full)
	e.addTrip(t, tripSpec{dest: latLng{25.0300, 121.6500}}) // destination irrelevant, no stop on the route
	e.addTrip(t, tripSpec{northM: 6000})                    // too far: beyond the wait limit
	e.addTrip(t, tripSpec{noReport: true})                  // never heard from: no ETA
	ended := e.addTrip(t, tripSpec{})                       // not active any more
	mustExec(t, e.tx, `UPDATE trips SET status = 'completed' WHERE id = $1`, ended)

	got := e.supply(t, nil)
	if ids := carIDs(got); !equalIDs(ids, []int64{ok}) {
		t.Fatalf("cars = %v, want only %d", ids, ok)
	}

	// The same inputs through the shared screening give the same set (DD-10).
	s := &Server{db: e.tx, routes: straightRoute{}, drives: straightRoute{}}
	params, err := loadMatchParams(context.Background(), e.tx)
	if err != nil {
		t.Fatal(err)
	}
	trips, err := s.loadMatchTrips(context.Background(), context.Background(), e.pickupID)
	if err != nil {
		t.Fatal(err)
	}
	req := matchRequest{PickupPointID: e.pickupID, Destination: e.dest, AcceptedStops: []int64{e.stopID}}
	var want []int64
	for _, tr := range trips {
		if eligible(params, req, tr) {
			want = append(want, tr.ID)
		}
	}
	if !equalIDs(carIDs(got), want) {
		t.Fatalf("endpoint = %v, eligible() = %v", carIDs(got), want)
	}
}

// REQ-038: a stop on the route that the passenger accepts makes a far-away destination relevant.
func TestSupplyCountsAcceptedStopOnRoute(t *testing.T) {
	e := newSupplyEnv(t)
	id := e.addTrip(t, tripSpec{dest: latLng{25.0300, 121.6500}})
	mustExec(t, e.tx, `INSERT INTO trip_route_stops (trip_id, seq, bus_stop_id) VALUES ($1, 1, $2)`, id, e.otherStop)
	// ensureRoute leaves a trip that already has a route alone, so give this one a route first.
	mustExec(t, e.tx, `UPDATE trips SET route_polyline = '', route_distance_m = 1, route_duration_s = 1, route_simulated = true WHERE id = $1`, id)

	if got := e.supply(t, nil); len(got.Cars) != 0 {
		t.Fatalf("stop %d not accepted, cars = %v", e.stopID, carIDs(got))
	}
	got := e.supply(t, map[string]string{"stop_ids": strconv.FormatInt(e.otherStop, 10)})
	if ids := carIDs(got); !equalIDs(ids, []int64{id}) {
		t.Fatalf("cars = %v, want %d", ids, id)
	}
}

// REQ-029: count, fastest ETA and the seats left over all cars, ordered soonest first.
func TestSupplyCardSummarisesTheCars(t *testing.T) {
	e := newSupplyEnv(t)
	empty := e.supply(t, nil)
	if empty.Card.Count != 0 || empty.Card.FastestETAS != nil || empty.Card.SeatsRemaining != 0 || empty.Cars == nil {
		t.Fatalf("empty supply = %+v, want zero card and an empty (not null) list", empty)
	}

	far := e.addTrip(t, tripSpec{northM: 2000, capacity: 4})
	near := e.addTrip(t, tripSpec{northM: 500, capacity: 3})
	mustExec(t, e.tx, `UPDATE trips SET seats_held = 1, seats_confirmed = 1 WHERE id = $1`, near)

	got := e.supply(t, nil)
	if ids := carIDs(got); !equalIDs(ids, []int64{near, far}) {
		t.Fatalf("cars = %v, want [%d %d] soonest first", ids, near, far)
	}
	if got.Card.Count != 2 || got.Card.SeatsRemaining != 1+4 {
		t.Fatalf("card = %+v, want 2 cars and 5 seats left", got.Card)
	}
	if got.Card.FastestETAS == nil || *got.Card.FastestETAS != got.Cars[0].ETAS || got.Cars[0].ETAS >= got.Cars[1].ETAS {
		t.Fatalf("fastest = %v, cars = %+v", got.Card.FastestETAS, got.Cars)
	}
	if got.Cars[0].SeatsAvailable != 1 || got.Cars[1].SeatsAvailable != 4 {
		t.Fatalf("seats = %+v", got.Cars)
	}
}

// REQ-040, REQ-033: a car is hidden when either side's required tag is missing on the other.
func TestSupplyHidesCarsFailingMandatoryTags(t *testing.T) {
	e := newSupplyEnv(t)
	tags := tagIDs(t, e.tx, 2)
	a, b := tags[0], tags[1]

	carries := e.addTrip(t, tripSpec{tagIDs: []int64{a}})
	plain := e.addTrip(t, tripSpec{})
	wantsB := e.addTrip(t, tripSpec{tagIDs: []int64{a}, required: []int64{b}}) // the passenger lacks b
	prefersB := e.addTrip(t, tripSpec{preferred: []int64{b}})                  // preferred never screens

	// The passenger requires a: only the car carrying it stays.
	got := e.supply(t, map[string]string{"required_tags": strconv.FormatInt(a, 10)})
	for _, id := range carIDs(got) {
		if id == plain || id == wantsB {
			t.Fatalf("cars = %v: car %d fails a mandatory tag", carIDs(got), id)
		}
	}
	if ids := carIDs(got); len(ids) != 1 || ids[0] != carries {
		t.Fatalf("cars = %v, want only %d", ids, carries)
	}

	// Without the passenger's own filter, the driver's requirement still excludes (both directions).
	got = e.supply(t, nil)
	have := map[int64]bool{}
	for _, id := range carIDs(got) {
		have[id] = true
	}
	if have[wantsB] || !have[carries] || !have[plain] || !have[prefersB] {
		t.Fatalf("cars = %v, want carries, plain and prefersB but not wantsB (%d)", carIDs(got), wantsB)
	}

	// Once the passenger carries b, the driver's requirement is met.
	mustExec(t, e.tx, `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)`, e.userID, b)
	got = e.supply(t, nil)
	have = map[int64]bool{}
	for _, id := range carIDs(got) {
		have[id] = true
	}
	if !have[wantsB] {
		t.Fatalf("cars = %v, want %d once the passenger carries b", carIDs(got), wantsB)
	}

	// A preferred tag on the passenger's side never hides a car.
	got = e.supply(t, map[string]string{"preferred_tags": strconv.FormatInt(a, 10)})
	if len(got.Cars) != 4 {
		t.Fatalf("cars = %v, want all 4 with only a preferred filter", carIDs(got))
	}
}

// REQ-030, REQ-041: the timeline range is the wait limit and follows it when it is edited.
func TestSupplyTimelineFollowsWaitLimit(t *testing.T) {
	e := newSupplyEnv(t)
	id := e.addTrip(t, tripSpec{northM: 1500}) // ~350 s with the simulated route

	got := e.supply(t, nil)
	if got.TimelineRangeS != 600 || len(got.Cars) != 1 || got.Cars[0].TripID != id {
		t.Fatalf("default: range %d, cars %v; want 600 s and car %d", got.TimelineRangeS, carIDs(got), id)
	}
	eta := got.Cars[0].ETAS
	if eta <= 60 || eta >= 600 {
		t.Fatalf("test needs an ETA between 1 and 10 minutes, got %d s", eta)
	}

	mustExec(t, e.tx, `UPDATE system_settings SET value = 20 WHERE key = 'wait_limit'`)
	if got := e.supply(t, nil); got.TimelineRangeS != 1200 {
		t.Fatalf("wait limit 20 min: range = %d, want 1200", got.TimelineRangeS)
	}

	// A car right at the limit stays; one second under it goes.
	mustExec(t, e.tx, `UPDATE system_settings SET value = $1 WHERE key = 'wait_limit'`, float64(eta)/60)
	got = e.supply(t, nil)
	if got.TimelineRangeS != eta || len(got.Cars) != 1 {
		t.Fatalf("limit = ETA: range %d, cars %v; want %d s and the car kept", got.TimelineRangeS, carIDs(got), eta)
	}
	mustExec(t, e.tx, `UPDATE system_settings SET value = $1 WHERE key = 'wait_limit'`, float64(eta-1)/60)
	got = e.supply(t, nil)
	if got.TimelineRangeS != eta-1 || len(got.Cars) != 0 {
		t.Fatalf("limit below ETA: range %d, cars %v; want %d s and no cars", got.TimelineRangeS, carIDs(got), eta-1)
	}
}

// REQ-025: with nothing in the query, the destination and stops come from the passenger's profile.
func TestSupplyUsesHabitualDefaults(t *testing.T) {
	e := newSupplyEnv(t)
	id := e.addTrip(t, tripSpec{})
	mustExec(t, e.tx, `
		INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng)
		VALUES ($1, '常去的地方', $2, $3)`, e.userID, e.dest.Lat, e.dest.Lng)
	mustExec(t, e.tx, `INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) VALUES ($1, $2)`, e.userID, e.stopID)

	got := e.supply(t, map[string]string{"dest_lat": "", "dest_lng": "", "stop_ids": ""})
	if ids := carIDs(got); !equalIDs(ids, []int64{id}) {
		t.Fatalf("cars = %v, want %d", ids, id)
	}
	if got.Destination.Name != "常去的地方" || len(got.StopIDs) != 1 || got.StopIDs[0] != e.stopID {
		t.Fatalf("effective inputs = %+v %v, want the profile's", got.Destination, got.StopIDs)
	}

	// What the query gives wins over the profile.
	got = e.supply(t, map[string]string{"dest_lat": "25.0300", "dest_lng": "121.6500"})
	if len(got.Cars) != 0 || got.Destination.Lat != 25.03 {
		t.Fatalf("explicit destination: cars %v, destination %+v", carIDs(got), got.Destination)
	}
}

// REQ-024: the destination and at least one stop are both required, after the defaults.
func TestSupplyRequiresPickupDestinationAndStops(t *testing.T) {
	e := newSupplyEnv(t)
	for _, c := range []struct {
		name  string
		extra map[string]string
		code  string
	}{
		{"missing pickup point", map[string]string{"pickup_point_id": ""}, "invalid_request"},
		{"unknown pickup point", map[string]string{"pickup_point_id": "999999"}, "invalid_pickup_point"},
		{"no destination, no profile", map[string]string{"dest_lat": "", "dest_lng": ""}, "destination_required"},
		{"half a destination", map[string]string{"dest_lng": ""}, "invalid_request"},
		{"destination out of range", map[string]string{"dest_lat": "91"}, "invalid_request"},
		{"no stops, no profile", map[string]string{"stop_ids": ""}, "stops_required"},
		{"unknown stop", map[string]string{"stop_ids": "999999"}, "invalid_stop"},
		{"malformed stops", map[string]string{"stop_ids": "a,b"}, "invalid_request"},
		{"unknown tag", map[string]string{"required_tags": "999999"}, "invalid_tag"},
		{"tag both required and preferred", map[string]string{"required_tags": "1", "preferred_tags": "1"}, "invalid_request"},
	} {
		t.Run(c.name, func(t *testing.T) {
			wantStatus(t, call(t, e.tx, http.MethodGet, e.query(c.extra), e.token, ""), http.StatusBadRequest, c.code)
		})
	}

	// A profile with a destination but no stops is still refused.
	mustExec(t, e.tx, `
		INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng)
		VALUES ($1, 'x', 25.08, 121.57)`, e.userID)
	wantStatus(t, call(t, e.tx, http.MethodGet, e.query(map[string]string{"dest_lat": "", "dest_lng": "", "stop_ids": ""}), e.token, ""),
		http.StatusBadRequest, "stops_required")
}

// Passenger only, and a token is needed; there is no way to pick a car (REQ-031).
func TestSupplyAccess(t *testing.T) {
	e := newSupplyEnv(t)
	wantStatus(t, call(t, e.tx, http.MethodGet, e.query(nil), "", ""), http.StatusUnauthorized, "")
	_, driverToken := newUser(t, e.tx, roleDriver)
	wantStatus(t, call(t, e.tx, http.MethodGet, e.query(nil), driverToken, ""), http.StatusForbidden, "")

	for _, path := range []string{"/api/passenger/supply", "/api/passenger/supply/1"} {
		for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
			if w := call(t, e.tx, m, path, e.token, "{}"); w.Code < 400 {
				t.Errorf("%s %s = %d, want a refusal", m, path, w.Code)
			}
		}
	}
}
