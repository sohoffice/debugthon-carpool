package server

import (
	"context"
	"fmt"
	"net/http"
	"testing"
)

// usualEnv adds completed rides straight into service_records, so the recompute rule can be
// checked without going through the API for every ride.
type usualEnv struct {
	*supplyEnv
	driverID int64
	pickups  []int64
	stops    []int64
}

func newUsualEnv(t *testing.T) *usualEnv {
	t.Helper()
	e := &usualEnv{supplyEnv: newSupplyEnv(t)}
	e.driverID, _ = newUser(t, e.tx, roleDriver)
	ctx := context.Background()
	for _, q := range []struct {
		sql string
		dst *[]int64
	}{{`SELECT id FROM pickup_points ORDER BY id LIMIT 2`, &e.pickups}, {`SELECT id FROM bus_stops ORDER BY id LIMIT 3`, &e.stops}} {
		rows, err := e.tx.Query(ctx, q.sql)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			*q.dst = append(*q.dst, id)
		}
		rows.Close()
	}
	return e
}

type ride struct {
	pickup    int64
	capacity  int
	tripDest  string // the driver's destination name
	reqDest   string // the passenger's final destination name
	stop      *int64
	completed string // local time in Taipei, e.g. '2026-10-19 08:30'
}

// addRide inserts a finished trip, request and service record, in that id order.
func (e *usualEnv) addRide(t *testing.T, r ride) {
	t.Helper()
	ctx := context.Background()
	var tripID, reqID int64
	if err := e.tx.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status)
		VALUES ($1, $2, $3, 25.07, 121.57, $4, 'completed') RETURNING id`, e.driverID, r.pickup, r.tripDest, r.capacity).Scan(&tripID); err != nil {
		t.Fatal(err)
	}
	if err := e.tx.QueryRow(ctx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng, status, trip_id, dropoff_bus_stop_id)
		VALUES ($1, $2, $3, 25.08, 121.58, 'completed', $4, $5) RETURNING id`, e.userID, r.pickup, r.reqDest, tripID, r.stop).Scan(&reqID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, e.tx, `
		INSERT INTO service_records (request_id, trip_id, driver_id, passenger_id, pickup_point_id, dropoff_bus_stop_id,
		                             dropoff_name, dropoff_lat, dropoff_lng, completed_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'd', 25, 121, ($7::timestamp AT TIME ZONE 'Asia/Taipei'))`,
		reqID, tripID, e.driverID, e.userID, r.pickup, r.stop, r.completed)
}

func (e *usualEnv) recompute(t *testing.T) {
	t.Helper()
	if err := recomputeUsualData(context.Background(), e.tx, e.driverID, e.userID); err != nil {
		t.Fatal(err)
	}
}

func (e *usualEnv) driverProfile(t *testing.T) (pickup int64, dest string, capacity int) {
	t.Helper()
	if err := e.tx.QueryRow(context.Background(), `
		SELECT usual_pickup_point_id, usual_destination_name, capacity FROM driver_profiles WHERE user_id = $1`, e.driverID).
		Scan(&pickup, &dest, &capacity); err != nil {
		t.Fatal(err)
	}
	return
}

func (e *usualEnv) passengerProfile(t *testing.T) (dest, arrival string, stops []int64) {
	t.Helper()
	ctx := context.Background()
	if err := e.tx.QueryRow(ctx, `SELECT usual_destination_name, to_char(usual_arrival_time, 'HH24:MI:SS') FROM passenger_profiles WHERE user_id = $1`, e.userID).
		Scan(&dest, &arrival); err != nil {
		t.Fatal(err)
	}
	rows, err := e.tx.Query(ctx, `SELECT bus_stop_id FROM passenger_accepted_stops WHERE user_id = $1 ORDER BY bus_stop_id`, e.userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		stops = append(stops, id)
	}
	return
}

// REQ-006, DD-19: the most frequent value wins, a tie goes to the most recent ride.
func TestDriverUsualDataMostFrequentThenMostRecent(t *testing.T) {
	e := newUsualEnv(t)
	a, b := e.pickups[0], e.pickups[1]
	day := "2026-10-19 08:00"

	e.addRide(t, ride{pickup: a, capacity: 3, tripDest: "甲", completed: day})
	e.recompute(t)
	if p, d, c := e.driverProfile(t); p != a || d != "甲" || c != 3 {
		t.Fatalf("after one ride = %d/%s/%d, want %d/甲/3", p, d, c, a)
	}

	// 1 : 1, the newer ride decides.
	e.addRide(t, ride{pickup: b, capacity: 4, tripDest: "乙", completed: day})
	e.recompute(t)
	if p, d, c := e.driverProfile(t); p != b || d != "乙" || c != 4 {
		t.Errorf("tie = %d/%s/%d, want the most recent ride %d/乙/4", p, d, c, b)
	}

	// a:2 b:1 after two more rides: the older values lead although the newest ride differs.
	e.addRide(t, ride{pickup: a, capacity: 3, tripDest: "甲", completed: day})
	e.addRide(t, ride{pickup: b, capacity: 4, tripDest: "乙", completed: day})
	e.addRide(t, ride{pickup: a, capacity: 3, tripDest: "甲", completed: day})
	e.recompute(t)
	if p, d, c := e.driverProfile(t); p != a || d != "甲" || c != 3 {
		t.Errorf("majority = %d/%s/%d, want %d/甲/3", p, d, c, a)
	}

	// Each field is decided on its own: the pickup ties 3:3 (the newest ride decides, b), while
	// the destination (甲 3, 乙 2, 丙 1) and the capacity (3 ×3, 4 ×2, 2 ×1) keep their majority.
	e.addRide(t, ride{pickup: b, capacity: 2, tripDest: "丙", completed: day})
	e.recompute(t)
	if p, d, c := e.driverProfile(t); p != b || d != "甲" || c != 3 {
		t.Errorf("per-field = %d/%s/%d, want %d/甲/3", p, d, c, b)
	}
}

