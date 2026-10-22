package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const cityToken = "city:city1"

// cityApp is one router kept across calls, as the backend is: the live simulation round lives in
// it (DD-40 step 5). clock is the real time it reads; tests move it.
type cityApp struct {
	t      *testing.T
	tx     pgx.Tx
	router *gin.Engine
	clock  time.Time
}

func newCityApp(t *testing.T, tx pgx.Tx, realNow time.Time) *cityApp {
	t.Helper()
	a := &cityApp{t: t, tx: tx, clock: realNow}
	deps := testDeps(t)
	deps.DemoReset = true
	deps.Clock = func() time.Time { return a.clock }
	a.router = NewRouter(tx, deps)
	return a
}

func (a *cityApp) do(method, path, token string) *httptest.ResponseRecorder {
	a.t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.router.ServeHTTP(w, req)
	return w
}

func cityGet[T any](a *cityApp, path string) T {
	a.t.Helper()
	w := a.do(http.MethodGet, path, cityToken)
	wantStatus(a.t, w, http.StatusOK, "")
	return decode[T](a.t, w)
}

type cityClockResp struct {
	Now       time.Time `json:"now"`
	Today     string    `json:"today"`
	DemoClock bool      `json:"demo_clock"`
}

type cityPlaceResp struct {
	ID   int64   `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

type liveCountsResp struct {
	Vehicles int `json:"vehicles"`
	OnBoard  int `json:"on_board"`
	Waiting  int `json:"waiting"`
	Matched  int `json:"matched"`
}

type cityLiveResp struct {
	cityClockResp
	Vehicles []struct {
		Lat        float64  `json:"lat"`
		Lng        float64  `json:"lng"`
		HeadingDeg *float64 `json:"heading_deg"`
		OnBoard    int      `json:"on_board"`
		Simulated  bool     `json:"simulated"`
	} `json:"vehicles"`
	Counts          liveCountsResp `json:"counts"`
	SimulatedCounts liveCountsResp `json:"simulated_counts"`
	PickupPoints    []struct {
		cityPlaceResp
		Waiting          int `json:"waiting"`
		SimulatedWaiting int `json:"simulated_waiting"`
	} `json:"pickup_points"`
	Simulated bool `json:"simulated"`
}

// realCounts is the live counts without the simulation.
func (r cityLiveResp) realCounts() liveCountsResp {
	return liveCountsResp{
		r.Counts.Vehicles - r.SimulatedCounts.Vehicles, r.Counts.OnBoard - r.SimulatedCounts.OnBoard,
		r.Counts.Waiting - r.SimulatedCounts.Waiting, r.Counts.Matched - r.SimulatedCounts.Matched,
	}
}

func (r cityLiveResp) realVehicles() int {
	n := 0
	for _, v := range r.Vehicles {
		if !v.Simulated {
			n++
		}
	}
	return n
}

func (r cityLiveResp) realWaitingAt(pickupID int64) int {
	for _, p := range r.PickupPoints {
		if p.ID == pickupID {
			return p.Waiting - p.SimulatedWaiting
		}
	}
	return -1
}

type cityTodayResp struct {
	cityClockResp
	Completed          int      `json:"completed"`
	Requests           int      `json:"requests"`
	Matched            int      `json:"matched"`
	MatchRate          *float64 `json:"match_rate"`
	NoMatch            int      `json:"no_match"`
	TripsSaved         int      `json:"trips_saved"`
	TripsSavedEstimate bool     `json:"trips_saved_estimate"`
	PickupPoints       []struct {
		cityPlaceResp
		Completed int `json:"completed"`
	} `json:"pickup_points"`
	Simulated bool `json:"simulated"`
}

func (r cityTodayResp) completedAt(pickupID int64) int {
	for _, p := range r.PickupPoints {
		if p.ID == pickupID {
			return p.Completed
		}
	}
	return -1
}

type cityHistoryResp struct {
	cityClockResp
	Days []struct {
		Date      string          `json:"date"`
		Weekday   int             `json:"weekday"`
		Rides     int             `json:"rides"`
		Weather   *commuteWeather `json:"weather"`
		Simulated bool            `json:"simulated"`
	} `json:"days"`
	PickupPoints []struct {
		cityPlaceResp
		DriversPerDay    float64 `json:"drivers_per_day"`
		PassengersPerDay float64 `json:"passengers_per_day"`
		RidesPerDay      float64 `json:"rides_per_day"`
	} `json:"pickup_points"`
	Simulated bool `json:"simulated"`
}

type cityTrafficResp struct {
	cityClockResp
	SlotStart time.Time `json:"slot_start"`
	Detectors []struct {
		VDID        string   `json:"vd_id"`
		RoadName    string   `json:"road_name"`
		Lat         float64  `json:"lat"`
		Lng         float64  `json:"lng"`
		Volume      int      `json:"volume"`
		AvgSpeedKmh *float64 `json:"avg_speed_kmh"`
		Simulated   bool     `json:"simulated"`
	} `json:"detectors"`
	Roads []struct {
		RoadName        string   `json:"road_name"`
		AvgSpeedKmh     *float64 `json:"avg_speed_kmh"`
		PastAvgSpeedKmh *float64 `json:"past_avg_speed_kmh"`
	} `json:"roads"`
	Simulated bool `json:"simulated"`
}

var cityPaths = []string{"/api/city/live", "/api/city/traffic", "/api/city/today", "/api/city/history"}

// DD-18, DD-39: city1 is seeded with only the city admin role; the role check is now "at least one
// of driver, passenger and city admin".
func TestCityAdminSeedAndRoleCheck(t *testing.T) {
	tx := testTx(t)
	var driver, passenger, city, simulated bool
	if err := tx.QueryRow(t.Context(), `SELECT is_driver, is_passenger, is_city_admin, simulated FROM users WHERE username = 'city1'`).
		Scan(&driver, &passenger, &city, &simulated); err != nil {
		t.Fatal(err)
	}
	if driver || passenger || !city || simulated {
		t.Errorf("city1: driver %v passenger %v city %v simulated %v, want city admin only, not a Demo account", driver, passenger, city, simulated)
	}
	if _, err := tx.Exec(t.Context(), `SAVEPOINT no_role`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(t.Context(), `INSERT INTO users (username, display_name) VALUES ('no-role', 'x')`); err == nil {
		t.Error("an account without any role was accepted")
	}
	if _, err := tx.Exec(t.Context(), `ROLLBACK TO SAVEPOINT no_role`); err != nil {
		t.Fatal(err)
	}
	mustExec(t, tx, `INSERT INTO users (username, display_name, is_driver, is_city_admin) VALUES ('driver-city', 'x', true, true)`)
}

// DD-39: only a city token calls /api/city/*; a city token calls nothing else, shared APIs included.
func TestCityRoleIsolation(t *testing.T) {
	tx := testTx(t)
	mustExec(t, tx, `INSERT INTO users (username, display_name, is_passenger) VALUES ('passenger-only', 'x', true)`)
	for _, path := range cityPaths {
		t.Run(path, func(t *testing.T) {
			wantStatus(t, call(t, tx, http.MethodGet, path, cityToken, ""), http.StatusOK, "")
			wantStatus(t, call(t, tx, http.MethodGet, path, "driver:driver1", ""), http.StatusForbidden, "forbidden")
			wantStatus(t, call(t, tx, http.MethodGet, path, "passenger:passenger1", ""), http.StatusForbidden, "forbidden")
			wantStatus(t, call(t, tx, http.MethodGet, path, "", ""), http.StatusUnauthorized, "unauthorized")
			// an account without the city role cannot use the city token form (DD-18)
			wantStatus(t, call(t, tx, http.MethodGet, path, "city:passenger-only", ""), http.StatusForbidden, "forbidden")
		})
	}
	others := []struct{ method, path string }{
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/pickup-points"},
		{http.MethodGet, "/api/bus-stops"},
		{http.MethodGet, "/api/park/check?lat=25.08&lng=121.57"},
		{http.MethodGet, "/api/tags"},
		{http.MethodPut, "/api/me/tags/1"},
		{http.MethodPost, "/api/activities"},
		{http.MethodPost, "/api/location"},
		{http.MethodGet, "/api/me/location-reports"},
		{http.MethodGet, "/api/trips/1"},
		{http.MethodGet, "/api/commute/traffic"},
		{http.MethodGet, "/api/commute/weather"},
		{http.MethodGet, "/api/commute/pickup-rides?pickup_point_id=1&from=08:00&to=08:30"},
		{http.MethodGet, "/api/driver/profile"},
		{http.MethodGet, "/api/driver/requests"},
		{http.MethodGet, "/api/passenger/profile"},
		{http.MethodGet, "/api/passenger/requests/current"},
	}
	for _, o := range others {
		t.Run("city token on "+o.method+" "+o.path, func(t *testing.T) {
			wantStatus(t, call(t, tx, o.method, o.path, cityToken, ""), http.StatusForbidden, "forbidden")
		})
	}
	// drivers and passengers keep the shared APIs
	wantStatus(t, call(t, tx, http.MethodGet, "/api/pickup-points", "driver:driver1", ""), http.StatusOK, "")
	wantStatus(t, call(t, tx, http.MethodGet, "/api/me", "passenger:passenger1", ""), http.StatusOK, "")
}

// REQ-081: no response carries an account, a display name or a plate, with a real passenger on
// board and after the ride is completed.
func TestCityResponsesHaveNoAccountNameOrPlate(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	real := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, e.tx, real)
	trip, _, id := e.confirmedRide(t)
	mustExec(t, e.tx, `INSERT INTO vehicles (user_id, plate, description) SELECT driver_id, 'ZZZ-9999', '紫色 測試車' FROM trips WHERE id = $1`, trip)
	rows, err := e.tx.Query(t.Context(), `SELECT username FROM users UNION SELECT display_name FROM users UNION SELECT plate FROM vehicles`)
	if err != nil {
		t.Fatal(err)
	}
	secrets, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	a := newCityApp(t, e.tx, real)
	check := func(stage string) {
		t.Helper()
		for _, path := range cityPaths {
			w := a.do(http.MethodGet, path, cityToken)
			wantStatus(t, w, http.StatusOK, "")
			body := w.Body.String()
			for _, s := range secrets {
				if strings.Contains(body, `"`+s+`"`) {
					t.Errorf("%s, %s contains %q", stage, path, s)
				}
			}
			for _, key := range []string{"username", "display_name", "plate", "passenger_name", "driver_id", "passenger_id", "trip_id"} {
				if strings.Contains(body, `"`+key+`"`) {
					t.Errorf("%s, %s has the field %q", stage, path, key)
				}
			}
		}
	}
	e.passengerAct(t, "board", id, e.token, http.StatusOK)
	check("on board")
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	check("completed")
}

// DD-39, DD-41: every city response carries now, today and whether demo_clock is set; with
// demo_clock at 08:15 now is today 08:15 whatever the real time, without it the real time.
func TestCityResponsesCarryTheClock(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)
	a := newCityApp(t, tx, sat)
	for _, path := range cityPaths {
		got := cityGet[cityClockResp](a, path)
		if !got.Now.Equal(taipeiTime(t, "2026-10-26 08:15")) || got.Today != "2026-10-26" || !got.DemoClock {
			t.Errorf("%s with demo_clock: %+v, want Monday 10/26 08:15 and demo_clock true", path, got)
		}
	}
	removeDemoClock(t, tx)
	real := taipeiTime(t, "2026-10-22 08:40")
	regenerateAt(t, tx, real)
	a = newCityApp(t, tx, real)
	for _, path := range cityPaths {
		got := cityGet[cityClockResp](a, path)
		if !got.Now.Equal(real) || got.Today != "2026-10-22" || got.DemoClock {
			t.Errorf("%s without demo_clock: %+v, want the real time and demo_clock false", path, got)
		}
	}
}

// REQ-078, DD-40 step 5: without any real trip the first live query already shows about 30-40
// simulated cars, labelled as simulated, with the pickup points' names and positions; the cars move
// along their routes as time passes; the same moment gives the same answer.
func TestCityLiveSimulatedCarsWithoutRealTrips(t *testing.T) {
	tx := testTx(t)
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE status = 'active'`)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-22 18:00")
	a := newCityApp(t, tx, start)
	first := cityGet[cityLiveResp](a, "/api/city/live")
	if n := len(first.Vehicles); n < 25 || n > liveSimMaxCars {
		t.Fatalf("%d cars at the first query, want about 30-40", n)
	}
	for _, v := range first.Vehicles {
		if !v.Simulated || v.HeadingDeg == nil {
			t.Fatalf("car %+v: want simulated with a heading", v)
		}
	}
	if !first.Simulated || first.Counts != first.SimulatedCounts || first.Counts.Vehicles != len(first.Vehicles) {
		t.Errorf("counts %+v, simulated %+v, cars %d", first.Counts, first.SimulatedCounts, len(first.Vehicles))
	}
	if len(first.PickupPoints) != 3 || first.PickupPoints[0].Name == "" || first.PickupPoints[0].Lat == 0 {
		t.Errorf("pickup points %+v, want the 3 with names and positions", first.PickupPoints)
	}
	if again := cityGet[cityLiveResp](a, "/api/city/live"); !jsonEqual(t, again, first) {
		t.Error("two queries at the same moment differ")
	}
	a.clock = start.Add(2 * time.Minute)
	later := cityGet[cityLiveResp](a, "/api/city/live")
	moved := 0
	for i := range min(len(first.Vehicles), len(later.Vehicles)) {
		if first.Vehicles[i].Lat != later.Vehicles[i].Lat || first.Vehicles[i].Lng != later.Vehicles[i].Lng {
			moved++
		}
	}
	if moved == 0 {
		t.Error("no car moved in 2 minutes")
	}
}

