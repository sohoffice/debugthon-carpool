package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// exampleResponse reads the body of a Google Routes example response. The examples have the
// real shape with made-up values (docs/data/examples/google_maps/README.md).
func exampleResponse(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/data/examples/google_maps/" + name + ".response.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct{ Body map[string]any }
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Body
}

// fakeGoogle serves handler as Google Routes and returns an adapter that talks to it.
func fakeGoogle(t *testing.T, handler http.HandlerFunc) (*googleRoutes, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &googleRoutes{baseURL: srv.URL, apiKey: "test-key", client: srv.Client()}, srv
}

// hang never answers. It reads the request body first: only then does the server notice when
// the client gives up.
func hang(_ http.ResponseWriter, r *http.Request) {
	io.Copy(io.Discard, r.Body)
	select {
	case <-r.Context().Done():
	case <-time.After(5 * time.Second):
	}
}

func replyJSON(body any) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(body)
	}
}

// examplePoints and their polyline stand in for the example's made-up polyline.
var examplePoints = []latLng{{25.05003, 121.57821}, {25.0601, 121.5801}, {25.0768, 121.5738}}

func exampleRoute(t *testing.T) map[string]any {
	body := exampleResponse(t, "compute_route")
	body["routes"].([]any)[0].(map[string]any)["polyline"] = map[string]any{"encodedPolyline": encodePolyline(examplePoints)}
	return body
}

func TestGoogleRequestShape(t *testing.T) {
	for _, tc := range []struct {
		kind, mode, preference, fieldMask string
		ask                               func(g *googleRoutes) error
	}{
		{"route", "DRIVE", "TRAFFIC_AWARE", "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
			func(g *googleRoutes) error { _, err := g.Route(context.Background(), songshan, neihu); return err }},
		{"drive time", "DRIVE", "TRAFFIC_AWARE", "routes.duration,routes.distanceMeters",
			func(g *googleRoutes) error { _, err := g.DriveTime(context.Background(), songshan, neihu); return err }},
		{"walk", "WALK", "", "routes.duration,routes.distanceMeters",
			func(g *googleRoutes) error { _, err := g.Walk(context.Background(), songshan, neihu); return err }},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			var got *http.Request
			var body struct {
				Origin, Destination googleWaypoint
				TravelMode          string
				RoutingPreference   string
			}
			reply := replyJSON(exampleRoute(t))
			g, _ := fakeGoogle(t, func(w http.ResponseWriter, r *http.Request) {
				got = r
				raw, _ := io.ReadAll(r.Body)
				json.Unmarshal(raw, &body)
				reply(w, r)
			})
			if err := tc.ask(g); err != nil {
				t.Fatal(err)
			}
			if got.Method != http.MethodPost || got.URL.Path != "/directions/v2:computeRoutes" {
				t.Errorf("request = %s %s, want POST /directions/v2:computeRoutes", got.Method, got.URL.Path)
			}
			for header, want := range map[string]string{
				"X-Goog-Api-Key":   "test-key",
				"X-Goog-Fieldmask": tc.fieldMask,
				"Content-Type":     "application/json",
			} {
				if v := got.Header.Get(header); v != want {
					t.Errorf("%s = %q, want %q", header, v, want)
				}
			}
			if got.URL.Query().Get("key") != "" {
				t.Error("the key belongs in the header, not the URL")
			}
			o, d := body.Origin.Location.LatLng, body.Destination.Location.LatLng
			if (latLng{o.Latitude, o.Longitude}) != songshan || (latLng{d.Latitude, d.Longitude}) != neihu {
				t.Errorf("origin, destination = %v, %v; want %v, %v", o, d, songshan, neihu)
			}
			if body.TravelMode != tc.mode || body.RoutingPreference != tc.preference {
				t.Errorf("travelMode, routingPreference = %q, %q; want %q, %q", body.TravelMode, body.RoutingPreference, tc.mode, tc.preference)
			}
		})
	}
}

