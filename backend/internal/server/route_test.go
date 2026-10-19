package server

import (
	"context"
	"testing"
)

func TestEncodePolyline(t *testing.T) {
	// The worked example from Google's Encoded Polyline Algorithm Format documentation.
	got := encodePolyline([]latLng{{38.5, -120.2}, {40.7, -120.95}, {43.252, -126.453}})
	if want := "_p~iF~ps|U_ulLnnqC_mqNvxq`@"; got != want {
		t.Fatalf("encodePolyline = %q, want %q", got, want)
	}
}

func TestStraightRoute(t *testing.T) {
	from, to := latLng{25.0500, 121.5780}, latLng{25.0768, 121.5738}
	r, err := straightRoute{}.Route(context.Background(), from, to)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Simulated {
		t.Error("a straight-line route must be marked simulated (DD-09)")
	}
	if len(r.Points) != 2 || r.Points[0] != from || r.Points[1] != to {
		t.Errorf("points = %v, want just the two ends", r.Points)
	}
	line := distanceM(from, to)
	if want := int(line * 1.3); r.DistanceM < want-1 || r.DistanceM > want+1 {
		t.Errorf("distance = %d m, want about %d (straight line x 1.3)", r.DistanceM, want)
	}
	// 20 km/h.
	if want := int(float64(r.DistanceM) / (20000.0 / 3600)); r.DurationS < want-1 || r.DurationS > want+1 {
		t.Errorf("duration = %d s, want about %d", r.DurationS, want)
	}
	if r.Polyline != encodePolyline(r.Points) {
		t.Error("polyline does not encode the points")
	}
}

func TestStopsAlong(t *testing.T) {
	// A route running due north from (25.00, 121.50) for about 2 km.
	route := []latLng{{25.00, 121.50}, {25.02, 121.50}}
	stops := []stopPos{
		{ID: 1, Pos: latLng{25.015, 121.5002}}, // ~20 m east of the line, late on the route
		{ID: 2, Pos: latLng{25.005, 121.4998}}, // ~20 m west, early on the route
		{ID: 3, Pos: latLng{25.010, 121.5100}}, // ~1 km away: not along the route
		{ID: 4, Pos: latLng{24.990, 121.5000}}, // behind the start of the route
	}
	got := stopsAlong(route, stops, 50)
	want := []int64{2, 1}
	if len(got) != len(want) {
		t.Fatalf("stops along = %v, want ids %v in travel order", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("stops along = %v, want ids %v in travel order", got, want)
		}
	}
}
