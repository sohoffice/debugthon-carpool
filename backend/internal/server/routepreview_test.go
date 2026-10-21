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

// routerWith builds a router on db with the given route provider.
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

type previewResp struct {
	PreviewID int64 `json:"preview_id"`
	Route     struct {
		Polyline string    `json:"polyline"`
		BusStops []busStop `json:"bus_stops"`
	} `json:"route"`
}

func preview(t *testing.T, do func(method, path, token, body string) *httptest.ResponseRecorder, token string, pickupID int64, lat, lng string) previewResp {
	t.Helper()
	w := do(http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, lat, lng))
	wantStatus(t, w, http.StatusOK, "")
	p := decode[previewResp](t, w)
	if p.PreviewID == 0 {
		t.Fatalf("preview has no preview_id: %s", w.Body.String())
	}
	return p
}

func withPreview(id int64) string { return `"preview_id":` + itoa(id) }

func previewUsed(t *testing.T, db DB, id int64) bool {
	t.Helper()
	var used bool
	if err := db.QueryRow(context.Background(), `SELECT used_at IS NOT NULL FROM route_previews WHERE id = $1`, id).Scan(&used); err != nil {
		t.Fatal(err)
	}
	return used
}

// DD-21: departing with a preview id copies the previewed route and bus stops without planning
// again (the counting provider would give another route), whatever the destination name.
func TestDepartWithPreviewCopiesRouteWithoutPlanning(t *testing.T) {
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

	previewed := preview(t, do, token, pickupID, "25.0768", "121.5738")
	if len(previewed.Route.BusStops) == 0 {
		t.Fatal("previewed route has no bus stops, so the comparison below would prove nothing")
	}
	dw := do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, `{"name":"another name","lat":25.0768,"lng":121.5738}`, withPreview(previewed.PreviewID)))
	wantStatus(t, dw, http.StatusCreated, "")
	trip := decode[tripResp](t, dw)
	if routes.calls != 1 {
		t.Fatalf("route planned %d times, want once (the preview)", routes.calls)
	}
	if trip.Route.Polyline != previewed.Route.Polyline || len(trip.Route.BusStops) != len(previewed.Route.BusStops) {
		t.Fatalf("departed route %q / %d stops, previewed %q / %d stops", trip.Route.Polyline, len(trip.Route.BusStops), previewed.Route.Polyline, len(previewed.Route.BusStops))
	}
	for i := range previewed.Route.BusStops {
		if trip.Route.BusStops[i].ID != previewed.Route.BusStops[i].ID {
			t.Fatalf("bus stop %d differs: %+v vs %+v", i, trip.Route.BusStops[i], previewed.Route.BusStops[i])
		}
	}
	if !previewUsed(t, tx, previewed.PreviewID) {
		t.Fatal("preview not marked used")
	}
}

// DD-21: the departure takes the route stored in the database, so rewriting it with SQL shows
// in the trip; that is only possible if the departure copied the stored preview.
func TestDepartWithPreviewTakesTheStoredRoute(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	routes := &shiftingRoutes{simulated: true}
	do := routerWith(t, tx, routes)

	p := preview(t, do, token, pickupID, "25.0768", "121.5738")
	mustExec(t, tx, `UPDATE route_previews SET route_polyline = 'rewritten', route_distance_m = 4242, route_duration_s = 99, route_simulated = false WHERE id = $1`, p.PreviewID)
	mustExec(t, tx, `DELETE FROM route_preview_stops WHERE preview_id = $1`, p.PreviewID)
	mustExec(t, tx, `INSERT INTO route_preview_stops (preview_id, seq, bus_stop_id) SELECT $1, 1, min(id) FROM bus_stops`, p.PreviewID)

	dw := do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark2, withPreview(p.PreviewID)))
	wantStatus(t, dw, http.StatusCreated, "")
	trip := decode[tripResp](t, dw)
	if trip.Route.Polyline != "rewritten" || trip.Route.DistanceM != 4242 || trip.Route.DurationS != 99 || trip.Route.Simulated || len(trip.Route.BusStops) != 1 {
		t.Fatalf("trip route = %+v, want the rewritten preview", trip.Route)
	}
	if routes.calls != 1 {
		t.Fatalf("route planned %d times, want once", routes.calls)
	}
}

// inPark2 is the destination the previews in these tests use.
const inPark2 = `{"name":"x","lat":25.0768,"lng":121.5738}`

