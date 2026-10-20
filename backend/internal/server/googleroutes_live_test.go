//go:build googlelive

package server

import (
	"context"
	"os"
	"testing"
	"time"
)

// TestGoogleLive calls the real Google Routes API once per kind, to check the adapter by hand
// during development. It never runs by default: it needs the googlelive build tag and a key, e.g.
//
//	MAP_API_KEY=... go test -tags googlelive -run TestGoogleLive -v ./internal/server/
func TestGoogleLive(t *testing.T) {
	key := os.Getenv("MAP_API_KEY")
	if key == "" {
		t.Skip("MAP_API_KEY is not set")
	}
	g := newGoogleRoutes(key)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	r, err := g.Route(ctx, songshan, neihu)
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	if r.DurationS <= 0 || r.DistanceM <= 0 || len(r.Points) < 2 {
		t.Errorf("route = %d s, %d m, %d points; want a real route", r.DurationS, r.DistanceM, len(r.Points))
	}
	if d0, d1 := distanceM(r.Points[0], songshan), distanceM(r.Points[len(r.Points)-1], neihu); d0 > 300 || d1 > 300 {
		t.Errorf("route runs from %.0f m off the origin to %.0f m off the destination", d0, d1)
	}
	t.Logf("route: %d s, %d m, %d points", r.DurationS, r.DistanceM, len(r.Points))

	d, err := g.DriveTime(ctx, songshan, neihu)
	if err != nil || d.DurationS <= 0 {
		t.Errorf("drive time = %v, %v", d, err)
	}
	t.Logf("drive time: %d s", d.DurationS)

	w, err := g.Walk(ctx, songshan, neihu)
	if err != nil || w.DurationS <= d.DurationS {
		t.Errorf("walk = %v, %v; want longer than the drive", w, err)
	}
	t.Logf("walk: %d s", w.DurationS)
}
