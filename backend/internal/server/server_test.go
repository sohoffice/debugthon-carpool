package server

import (
	"context"
	"net/http"
	"testing"
)

func TestPing(t *testing.T) {
	w := call(t, testTx(t), http.MethodGet, "/api/ping", "", "")
	wantStatus(t, w, http.StatusOK, "")
}

func TestAuth(t *testing.T) {
	tx := testTx(t)
	mustExec(t, tx, `INSERT INTO users (username, display_name, is_driver, is_passenger) VALUES ('dual', 'Dual', true, true)`)

	cases := []struct {
		name   string
		token  string
		status int
		code   string
	}{
		{"valid passenger", "passenger:passenger1", http.StatusOK, ""},
		{"valid driver", "driver:driver1", http.StatusOK, ""},
		{"dual-role account as driver", "driver:dual", http.StatusOK, ""},
		{"dual-role account as passenger", "passenger:dual", http.StatusOK, ""},
		{"missing header", "", http.StatusUnauthorized, "unauthorized"},
		{"malformed token", "driver1", http.StatusUnauthorized, "unauthorized"},
		{"unknown role", "admin:driver1", http.StatusUnauthorized, "unauthorized"},
		{"unknown account", "driver:nobody", http.StatusUnauthorized, "unauthorized"},
		{"driver account with passenger role", "passenger:driver1", http.StatusForbidden, "forbidden"},
		{"passenger account with driver role", "driver:passenger1", http.StatusForbidden, "forbidden"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantStatus(t, call(t, tx, http.MethodGet, "/api/me", tc.token, ""), tc.status, tc.code)
		})
	}
}

func TestMe(t *testing.T) {
	tx := testTx(t)
	type me struct {
		Username    string   `json:"username"`
		DisplayName string   `json:"display_name"`
		Role        string   `json:"role"`
		Roles       []string `json:"roles"`
		Simulated   bool     `json:"simulated"`
	}
	got := decode[me](t, call(t, tx, http.MethodGet, "/api/me", "driver:driver1", ""))
	if got.Username != "driver1" || got.Role != "driver" || len(got.Roles) != 1 || got.Roles[0] != "driver" || !got.Simulated {
		t.Fatalf("unexpected /api/me: %+v", got)
	}
}

func TestRoleRestrictedAPIs(t *testing.T) {
	tx := testTx(t)
	cases := []struct {
		name, path, token string
		status            int
	}{
		{"passenger token on driver API", "/api/driver/profile", "passenger:passenger1", http.StatusForbidden},
		{"driver token on passenger API", "/api/passenger/profile", "driver:driver1", http.StatusForbidden},
		{"driver token on driver API", "/api/driver/profile", "driver:driver1", http.StatusOK},
		{"passenger token on passenger API", "/api/passenger/profile", "passenger:passenger1", http.StatusOK},
		{"no token on driver API", "/api/driver/profile", "", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := call(t, tx, http.MethodGet, tc.path, tc.token, "")
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d", w.Code, tc.status)
			}
		})
	}
}

func TestUnknownRouteUsesErrorFormat(t *testing.T) {
	w := call(t, testTx(t), http.MethodGet, "/api/nope", "driver:driver1", "")
	wantStatus(t, w, http.StatusNotFound, "not_found")
}

