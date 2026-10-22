package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

type tripResp struct {
	ID            int64       `json:"id"`
	Status        string      `json:"status"`
	Capacity      int         `json:"capacity"`
	SeatsHeld     int         `json:"seats_held"`
	SeatsConfirmd int         `json:"seats_confirmed"`
	SeatsFree     int         `json:"seats_available"`
	AutoAccept    bool        `json:"auto_accept"`
	Locked        bool        `json:"settings_locked"`
	PickupPoint   pickupPoint `json:"pickup_point"`
	Destination   place       `json:"destination"`
	TagFilters    []struct {
		TagID  int64  `json:"tag_id"`
		Name   string `json:"name"`
		Intent string `json:"intent"`
	} `json:"tag_filters"`
	Route *struct {
		Polyline  string    `json:"polyline"`
		DistanceM int       `json:"distance_m"`
		DurationS int       `json:"duration_s"`
		Simulated bool      `json:"simulated"`
		BusStops  []busStop `json:"bus_stops"`
	} `json:"route"`
}

type defaultsResp struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Destination   *place `json:"destination"`
	Capacity      *int   `json:"capacity"`
	AutoAccept    bool   `json:"auto_accept"`
	TagFilters    []struct {
		TagID  int64  `json:"tag_id"`
		Intent string `json:"intent"`
	} `json:"tag_filters"`
}

const (
	inPark  = `{"name":"瑞光路 內科大樓 A","lat":25.0768,"lng":121.5738}`
	outPark = `{"name":"台北車站","lat":25.0478,"lng":121.5170}`
)

func firstPickupID(t *testing.T, db DB) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(context.Background(), `SELECT min(id) FROM pickup_points`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func departJSON(pickupID int64, destination string, extra string) string {
	b := `{"pickup_point_id":` + itoa(pickupID) + `,"destination":` + destination + `,"capacity":3,"auto_accept":true`
	if extra != "" {
		b += "," + extra
	}
	return b + "}"
}

func itoa(n int64) string { return ftoa(float64(n)) }

func TestDepartStartsALockedTripWithRoute(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)

	var tagID int64
	if err := tx.QueryRow(context.Background(), `SELECT min(id) FROM tags`).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	body := departJSON(pickupID, inPark, `"tag_filters":[{"tag_id":`+itoa(tagID)+`,"intent":"required"}]`)
	w := call(t, tx, http.MethodPost, "/api/driver/trips", token, body)
	wantStatus(t, w, http.StatusCreated, "")
	v := decode[tripResp](t, w)

	if v.Status != "active" || !v.Locked || !v.AutoAccept || v.Capacity != 3 || v.SeatsFree != 3 || v.PickupPoint.ID != pickupID {
		t.Fatalf("trip = %+v, want active, locked, auto-accept, 3 free seats at pickup %d", v, pickupID)
	}
	if v.Destination.Name != "瑞光路 內科大樓 A" {
		t.Errorf("destination = %+v", v.Destination)
	}
	if len(v.TagFilters) != 1 || v.TagFilters[0].TagID != tagID || v.TagFilters[0].Intent != "required" || v.TagFilters[0].Name == "" {
		t.Errorf("tag filters = %+v", v.TagFilters)
	}
	if v.Route == nil || v.Route.Polyline == "" || v.Route.DistanceM <= 0 || v.Route.BusStops == nil {
		t.Fatalf("route = %+v, want a stored route with a (possibly empty) bus stop list", v.Route)
	}

	// Departing is the driver declaring they take part (DD-25): no POST /api/activities needed,
	// and the simulator can report straight away.
	r := report(t, tx, token, latLng{25.05, 121.58})
	if r.TripID == nil || *r.TripID != v.ID {
		t.Fatalf("report trip_id = %v, want %d", r.TripID, v.ID)
	}

	// The same trip can be read back.
	got := decode[tripResp](t, call(t, tx, http.MethodGet, "/api/trips/"+itoa(v.ID), token, ""))
	if got.ID != v.ID || got.Route == nil || got.Route.Polyline != v.Route.Polyline {
		t.Fatalf("GET trip = %+v", got)
	}
	cur := call(t, tx, http.MethodGet, "/api/driver/trips/current", token, "")
	wantStatus(t, cur, http.StatusOK, "")
	if decode[tripResp](t, cur).ID != v.ID {
		t.Error("current trip is not the one just started")
	}
}

func TestDepartListsBusStopsAlongTheRoute(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	var pickupID int64
	var pickup latLng
	if err := tx.QueryRow(context.Background(), `SELECT id, lat, lng FROM pickup_points ORDER BY id LIMIT 1`).
		Scan(&pickupID, &pickup.Lat, &pickup.Lng); err != nil {
		t.Fatal(err)
	}
	dest := latLng{25.0768, 121.5738}
	mid := latLng{(pickup.Lat + dest.Lat) / 2, (pickup.Lng + dest.Lng) / 2}
	var stopID int64
	if err := tx.QueryRow(context.Background(),
		`INSERT INTO bus_stops (name, lat, lng) VALUES ('test midpoint stop', $1, $2) RETURNING id`, mid.Lat, mid.Lng).
		Scan(&stopID); err != nil {
		t.Fatal(err)
	}

	w := call(t, tx, http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark, ""))
	wantStatus(t, w, http.StatusCreated, "")
	v := decode[tripResp](t, w)
	found := false
	for _, s := range v.Route.BusStops {
		found = found || s.ID == stopID
	}
	if !found {
		t.Fatalf("bus stops = %+v, want the stop on the line (id %d)", v.Route.BusStops, stopID)
	}
}