// DD-21: a preview serves one departure.
func TestPreviewCanBeUsedOnce(t *testing.T) {
	tx := testTx(t)
	driverID, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	do := routerWith(t, tx, straightRoute{})
	p := preview(t, do, token, pickupID, "25.0768", "121.5738")
	body := departJSON(pickupID, inPark2, withPreview(p.PreviewID))

	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, body), http.StatusCreated, "")
	mustExec(t, tx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE driver_id = $1`, driverID)
	before := countTrips(t, tx, driverID)
	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, body), http.StatusBadRequest, "invalid_route_preview")
	if countTrips(t, tx, driverID) != before {
		t.Fatal("a trip was created from a used preview")
	}
}

// DD-21: a failed departure leaves the preview unused.
func TestFailedDepartureLeavesThePreviewUnused(t *testing.T) {
	tx := testTx(t)
	driverID, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	do := routerWith(t, tx, straightRoute{})
	p := preview(t, do, token, pickupID, "25.0768", "121.5738")
	body := departJSON(pickupID, inPark2, withPreview(p.PreviewID))

	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark2, "")), http.StatusCreated, "")
	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, body), http.StatusConflict, "already_active")
	if previewUsed(t, tx, p.PreviewID) {
		t.Fatal("preview used by a failed departure")
	}
	mustExec(t, tx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE driver_id = $1`, driverID)
	wantStatus(t, do(http.MethodPost, "/api/driver/trips", token, body), http.StatusCreated, "")
}

// DD-21: an unknown, foreign, differing preview is refused, without planning again or creating a trip.
func TestDepartRefusesAnInvalidPreview(t *testing.T) {
	tx := testTx(t)
	driverID, token := newUser(t, tx, roleDriver)
	_, other := newUser(t, tx, roleDriver)
	var pickups []int64
	rows, err := tx.Query(context.Background(), `SELECT id FROM pickup_points ORDER BY id LIMIT 2`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		pickups = append(pickups, id)
	}
	rows.Close()
	if len(pickups) < 2 {
		t.Fatal("need two pickup points")
	}
	routes := &shiftingRoutes{}
	do := routerWith(t, tx, routes)
	p := preview(t, do, token, pickups[0], "25.0768", "121.5738")

	cases := []struct {
		name   string
		token  string
		pickup int64
		dest   string
		id     int64
	}{
		{"unknown id", token, pickups[0], inPark2, p.PreviewID + 100000},
		{"another driver's", other, pickups[0], inPark2, p.PreviewID},
		{"other pickup point", token, pickups[1], inPark2, p.PreviewID},
		{"other destination latitude", token, pickups[0], `{"name":"x","lat":25.0769,"lng":121.5738}`, p.PreviewID},
		{"other destination longitude", token, pickups[0], `{"name":"x","lat":25.0768,"lng":121.5739}`, p.PreviewID},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := countTrips(t, tx, driverID)
			w := do(http.MethodPost, "/api/driver/trips", tc.token, departJSON(tc.pickup, tc.dest, withPreview(tc.id)))
			wantStatus(t, w, http.StatusBadRequest, "invalid_route_preview")
			if countTrips(t, tx, driverID) != before {
				t.Fatal("a trip was created")
			}
			if previewUsed(t, tx, p.PreviewID) {
				t.Fatal("preview marked used")
			}
		})
	}
	if routes.calls != 1 {
		t.Fatalf("route planned %d times, want once (the preview): a refusal must not plan again", routes.calls)
	}
}

// DD-21: departing without a preview id plans at departure and ignores saved previews.
func TestDepartWithoutPreviewIDPlans(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	routes := &shiftingRoutes{}
	do := routerWith(t, tx, routes)

	p := preview(t, do, token, pickupID, "25.0768", "121.5738")
	dw := do(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark2, ""))
	wantStatus(t, dw, http.StatusCreated, "")
	if routes.calls != 2 || decode[tripResp](t, dw).Route.Polyline == p.Route.Polyline {
		t.Fatalf("calls=%d, want 2 and a route planned at departure", routes.calls)
	}
	if previewUsed(t, tx, p.PreviewID) {
		t.Fatal("preview used by a departure without its id")
	}
}

// DD-21: previews live in the database, so a router built later (as after a restart) still
// finds them.
func TestPreviewSurvivesANewRouter(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	p := preview(t, routerWith(t, tx, straightRoute{}), token, pickupID, "25.0768", "121.5738")

	routes := &shiftingRoutes{}
	dw := routerWith(t, tx, routes)(http.MethodPost, "/api/driver/trips", token, departJSON(pickupID, inPark2, withPreview(p.PreviewID)))
	wantStatus(t, dw, http.StatusCreated, "")
	if routes.calls != 0 || decode[tripResp](t, dw).Route.Polyline != p.Route.Polyline {
		t.Fatalf("calls=%d, want the previewed route without planning", routes.calls)
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