func TestProfiles(t *testing.T) {
	tx := testTx(t)

	// Fresh accounts have no accumulated data yet (DD-19).
	type place struct {
		Name string  `json:"name"`
		Lat  float64 `json:"lat"`
		Lng  float64 `json:"lng"`
	}
	type pickup struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	type driverProfile struct {
		UsualPickupPoint *pickup `json:"usual_pickup_point"`
		UsualDestination *place  `json:"usual_destination"`
		Capacity         *int    `json:"capacity"`
	}
	d := decode[driverProfile](t, call(t, tx, http.MethodGet, "/api/driver/profile", "driver:driver1", ""))
	if d.UsualPickupPoint != nil || d.UsualDestination != nil || d.Capacity != nil {
		t.Fatalf("expected empty driver profile, got %+v", d)
	}

	var pickupID, stopID int64
	var pickupName, stopName string
	seed := func(sql string, dest ...any) {
		if err := tx.QueryRow(context.Background(), sql).Scan(dest...); err != nil {
			t.Fatalf("no seeded reference data (apply the seed migration): %v", err)
		}
	}
	seed(`SELECT id, name FROM pickup_points ORDER BY id LIMIT 1`, &pickupID, &pickupName)
	seed(`SELECT id, name FROM bus_stops ORDER BY id LIMIT 1`, &stopID, &stopName)
	mustExec(t, tx, `INSERT INTO driver_profiles (user_id, usual_pickup_point_id, usual_destination_name, usual_destination_lat, usual_destination_lng, capacity)
		SELECT id, $1, 'Home', 24.9, 121.4, 3 FROM users WHERE username = 'driver1'`, pickupID)
	mustExec(t, tx, `INSERT INTO passenger_profiles (user_id, usual_arrival_time, usual_destination_name, usual_destination_lat, usual_destination_lng)
		SELECT id, '09:30', 'Office', 25.2, 121.7 FROM users WHERE username = 'passenger1'`)
	mustExec(t, tx, `INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) SELECT id, $1 FROM users WHERE username = 'passenger1'`, stopID)

	d = decode[driverProfile](t, call(t, tx, http.MethodGet, "/api/driver/profile", "driver:driver1", ""))
	if d.UsualPickupPoint == nil || d.UsualPickupPoint.Name != pickupName || d.UsualDestination == nil || d.UsualDestination.Name != "Home" || d.Capacity == nil || *d.Capacity != 3 {
		t.Fatalf("unexpected driver profile: %+v", d)
	}

	type stop struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	type passengerProfile struct {
		UsualArrivalTime *string `json:"usual_arrival_time"`
		UsualDestination *place  `json:"usual_destination"`
		AcceptedStops    []stop  `json:"accepted_stops"`
	}
	p := decode[passengerProfile](t, call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger1", ""))
	if p.UsualArrivalTime == nil || *p.UsualArrivalTime != "09:30" || p.UsualDestination == nil || p.UsualDestination.Name != "Office" ||
		len(p.AcceptedStops) != 1 || p.AcceptedStops[0].Name != stopName {
		t.Fatalf("unexpected passenger profile: %+v", p)
	}

	p = decode[passengerProfile](t, call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger2", ""))
	if p.UsualArrivalTime != nil || p.UsualDestination != nil || len(p.AcceptedStops) != 0 {
		t.Fatalf("expected empty passenger profile, got %+v", p)
	}
}

func TestReferenceData(t *testing.T) {
	tx := testTx(t)

	type pickup struct {
		ID      int64   `json:"id"`
		Name    string  `json:"name"`
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
		RadiusM int     `json:"radius_m"`
	}
	type stop struct {
		ID     int64   `json:"id"`
		StopID *int    `json:"stop_id"`
		Name   string  `json:"name"`
		Lat    float64 `json:"lat"`
		Lng    float64 `json:"lng"`
	}

	// The API must return exactly what the seed put in the tables.
	var wantPickup pickup
	var wantStop stop
	ctx := context.Background()
	if err := tx.QueryRow(ctx, `SELECT id, name, lat, lng, radius_m FROM pickup_points ORDER BY id LIMIT 1`).
		Scan(&wantPickup.ID, &wantPickup.Name, &wantPickup.Lat, &wantPickup.Lng, &wantPickup.RadiusM); err != nil {
		t.Fatalf("no seeded pickup points (apply the seed migration): %v", err)
	}
	if err := tx.QueryRow(ctx, `SELECT id, stop_id, name, lat, lng FROM bus_stops ORDER BY id LIMIT 1`).
		Scan(&wantStop.ID, &wantStop.StopID, &wantStop.Name, &wantStop.Lat, &wantStop.Lng); err != nil {
		t.Fatalf("no seeded bus stops (apply the seed migration): %v", err)
	}

	for _, token := range []string{"driver:driver1", "passenger:passenger1"} {
		pickups := decode[[]pickup](t, call(t, tx, http.MethodGet, "/api/pickup-points", token, ""))
		if len(pickups) == 0 || pickups[0] != wantPickup {
			t.Fatalf("%s: first pickup point = %+v, want %+v", token, pickups, wantPickup)
		}
		stops := decode[[]stop](t, call(t, tx, http.MethodGet, "/api/bus-stops", token, ""))
		if len(stops) == 0 || stops[0].ID != wantStop.ID || !sameStopID(stops[0].StopID, wantStop.StopID) || stops[0].Name != wantStop.Name || stops[0].Lat != wantStop.Lat || stops[0].Lng != wantStop.Lng {
			t.Fatalf("%s: first bus stop = %+v, want %+v", token, stops, wantStop)
		}
	}

	wantStatus(t, call(t, tx, http.MethodGet, "/api/pickup-points", "", ""), http.StatusUnauthorized, "unauthorized")
	wantStatus(t, call(t, tx, http.MethodGet, "/api/bus-stops", "", ""), http.StatusUnauthorized, "unauthorized")
}

// Habitual data is accumulated from rides, never filled in by users (DD-19).
func TestProfilesAreReadOnly(t *testing.T) {
	tx := testTx(t)
	cases := []struct{ path, token string }{
		{"/api/driver/profile", "driver:driver1"},
		{"/api/passenger/profile", "passenger:passenger1"},
	}
	for _, tc := range cases {
		for _, method := range []string{http.MethodPut, http.MethodPost, http.MethodPatch, http.MethodDelete} {
			t.Run(method+" "+tc.path, func(t *testing.T) {
				w := call(t, tx, method, tc.path, tc.token, `{"capacity":9}`)
				wantStatus(t, w, http.StatusMethodNotAllowed, "method_not_allowed")
			})
		}
	}
}

func TestMethodNotAllowedUsesErrorFormat(t *testing.T) {
	w := call(t, testTx(t), http.MethodPost, "/api/tags", "driver:driver1", `{"name":"free-text"}`)
	wantStatus(t, w, http.StatusMethodNotAllowed, "method_not_allowed")
	if decode[errBody](t, w).Error.Message == "" {
		t.Fatal("405 body has no message")
	}
}

// sameStopID compares the nullable open-data stop ids by value.
func sameStopID(a, b *int) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