func TestGoogleParsesTheResponse(t *testing.T) {
	ctx := context.Background()

	g, _ := fakeGoogle(t, replyJSON(exampleRoute(t)))
	r, err := g.Route(ctx, songshan, neihu)
	if err != nil {
		t.Fatal(err)
	}
	if r.DurationS != 1020 || r.DistanceM != 5000 || r.Simulated {
		t.Errorf("route = %d s, %d m, simulated %v; want 1020 s, 5000 m, real", r.DurationS, r.DistanceM, r.Simulated)
	}
	if r.Polyline != encodePolyline(examplePoints) || len(r.Points) != len(examplePoints) {
		t.Fatalf("route polyline %q with %d points, want the response's %d", r.Polyline, len(r.Points), len(examplePoints))
	}
	for i, p := range examplePoints {
		if distanceM(r.Points[i], p) > 1 {
			t.Errorf("point %d = %v, want %v", i, r.Points[i], p)
		}
	}

	g, _ = fakeGoogle(t, replyJSON(exampleResponse(t, "scenario_drive_pickup")))
	if d, err := g.DriveTime(ctx, songshan, neihu); err != nil || d != (Travel{DurationS: 1130}) {
		t.Errorf("drive time = %v, %v; want 1130 s, real", d, err)
	}

	g, _ = fakeGoogle(t, replyJSON(exampleResponse(t, "scenario_walk")))
	if w, err := g.Walk(ctx, songshan, neihu); err != nil || w != (Walk{DurationS: 780}) {
		t.Errorf("walk = %v, %v; want 780 s, real", w, err)
	}

	// Durations may carry fractions of a second.
	g, _ = fakeGoogle(t, replyJSON(map[string]any{"routes": []any{map[string]any{"duration": "299.6s"}}}))
	if d, _ := g.DriveTime(ctx, songshan, neihu); d.DurationS != 300 {
		t.Errorf("duration \"299.6s\" = %d s, want 300", d.DurationS)
	}
}

func TestGoogleErrors(t *testing.T) {
	status := func(code int, body string) http.HandlerFunc {
		return func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(code)
			io.WriteString(w, body)
		}
	}
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		want    string
	}{
		{"server error", status(500, `{}`), "500"},
		{"key refused", status(403, `{"error":{"code":403,"message":"API key not valid.","status":"PERMISSION_DENIED"}}`), "API key not valid."},
		{"not JSON", status(200, `<html>`), "google routes"},
		{"no route", replyJSON(map[string]any{}), "no route"},
		{"empty routes", replyJSON(map[string]any{"routes": []any{}}), "no route"},
		{"bad duration", replyJSON(map[string]any{"routes": []any{map[string]any{"duration": "soon"}}}), "bad duration"},
		{"slow", hang, "deadline"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g, _ := fakeGoogle(t, tc.handler)
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			defer cancel()
			_, err := g.DriveTime(ctx, songshan, neihu)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want one mentioning %q", err, tc.want)
			}
		})
	}

	// A route needs a usable polyline, or its stops cannot be found.
	for _, polyline := range []string{"", "FAKE_ENCODED_POLYLINE", encodePolyline(examplePoints[:1])} {
		body := exampleRoute(t)
		body["routes"].([]any)[0].(map[string]any)["polyline"] = map[string]any{"encodedPolyline": polyline}
		g, _ := fakeGoogle(t, replyJSON(body))
		if _, err := g.Route(context.Background(), songshan, neihu); err == nil {
			t.Errorf("polyline %q: want an error", polyline)
		}
	}
}

func TestUnpluggedGoogleFallsBackToSimulated(t *testing.T) {
	cfg := testTravelConfig(newFakeClock())
	for _, tc := range []struct {
		name    string
		handler http.HandlerFunc
		unplug  bool
	}{
		{"error", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }, false},
		{"timeout", hang, false},
		{"disconnected", replyJSON(exampleRoute(t)), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			g, srv := fakeGoogle(t, tc.handler)
			if tc.unplug {
				srv.Close()
			}
			if got := estimateAll(t, context.Background(), newTravel(g, cfg)); got != simulatedAll(t) {
				t.Errorf("estimates = %v, want the simulated %v", got, simulatedAll(t))
			}
		})
	}
}

func TestCachedGoogleCallsOnce(t *testing.T) {
	var calls atomic.Int32
	reply := replyJSON(exampleRoute(t))
	g, _ := fakeGoogle(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		reply(w, r)
	})
	travel := newTravel(g, testTravelConfig(newFakeClock()))
	first := estimateAll(t, context.Background(), travel)
	second := estimateAll(t, context.Background(), travel)
	if first != realAll(1020) || second != first {
		t.Errorf("estimates = %v then %v, want real 1020 s twice", first, second)
	}
	if calls.Load() != 3 {
		t.Errorf("Google calls = %d, want 3 (one per kind)", calls.Load())
	}
}