func TestDepartRejections(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)

	for _, c := range []struct {
		name, body, code string
	}{
		{"pickup point not in the list", departJSON(999999, inPark, ""), "invalid_pickup_point"},
		{"destination outside the park", departJSON(pickupID, outPark, ""), "destination_outside_park"},
		{"no capacity", strings.Replace(departJSON(pickupID, inPark, ""), `"capacity":3`, `"capacity":0`, 1), "invalid_request"},
		{"unknown tag", departJSON(pickupID, inPark, `"tag_filters":[{"tag_id":999999,"intent":"required"}]`), "invalid_tag"},
		{"bad intent", departJSON(pickupID, inPark, `"tag_filters":[{"tag_id":1,"intent":"must"}]`), "invalid_request"},
		{"not json", `nope`, "invalid_request"},
	} {
		t.Run(c.name, func(t *testing.T) {
			wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", token, c.body), http.StatusBadRequest, c.code)
		})
	}

	var n int
	if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM trips WHERE driver_id = (SELECT id FROM users WHERE username = $1)`,
		strings.TrimPrefix(token, "driver:")).Scan(&n); err != nil || n != 0 {
		t.Fatalf("%d trips exist after rejected departures (err %v), want none", n, err)
	}
}

func TestDepartRoleAndAuth(t *testing.T) {
	tx := testTx(t)
	_, passenger := newUser(t, tx, rolePassenger)
	body := departJSON(firstPickupID(t, tx), inPark, "")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", "", body), http.StatusUnauthorized, "unauthorized")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", passenger, body), http.StatusForbidden, "forbidden")
}

func TestDepartWhileActiveIsRefused(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	body := departJSON(firstPickupID(t, tx), inPark, "")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", token, body), http.StatusCreated, "")
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/trips", token, body), http.StatusConflict, "already_active")
}

func TestDefaultsFollowTheLastTrip(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)

	w := call(t, tx, http.MethodGet, "/api/driver/trips/defaults", token, "")
	wantStatus(t, w, http.StatusOK, "")
	if d := decode[defaultsResp](t, w); d.PickupPointID != nil || d.Destination != nil || d.Capacity != nil || d.TagFilters == nil || len(d.TagFilters) != 0 {
		t.Fatalf("defaults for a new driver = %+v, want empty", d)
	}
	wantStatus(t, call(t, tx, http.MethodGet, "/api/driver/trips/current", token, ""), http.StatusNotFound, "not_found")

	pickupID := firstPickupID(t, tx)
	var tagID int64
	if err := tx.QueryRow(context.Background(), `SELECT min(id) FROM tags`).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	body := departJSON(pickupID, inPark, `"tag_filters":[{"tag_id":`+itoa(tagID)+`,"intent":"required"}]`)
	v := decode[tripResp](t, call(t, tx, http.MethodPost, "/api/driver/trips", token, body))
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE id = $1`, v.ID)

	d := decode[defaultsResp](t, call(t, tx, http.MethodGet, "/api/driver/trips/defaults", token, ""))
	if d.PickupPointID == nil || *d.PickupPointID != pickupID || d.Destination == nil || d.Destination.Name != "瑞光路 內科大樓 A" ||
		d.Capacity == nil || *d.Capacity != 3 || !d.AutoAccept ||
		len(d.TagFilters) != 1 || d.TagFilters[0].TagID != tagID || d.TagFilters[0].Intent != "required" {
		t.Fatalf("defaults = %+v, want the last trip's settings", d)
	}
}

// Settings are a snapshot taken at departure and no API can change them (REQ-019, DD-07).
func TestSettingsAreLockedAndCannotBeModified(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	v := decode[tripResp](t, call(t, tx, http.MethodPost, "/api/driver/trips", token, departJSON(firstPickupID(t, tx), inPark, "")))
	if !v.Locked {
		t.Fatal("trip is not settings_locked after departure")
	}

	path := "/api/driver/trips/" + itoa(v.ID)
	for _, method := range []string{http.MethodPatch, http.MethodPut, http.MethodPost, http.MethodDelete} {
		w := call(t, tx, method, path, token, `{"auto_accept":false,"tag_filters":[]}`)
		wantStatus(t, w, http.StatusNotFound, "not_found")
	}
	got := decode[tripResp](t, call(t, tx, http.MethodGet, "/api/trips/"+itoa(v.ID), token, ""))
	if !got.AutoAccept || !got.Locked {
		t.Fatalf("settings changed: %+v", got)
	}
}

// A trip created with SQL has no route yet; the first read builds and stores it (DD-21).
func TestFirstUseBuildsAMissingRoute(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	var before *string
	if err := tx.QueryRow(context.Background(), `SELECT route_polyline FROM trips WHERE id = $1`, trip.id).Scan(&before); err != nil || before != nil {
		t.Fatalf("fixture route = %v (err %v), want null", before, err)
	}

	w := call(t, tx, http.MethodGet, "/api/trips/"+itoa(trip.id), trip.token, "")
	wantStatus(t, w, http.StatusOK, "")
	v := decode[tripResp](t, w)
	if v.Route == nil || v.Route.Polyline == "" || !v.Route.Simulated || v.Route.BusStops == nil {
		t.Fatalf("route = %+v, want a freshly built simulated route", v.Route)
	}

	var stored string
	if err := tx.QueryRow(context.Background(), `SELECT route_polyline FROM trips WHERE id = $1`, trip.id).Scan(&stored); err != nil || stored != v.Route.Polyline {
		t.Fatalf("stored polyline = %q (err %v), want %q", stored, err, v.Route.Polyline)
	}
	wantStatus(t, call(t, tx, http.MethodGet, "/api/trips/999999999", trip.token, ""), http.StatusNotFound, "not_found")
}