// REQ-007, DD-19: destination from the requests, arrival as the median, only stops really used.
func TestPassengerUsualData(t *testing.T) {
	e := newUsualEnv(t)
	p := e.pickups[0]
	s1, s2 := e.stops[0], e.stops[1]

	e.addRide(t, ride{pickup: p, capacity: 3, tripDest: "x", reqDest: "公司", stop: ptr(s1), completed: "2026-10-19 08:00"})
	e.addRide(t, ride{pickup: p, capacity: 3, tripDest: "x", reqDest: "公司", stop: nil, completed: "2026-10-20 09:30"})
	e.addRide(t, ride{pickup: p, capacity: 3, tripDest: "x", reqDest: "咖啡店", stop: ptr(s2), completed: "2026-10-21 08:30"})
	e.recompute(t)
	dest, arrival, stops := e.passengerProfile(t)
	if dest != "公司" {
		t.Errorf("destination = %s, want the most frequent 公司", dest)
	}
	if arrival != "08:30:00" {
		t.Errorf("arrival = %s, want the median 08:30:00 of 08:00, 08:30, 09:30", arrival)
	}
	if fmt.Sprint(stops) != fmt.Sprint([]int64{s1, s2}) {
		t.Errorf("accepted stops = %v, want the used stops %v (a null drop-off is not a stop)", stops, []int64{s1, s2})
	}

	// An even count averages the middle two; a tie in destination goes to the newest ride.
	e.addRide(t, ride{pickup: p, capacity: 3, tripDest: "x", reqDest: "咖啡店", stop: nil, completed: "2026-10-22 10:00"})
	e.recompute(t)
	dest, arrival, _ = e.passengerProfile(t)
	if dest != "咖啡店" {
		t.Errorf("destination = %s, want 咖啡店: tied 2:2, the newest ride decides", dest)
	}
	if arrival != "09:00:00" {
		t.Errorf("arrival = %s, want 09:00:00, the mean of 08:30 and 09:30", arrival)
	}
}

// A profile that the SQL seed or an earlier ride left behind is replaced, stops included.
func TestRecomputeReplacesAnExistingProfile(t *testing.T) {
	e := newUsualEnv(t)
	mustExec(t, e.tx, `INSERT INTO passenger_profiles (user_id, usual_destination_name) VALUES ($1, '舊')`, e.userID)
	mustExec(t, e.tx, `INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) VALUES ($1, $2)`, e.userID, e.stops[2])
	mustExec(t, e.tx, `INSERT INTO driver_profiles (user_id, capacity) VALUES ($1, 9)`, e.driverID)
	e.addRide(t, ride{pickup: e.pickups[0], capacity: 3, tripDest: "甲", reqDest: "新", stop: ptr(e.stops[0]), completed: "2026-10-19 08:00"})
	e.recompute(t)
	if dest, _, stops := e.passengerProfile(t); dest != "新" || fmt.Sprint(stops) != fmt.Sprint([]int64{e.stops[0]}) {
		t.Errorf("passenger = %s %v, want 新 and only the used stop", dest, stops)
	}
	if _, _, c := e.driverProfile(t); c != 3 {
		t.Errorf("capacity = %d, want 3", c)
	}
}

// Acceptance: after a ride is completed the usual data is there for the next departure or query.
func TestCompletionFeedsTheProfilesTheAPIServes(t *testing.T) {
	e := newSupplyEnv(t)
	trip, driver, id := e.confirmedRide(t)

	w := call(t, e.tx, http.MethodGet, "/api/driver/profile", driver, "")
	if p := decode[map[string]any](t, w); p["usual_pickup_point"] != nil || p["capacity"] != nil {
		t.Fatalf("driver profile before any ride = %v, want empty", p)
	}
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)

	w = call(t, e.tx, http.MethodGet, "/api/driver/profile", driver, "")
	wantStatus(t, w, http.StatusOK, "")
	dp := decode[struct {
		Pickup   *pickupPoint `json:"usual_pickup_point"`
		Dest     *place       `json:"usual_destination"`
		Capacity *int         `json:"capacity"`
	}](t, w)
	if dp.Pickup == nil || dp.Pickup.ID != e.pickupID || dp.Dest == nil || dp.Dest.Name != "測試目的地" || dp.Capacity == nil || *dp.Capacity != 3 {
		t.Errorf("driver profile = %+v, want the finished trip's pickup %d, destination and capacity 3 (trip %d)", dp, e.pickupID, trip)
	}

	w = call(t, e.tx, http.MethodGet, "/api/passenger/profile", e.token, "")
	wantStatus(t, w, http.StatusOK, "")
	pp := decode[struct {
		Arrival *string `json:"usual_arrival_time"`
		Dest    *place  `json:"usual_destination"`
		Stops   []struct {
			ID int64 `json:"id"`
		} `json:"accepted_stops"`
	}](t, w)
	if pp.Arrival == nil || pp.Dest == nil || pp.Dest.Name != "目的地" || pp.Dest.Lat != e.dest.Lat {
		t.Errorf("passenger profile = %+v, want the requested destination and an arrival time", pp)
	}
	if len(pp.Stops) > 1 {
		t.Errorf("accepted stops = %v, want at most the one used", pp.Stops)
	}
}
