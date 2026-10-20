package server

import (
	"context"
	"math"
	"sync"
	"testing"
	"time"
)

// moveM moves p by northM metres north and eastM metres east.
func moveM(p latLng, northM, eastM float64) latLng {
	perDeg := earthRadiusM * math.Pi / 180
	return latLng{p.Lat + northM/perDeg, p.Lng + eastM/(perDeg*math.Cos(p.Lat*math.Pi/180))}
}

func TestCacheHitDoesNotCallTheSource(t *testing.T) {
	src := &fakeSource{durationS: 300}
	c := newTravelCache(src, testTravelConfig(newFakeClock()))
	ctx := context.Background()

	first := estimateAll(t, ctx, c)
	src.durationS = 999 // a later call to the source would show up as a different answer
	second := estimateAll(t, ctx, c)
	if first != realAll(300) || second != first {
		t.Errorf("estimates = %v then %v, want the cached %v", first, second, realAll(300))
	}
	if src.callCount() != 3 {
		t.Errorf("calls = %d, want 3 (one per kind)", src.callCount())
	}
}

func TestCacheKeepsKindsAndPlacesApart(t *testing.T) {
	src := &fakeSource{durationS: 300}
	c := newTravelCache(src, testTravelConfig(newFakeClock()))
	ctx := context.Background()

	c.DriveTime(ctx, songshan, neihu)
	c.Walk(ctx, songshan, neihu)
	c.Route(ctx, songshan, neihu)
	c.DriveTime(ctx, neihu, songshan)
	c.DriveTime(ctx, songshan, moveM(neihu, 10, 0)) // only the origin snaps to the grid
	if src.callCount() != 5 {
		t.Errorf("calls = %d, want 5: each kind and each pair of places is its own entry", src.callCount())
	}
}

func TestCacheExpiresAfterTTL(t *testing.T) {
	cfg := defaultTravelConfig()
	for _, tc := range []struct {
		kind string
		ttl  time.Duration
		ask  func(c *travelCache)
	}{
		{"route", cfg.RouteTTL, func(c *travelCache) { c.Route(context.Background(), songshan, neihu) }},
		{"drive", cfg.DriveTTL, func(c *travelCache) { c.DriveTime(context.Background(), songshan, neihu) }},
		{"walk", cfg.WalkTTL, func(c *travelCache) { c.Walk(context.Background(), songshan, neihu) }},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			clock := newFakeClock()
			src := &fakeSource{durationS: 300}
			c := newTravelCache(src, testTravelConfig(clock))
			tc.ask(c)
			clock.Advance(tc.ttl - time.Second)
			tc.ask(c)
			if src.callCount() != 1 {
				t.Fatalf("just before the TTL: calls = %d, want 1 (a hit)", src.callCount())
			}
			clock.Advance(time.Second)
			tc.ask(c)
			if src.callCount() != 2 {
				t.Errorf("at the TTL: calls = %d, want 2 (expired)", src.callCount())
			}
		})
	}
	if !(cfg.DriveTTL < cfg.WalkTTL) {
		t.Errorf("driving TTL %v should be shorter than walking TTL %v: driving follows the traffic", cfg.DriveTTL, cfg.WalkTTL)
	}
}

func TestCacheSnapsCarPositionsToTheGrid(t *testing.T) {
	cfg := testTravelConfig(newFakeClock())
	centre := snapToGrid(latLng{25.0765, 121.5750}, cfg.GridM)
	half := cfg.GridM / 2
	for _, tc := range []struct {
		name          string
		northM, eastM float64
		hit           bool
	}{
		{"same cell, north", half - 5, 0, true},
		{"next cell, north", half + 5, 0, false},
		{"same cell, west", 0, -(half - 5), true},
		{"next cell, west", 0, -(half + 5), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := &fakeSource{durationS: 300}
			c := newTravelCache(src, cfg)
			c.DriveTime(context.Background(), centre, songshan)
			c.DriveTime(context.Background(), moveM(centre, tc.northM, tc.eastM), songshan)
			if hit := src.callCount() == 1; hit != tc.hit {
				t.Errorf("car moved %.0f m north, %.0f m east: hit = %v, want %v", tc.northM, tc.eastM, hit, tc.hit)
			}
		})
	}
}

func TestCacheDoesNotKeepSimulatedResults(t *testing.T) {
	src := &fakeSource{durationS: 300, err: errDown}
	cfg := testTravelConfig(newFakeClock())
	cfg.BreakerThreshold = 10 // keep the breaker out of this test
	travel := newTravel(src, cfg)
	ctx := context.Background()

	if got := estimateAll(t, ctx, travel); got != simulatedAll(t) {
		t.Fatalf("source down: estimates = %v, want simulated", got)
	}
	// The source recovers: the very next estimates are real, not the simulated ones.
	src.set(nil, 0)
	if got := estimateAll(t, ctx, travel); got != realAll(300) {
		t.Errorf("source recovered: estimates = %v, want the source's", got)
	}
	if src.callCount() != 6 {
		t.Errorf("calls = %d, want 6: simulated results were not cached", src.callCount())
	}
}

func TestCachedRouteIsACopy(t *testing.T) {
	src := &fakeSource{durationS: 300}
	c := newTravelCache(src, testTravelConfig(newFakeClock()))
	ctx := context.Background()

	first, _ := c.Route(ctx, songshan, neihu)
	want := first.Points[0]
	first.Points[0] = latLng{0, 0}
	second, _ := c.Route(ctx, songshan, neihu)
	second.Points[0] = latLng{1, 1}
	third, _ := c.Route(ctx, songshan, neihu)
	if third.Points[0] != want {
		t.Errorf("cached route starts at %v after callers changed theirs, want %v", third.Points[0], want)
	}
}

func TestCacheIsSafeForConcurrentUse(t *testing.T) {
	src := &fakeSource{durationS: 300}
	c := newTravelCache(src, testTravelConfig(newFakeClock()))
	var wg sync.WaitGroup
	for g := range 16 {
		wg.Go(func() {
			for i := range 50 {
				car := moveM(songshan, float64((g*50+i)%7)*60, 0)
				if r, err := c.Route(context.Background(), songshan, neihu); err != nil || len(r.Points) == 0 {
					t.Errorf("route = %v, %v", r, err)
				}
				c.DriveTime(context.Background(), car, neihu)
				c.Walk(context.Background(), neihu, car)
			}
		})
	}
	wg.Wait()
}
