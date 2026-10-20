package server

import (
	"net/http"
	"testing"
)

// REQ-001, DD-32: the park check answers true inside and false outside (not an error), and uses
// the same boundary as the departure; bad coordinates are refused; both roles may ask.
func TestParkCheck(t *testing.T) {
	tx := testTx(t)
	_, driver := newUser(t, tx, roleDriver)
	_, passenger := newUser(t, tx, rolePassenger)

	for _, c := range []struct {
		name, query string
		token       string
		inside      bool
	}{
		{"in the park, driver", "lat=25.0768&lng=121.5738", driver, true},
		{"in the park, passenger", "lat=25.0768&lng=121.5738", passenger, true},
		{"outside the park", "lat=25.0478&lng=121.5170", passenger, false},
		{"on the other side of the boundary", "lat=25.0768&lng=121.6738", driver, false},
	} {
		w := call(t, tx, http.MethodGet, "/api/park/check?"+c.query, c.token, "")
		wantStatus(t, w, http.StatusOK, "")
		if got := decode[struct {
			Inside bool `json:"inside"`
		}](t, w).Inside; got != c.inside {
			t.Errorf("%s: inside = %v, want %v", c.name, got, c.inside)
		}
	}

	for _, q := range []string{"", "lat=25.07", "lng=121.5", "lat=x&lng=121.5", "lat=91&lng=121.5", "lat=25&lng=181"} {
		wantStatus(t, call(t, tx, http.MethodGet, "/api/park/check?"+q, driver, ""), http.StatusBadRequest, "invalid_location")
	}
	wantStatus(t, call(t, tx, http.MethodGet, "/api/park/check?lat=25.0768&lng=121.5738", "", ""), http.StatusUnauthorized, "")
}

// The answer agrees with the departure's check for the same point.
func TestParkCheckAgreesWithDeparture(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	pickupID := firstPickupID(t, tx)
	for _, p := range []struct {
		lat, lng string
		inside   bool
	}{{"25.0768", "121.5738", true}, {"25.0478", "121.5170", false}} {
		check := call(t, tx, http.MethodGet, "/api/park/check?lat="+p.lat+"&lng="+p.lng, token, "")
		got := decode[struct {
			Inside bool `json:"inside"`
		}](t, check).Inside
		w := call(t, tx, http.MethodPost, "/api/driver/route-preview", token, previewJSON(pickupID, p.lat, p.lng))
		if refused := w.Code == http.StatusBadRequest; got == refused || got != p.inside {
			t.Errorf("(%s, %s): check says %v, preview status %d", p.lat, p.lng, got, w.Code)
		}
	}
}
