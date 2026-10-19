package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type reportView struct {
	ID           int64   `json:"id"`
	ActivityID   int64   `json:"activity_id"`
	TripID       *int64  `json:"trip_id"`
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	ReportedAt   string  `json:"reported_at"`
	PassedPickup *bool   `json:"passed_pickup"`
}

// newUser inserts a fresh account inside the test transaction, so a test never
// depends on what the seeded accounts have already reported.
func newUser(t *testing.T, tx pgx.Tx, role string) (id int64, token string) {
	t.Helper()
	name := "test-" + role + "-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	err := tx.QueryRow(context.Background(), `
		INSERT INTO users (username, display_name, is_driver, is_passenger) VALUES ($1, $1, $2, $3) RETURNING id`,
		name, role == roleDriver, role == rolePassenger).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id, role + ":" + name
}

type tripFixture struct {
	id       int64
	driverID int64
	token    string
	pickup   latLng
	radiusM  float64
}

// activeTrip starts a trip for a fresh driver at the first pickup point.
func activeTrip(t *testing.T, tx pgx.Tx) tripFixture {
	t.Helper()
	f := tripFixture{}
	f.driverID, f.token = newUser(t, tx, roleDriver)
	var pointID int64
	if err := tx.QueryRow(context.Background(), `SELECT id, lat, lng, radius_m FROM pickup_points ORDER BY id LIMIT 1`).
		Scan(&pointID, &f.pickup.Lat, &f.pickup.Lng, &f.radiusM); err != nil {
		t.Fatalf("no seeded pickup points: %v", err)
	}
	err := tx.QueryRow(context.Background(), `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status)
		VALUES ($1, $2, '測試目的地', 25.08, 121.57, 3, 'active') RETURNING id`, f.driverID, pointID).Scan(&f.id)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func offsetM(p latLng, northM float64) latLng { return latLng{p.Lat + northM*0.000009, p.Lng} }

func report(t *testing.T, tx pgx.Tx, token string, p latLng) reportView {
	t.Helper()
	body := `{"lat":` + ftoa(p.Lat) + `,"lng":` + ftoa(p.Lng) + `}`
	w := call(t, tx, http.MethodPost, "/api/location", token, body)
	wantStatus(t, w, http.StatusCreated, "")
	return decode[reportView](t, w)
}

// declare creates the caller's activity through the API and returns it.
func declare(t *testing.T, tx pgx.Tx, token string) activity {
	t.Helper()
	w := call(t, tx, http.MethodPost, "/api/activities", token, "")
	wantStatus(t, w, http.StatusCreated, "")
	return decode[activity](t, w)
}

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func TestDriverPassesPickup(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	tripID, pickup, radius, token := trip.id, trip.pickup, trip.radiusM, trip.token
	if a := declare(t, tx, token); a.Role != roleDriver || a.TripID == nil || *a.TripID != tripID {
		t.Fatalf("activity = %+v, want a driver activity on trip %d", a, tripID)
	}

	for i, step := range []struct {
		north  float64
		passed bool
	}{
		{800, false}, {300, false}, {radius - 10, false}, {5, false}, // approach and enter
		{radius + 10, false}, // jitter just outside the radius: inside the margin
		{radius + 40, true},  // leave beyond the margin: passed
		{radius + 400, true}, // stays passed
		{5, true},            // coming back does not undo it
	} {
		got := report(t, tx, token, offsetM(pickup, step.north))
		if got.PassedPickup == nil || *got.PassedPickup != step.passed {
			t.Fatalf("step %d (%.0f m): passed_pickup = %v, want %v", i, step.north, got.PassedPickup, step.passed)
		}
		if got.TripID == nil || *got.TripID != tripID {
			t.Fatalf("step %d: trip_id = %v, want %d", i, got.TripID, tripID)
		}
	}

	var passed, hasTime bool
	if err := tx.QueryRow(context.Background(),
		`SELECT passed_pickup, passed_pickup_at IS NOT NULL FROM trips WHERE id = $1`, tripID).Scan(&passed, &hasTime); err != nil {
		t.Fatal(err)
	}
	if !passed || !hasTime {
		t.Fatalf("trip passed_pickup=%v passed_pickup_at set=%v, want both true", passed, hasTime)
	}
}

// The margin is read from system_settings on every report, so SQL edits apply at once.
func TestPassMarginIsConfigurable(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	declare(t, tx, trip.token)
	mustExec(t, tx, `UPDATE system_settings SET value = 0 WHERE key = 'pass_margin'`)

	report(t, tx, trip.token, offsetM(trip.pickup, 5))
	got := report(t, tx, trip.token, offsetM(trip.pickup, trip.radiusM+10))
	if got.PassedPickup == nil || !*got.PassedPickup {
		t.Fatalf("passed_pickup = %v with a zero margin, want true", got.PassedPickup)
	}

	trip = activeTrip(t, tx)
	declare(t, tx, trip.token)
	mustExec(t, tx, `UPDATE system_settings SET value = 100 WHERE key = 'pass_margin'`)
	report(t, tx, trip.token, offsetM(trip.pickup, 5))
	got = report(t, tx, trip.token, offsetM(trip.pickup, trip.radiusM+60))
	if got.PassedPickup == nil || *got.PassedPickup {
		t.Fatalf("passed_pickup = %v with a 100 m margin at +60 m, want false", got.PassedPickup)
	}
}

func TestAllReportsAreKept(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	pickup, token := trip.pickup, trip.token
	declare(t, tx, token)
	var sent []latLng
	for _, n := range []float64{500, 400, 400, 300, 10, -80} { // includes a repeated position
		p := offsetM(pickup, n)
		sent = append(sent, p)
		report(t, tx, token, p)
	}

	w := call(t, tx, http.MethodGet, "/api/me/location-reports", token, "")
	wantStatus(t, w, http.StatusOK, "")
	got := decode[[]reportView](t, w)
	if len(got) != len(sent) {
		t.Fatalf("got %d reports, want %d", len(got), len(sent))
	}
	for i := range sent {
		if got[i].ReportedAt == "" {
			t.Fatalf("report %d has no reported_at", i)
		}
		if got[i].Lat != sent[i].Lat || got[i].Lng != sent[i].Lng {
			t.Fatalf("report %d = (%v,%v), want (%v,%v)", i, got[i].Lat, got[i].Lng, sent[i].Lat, sent[i].Lng)
		}
	}

	// Append-only: the trigger rejects rewriting history. Each attempt runs in its
	// own savepoint, since a failed statement aborts the surrounding transaction.
	for _, stmt := range []string{`UPDATE location_reports SET lat = 0`, `DELETE FROM location_reports`} {
		sp, err := tx.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sp.Exec(context.Background(), stmt); err == nil {
			t.Fatalf("%q should be rejected", stmt)
		}
		_ = sp.Rollback(context.Background())
	}
}

func TestPassengerReports(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, rolePassenger)
	declare(t, tx, token)

	first := latLng{25.0800, 121.5700}
	last := latLng{25.0850, 121.5750}
	for _, p := range []latLng{first, last} {
		if r := report(t, tx, token, p); r.TripID != nil || r.PassedPickup != nil {
			t.Fatalf("passenger report has trip_id %v passed_pickup %v, want neither", r.TripID, r.PassedPickup)
		}
	}

	// Every passenger report can be read back.
	w := call(t, tx, http.MethodGet, "/api/me/location-reports", token, "")
	wantStatus(t, w, http.StatusOK, "")
	list := decode[[]reportView](t, w)
	if len(list) != 2 || list[0].Lat != first.Lat || list[1].Lat != last.Lat || list[0].ReportedAt == "" {
		t.Fatalf("reports = %+v, want the two sent", list)
	}
}

// A passenger on the same trip can be inside and outside the pickup range without
// affecting whether the trip has passed it: only the driver's reports count.
func TestPassengerReportsDoNotPassThePickup(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	_, passenger := newUser(t, tx, rolePassenger)

	declare(t, tx, trip.token)
	pa := declare(t, tx, passenger)
	// Link the passenger's activity to the trip, as the request flow will on confirmation.
	mustExec(t, tx, `UPDATE activities SET trip_id = $1 WHERE id = $2`, trip.id, pa.ID)

	// The driver is still approaching and never inside the range.
	got := report(t, tx, trip.token, offsetM(trip.pickup, trip.radiusM+300))
	// The passenger walks into the range and out again.
	for _, north := range []float64{trip.radiusM + 100, 5, trip.radiusM + 100} {
		if r := report(t, tx, passenger, offsetM(trip.pickup, north)); r.PassedPickup != nil {
			t.Fatalf("passenger report carries passed_pickup %v, want none", *r.PassedPickup)
		}
	}
	got = report(t, tx, trip.token, offsetM(trip.pickup, trip.radiusM+250))
	if got.PassedPickup == nil {
		t.Fatal("driver report has no passed_pickup")
	}
	if *got.PassedPickup {
		t.Fatal("passed_pickup = true after only the passenger entered and left, want false")
	}
}

func TestReportLocationRejections(t *testing.T) {
	tx := testTx(t)
	_, driver := newUser(t, tx, roleDriver) // no trip
	_, passenger := newUser(t, tx, rolePassenger)

	// No activity yet: nothing is stored, for either role.
	for _, token := range []string{driver, passenger} {
		w := call(t, tx, http.MethodPost, "/api/location", token, `{"lat":25.08,"lng":121.57}`)
		wantStatus(t, w, http.StatusConflict, "no_activity")
	}
	// A driver without an active trip cannot take part.
	wantStatus(t, call(t, tx, http.MethodPost, "/api/activities", driver, ""), http.StatusConflict, "no_active_trip")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/activities", "", ""), http.StatusUnauthorized, "unauthorized")
	declare(t, tx, passenger)

	for _, body := range []string{``, `{}`, `{"lat":25.08}`, `{"lat":91,"lng":121.57}`, `{"lat":25.08,"lng":181}`, `{"lat":"x","lng":1}`} {
		w := call(t, tx, http.MethodPost, "/api/location", passenger, body)
		wantStatus(t, w, http.StatusBadRequest, "invalid_location")
	}
	wantStatus(t, call(t, tx, http.MethodPost, "/api/location", "", `{"lat":25.08,"lng":121.57}`), http.StatusUnauthorized, "unauthorized")
}

// Declaring again starts a new activity; reports follow the latest one.
func TestReportsFollowLatestActivity(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, rolePassenger)
	first := declare(t, tx, token)
	if first.Role != rolePassenger || first.TripID != nil {
		t.Fatalf("activity = %+v, want a passenger activity with no trip", first)
	}
	if got := report(t, tx, token, latLng{25.08, 121.57}); got.ActivityID != first.ID {
		t.Fatalf("activity_id = %d, want %d", got.ActivityID, first.ID)
	}
	second := declare(t, tx, token)
	if second.ID == first.ID {
		t.Fatal("declaring again should create a new activity")
	}
	if got := report(t, tx, token, latLng{25.081, 121.571}); got.ActivityID != second.ID {
		t.Fatalf("activity_id = %d, want %d", got.ActivityID, second.ID)
	}
}

// Every seeded driver has exactly one vehicle (REQ-052); passengers have none.
func TestSeededVehicles(t *testing.T) {
	tx := testTx(t)
	rows, err := tx.Query(context.Background(), `
		SELECT u.username, count(v.user_id) FROM users u LEFT JOIN vehicles v ON v.user_id = u.id
		 WHERE u.username IN ('driver1','driver2','driver3','driver4','driver5','passenger1','passenger2')
		 GROUP BY u.username`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var name string
		var vehicles int
		if err := rows.Scan(&name, &vehicles); err != nil {
			t.Fatal(err)
		}
		want := 0
		if strings.HasPrefix(name, "driver") {
			want = 1
		}
		if vehicles != want {
			t.Errorf("%s has %d vehicles, want %d", name, vehicles, want)
		}
		n++
	}
	if n != 7 {
		t.Fatalf("found %d seeded accounts, want 7", n)
	}
}

func TestSeededPassMargin(t *testing.T) {
	tx := testTx(t)
	var v float64
	var unit string
	if err := tx.QueryRow(context.Background(), `SELECT value::float8, unit FROM system_settings WHERE key = 'pass_margin'`).Scan(&v, &unit); err != nil {
		t.Fatalf("pass_margin setting missing: %v", err)
	}
	if v != 25 || unit != "m" {
		t.Fatalf("pass_margin = %v %s, want 25 m", v, unit)
	}
}
