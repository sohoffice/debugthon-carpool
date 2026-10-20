package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// shiftingRoutes returns a different route on every call, so a test can tell whether a route
// was planned again or taken from the preview. Every route passes through the midpoint of the
// two points, so a stop placed there is always along it.
type shiftingRoutes struct {
	calls     int
	simulated bool
}

func (r *shiftingRoutes) Route(_ context.Context, from, to latLng) (Route, error) {
	r.calls++
	off := float64(r.calls) * 0.001
	points := []latLng{from, midpoint(from, to), to, {to.Lat + off, to.Lng + off}}
	return Route{Points: points, Polyline: encodePolyline(points), DistanceM: 1000 * r.calls, DurationS: 100 * r.calls, Simulated: r.simulated}, nil
}

// one router for the whole test, because the preview cache lives in it.
func routerWith(t *testing.T, db DB, routes RouteProvider) func(method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	deps := testDeps(t)
	deps.Routes = routes
	h := NewRouter(db, deps)
	return func(method, path, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
}

func midpoint(a, b latLng) latLng { return latLng{(a.Lat + b.Lat) / 2, (a.Lng + b.Lng) / 2} }

func previewJSON(pickupID int64, lat, lng string) string {
	return `{"pickup_point_id":` + itoa(pickupID) + `,"destination":{"lat":` + lat + `,"lng":` + lng + `}}`
}

// countTrips counts one driver's trips: the transaction runs at READ COMMITTED, so trips that
// other backends commit meanwhile must not be counted.
func countTrips(t *testing.T, db DB, driverID int64) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM trips WHERE driver_id = $1`, driverID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// DD-21, REQ-003: a preview returns the route and the stops along it in the departure's format,
// and creates no trip.
func TestPreviewReturnsRouteAndBusStopsWithoutATrip(t *testing.T) {
	tx := testTx(t)
	driverID, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	do := routerWith(t, tx, straightRoute{})

	before := countTrips(t, tx, driverID)
	w := do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, "25.0768", "121.5738"))
	wantStatus(t, w, http.StatusOK, "")
	v := decode[struct {
		Route struct {
			Polyline  string    `json:"polyline"`
			DistanceM int       `json:"distance_m"`
			DurationS int       `json:"duration_s"`
			Simulated bool      `json:"simulated"`
			BusStops  []busStop `json:"bus_stops"`
		} `json:"route"`
	}](t, w)
	if v.Route.Polyline == "" || v.Route.DistanceM <= 0 || v.Route.DurationS <= 0 || !v.Route.Simulated || v.Route.BusStops == nil {
		t.Fatalf("route = %+v, want polyline, distance, duration, simulated flag and a bus stop list", v.Route)
	}
	if countTrips(t, tx, driverID) != before {
		t.Fatal("preview created a trip")
	}
	wantStatus(t, do(http.MethodGet, "/api/driver/trips/current", token, ""), http.StatusNotFound, "not_found")
}

// DD-21: departing with the same pickup point and destination uses the previewed route and bus
// stops, even though planning again would give another route; the destination name is not part
// of the match.
func TestDepartUsesThePreviewedRoute(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	routes := &shiftingRoutes{}
	do := routerWith(t, tx, routes)
	var pickup latLng
	if err := tx.QueryRow(context.Background(), `SELECT lat, lng FROM pickup_points WHERE id = $1`, pickupID).Scan(&pickup.Lat, &pickup.Lng); err != nil {
		t.Fatal(err)
	}
	mid := midpoint(pickup, latLng{25.0768, 121.5738})
	mustExec(t, tx, `INSERT INTO bus_stops (name, lat, lng) VALUES ('test midpoint stop', $1, $2)`, mid.Lat, mid.Lng)

	pw := do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, "25.0768", "121.5738"))
	wantStatus(t, pw, http.StatusOK, "")
	previewed := decode[struct {
		Route struct {
			Polyline string    `json:"polyline"`
			BusStops []busStop `json:"bus_stops"`
		} `json:"route"`
	}](t, pw).Route

	if len(previewed.BusStops) == 0 {
		t.Fatal("previewed route has no bus stops, so the comparison below would prove nothing")
	}
	dw := do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, `{"name":"another name","lat":25.0768,"lng":121.5738}`, ""))
	wantStatus(t, dw, http.StatusCreated, "")
	trip := decode[tripResp](t, dw)
	if routes.calls != 1 {
		t.Fatalf("route planned %d times, want once (the preview)", routes.calls)
	}
	if trip.Route.Polyline != previewed.Polyline || len(trip.Route.BusStops) != len(previewed.BusStops) {
		t.Fatalf("departed route %q / %d stops, previewed %q / %d stops", trip.Route.Polyline, len(trip.Route.BusStops), previewed.Polyline, len(previewed.BusStops))
	}
	for i := range previewed.BusStops {
		if trip.Route.BusStops[i].ID != previewed.BusStops[i].ID {
			t.Fatalf("bus stop %d differs: %+v vs %+v", i, trip.Route.BusStops[i], previewed.BusStops[i])
		}
	}
}

// DD-21: a simulated preview is used as well, and a later preview replaces an earlier one.
func TestDepartUsesTheLatestSimulatedPreview(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	routes := &shiftingRoutes{simulated: true}
	do := routerWith(t, tx, routes)

	do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, "25.0768", "121.5738"))
	pw := do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, "25.0768", "121.5738"))
	latest := decode[struct {
		Route struct {
			Polyline string `json:"polyline"`
		} `json:"route"`
	}](t, pw).Route.Polyline

	dw := do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark, ""))
	wantStatus(t, dw, http.StatusCreated, "")
	trip := decode[tripResp](t, dw)
	if routes.calls != 2 || trip.Route.Polyline != latest || !trip.Route.Simulated {
		t.Fatalf("calls=%d polyline=%q simulated=%v, want 2 calls, the latest preview %q, simulated", routes.calls, trip.Route.Polyline, trip.Route.Simulated, latest)
	}
}

// DD-21: no preview for this pickup point and destination, or a different one, means planning
// at departure.
func TestDepartPlansWhenNothingWasPreviewed(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	routes := &shiftingRoutes{}
	do := routerWith(t, tx, routes)

	wantStatus(t, do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, "25.07585", "121.5745")), http.StatusOK, "")
	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark, "")), http.StatusCreated, "")
	if routes.calls != 2 {
		t.Fatalf("route planned %d times, want 2 (preview of another destination, then the departure)", routes.calls)
	}
}

func TestPreviewRejections(t *testing.T) {
	tx := testTx(t)
	_, driver := newUser(t, tx, roleDriver)
	_, passenger := newUser(t, tx, rolePassenger)
	pickupID := firstPickupID(t, tx)
	do := routerWith(t, tx, straightRoute{})
	const path = "/api/driver/route-preview"

	wantStatus(t, do(http.MethodPost, path, driver, previewJSON(pickupID+9999, "25.0768", "121.5738")), http.StatusBadRequest, "invalid_pickup_point")
	wantStatus(t, do(http.MethodPost, path, driver, previewJSON(pickupID, "25.0478", "121.5170")), http.StatusBadRequest, "destination_outside_park")
	wantStatus(t, do(http.MethodPost, path, driver, `{"pickup_point_id":1}`), http.StatusBadRequest, "invalid_request")
	wantStatus(t, do(http.MethodPost, path, driver, previewJSON(pickupID, "95", "121.5738")), http.StatusBadRequest, "invalid_request")
	wantStatus(t, do(http.MethodPost, path, passenger, previewJSON(pickupID, "25.0768", "121.5738")), http.StatusForbidden, "")
	wantStatus(t, do(http.MethodPost, path, "", previewJSON(pickupID, "25.0768", "121.5738")), http.StatusUnauthorized, "")
}