// DD-29, DD-40 step 5: the round started at the first query goes on until it ends, adds no car
// after that, and starts again after a Demo reset, with the same cars in the same order.
func TestCityLiveRoundEndsAndRestartsAfterReset(t *testing.T) {
	tx := testTx(t)
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE status = 'active'`)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-22 18:00")
	a := newCityApp(t, tx, start)
	first := cityGet[cityLiveResp](a, "/api/city/live")

	a.clock = start.Add(time.Hour)
	if n := len(cityGet[cityLiveResp](a, "/api/city/live").Vehicles); n != 0 {
		t.Fatalf("%d simulated cars after the round, want none", n)
	}
	a.clock = start.Add(3 * time.Hour)
	if n := len(cityGet[cityLiveResp](a, "/api/city/live").Vehicles); n != 0 {
		t.Fatalf("%d simulated cars long after the round, want none", n)
	}

	wantStatus(t, a.do(http.MethodPost, "/api/demo/reset", ""), http.StatusNoContent, "")
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE status = 'active'`) // the reset restarts driver1-3
	again := cityGet[cityLiveResp](a, "/api/city/live")
	if !jsonEqual(t, again.Vehicles, first.Vehicles) {
		t.Error("the round after the reset is not the same as the first")
	}
}

// REQ-078: a real trip's car shows at its latest report, with the passengers on it; the counts
// follow the request: sent -> waiting, confirmed -> matched, boarded -> on board.
func TestCityLiveCountsRealRequests(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	real := time.Now()
	a := newCityApp(t, e.tx, real)
	base := cityGet[cityLiveResp](a, "/api/city/live")
	if base.realCounts() != (liveCountsResp{}) || base.realVehicles() != 0 {
		t.Fatalf("real counts %+v, %d cars, want none", base.realCounts(), base.realVehicles())
	}

	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	r := e.submit(t, e.near(), nil)
	assigned(t, r, trip)
	got := cityGet[cityLiveResp](a, "/api/city/live")
	if got.realCounts() != (liveCountsResp{Vehicles: 1, Waiting: 1}) || got.realWaitingAt(e.pickupID) != 1 {
		t.Errorf("after the request: %+v, waiting at the pickup %d; want 1 car, 1 waiting", got.realCounts(), got.realWaitingAt(e.pickupID))
	}
	if got.realVehicles() != 1 {
		t.Errorf("%d real cars on the map, want 1", got.realVehicles())
	}

	e.answer(t, "accept", r.ID, driver, http.StatusOK)
	got = cityGet[cityLiveResp](a, "/api/city/live")
	if got.realCounts() != (liveCountsResp{Vehicles: 1, Matched: 1}) || got.realWaitingAt(e.pickupID) != 0 {
		t.Errorf("after the driver confirmed: %+v, want 1 matched", got.realCounts())
	}

	e.passengerAct(t, "board", r.ID, e.token, http.StatusOK)
	got = cityGet[cityLiveResp](a, "/api/city/live")
	if got.realCounts() != (liveCountsResp{Vehicles: 1, OnBoard: 1}) {
		t.Errorf("after boarding: %+v, want 1 on board", got.realCounts())
	}
	for _, v := range got.Vehicles {
		if !v.Simulated && v.OnBoard != 1 {
			t.Errorf("the real car carries %d, want 1", v.OnBoard)
		}
	}

	e.passengerAct(t, "complete", r.ID, e.token, http.StatusOK)
	if got := cityGet[cityLiveResp](a, "/api/city/live"); got.realCounts() != (liveCountsResp{Vehicles: 1}) {
		t.Errorf("after the ride: %+v, want only the car", got.realCounts())
	}
}

// REQ-063, REQ-078: the simulated cars are not real trips: the passenger's supply does not list them.
func TestCityLiveSimulationStaysOutOfSupply(t *testing.T) {
	e := newSupplyEnv(t)
	a := newCityApp(t, e.tx, time.Now())
	if live := cityGet[cityLiveResp](a, "/api/city/live"); len(live.Vehicles) == 0 {
		t.Fatal("no simulated cars")
	}
	if cars := carIDs(e.supply(t, nil)); len(cars) != 0 {
		t.Errorf("supply lists %v, want no car", cars)
	}
	if n := queryInt(t, e.tx, `SELECT count(*) FROM trips WHERE status = 'active'`); n != 0 {
		t.Errorf("%d active trips after the live query, want none written", n)
	}
}

func jsonEqual(t *testing.T, a, b any) bool {
	t.Helper()
	ja, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	jb, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	return string(ja) == string(jb)
}
