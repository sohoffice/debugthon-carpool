package server

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeSource is an external source whose answers and failures a test controls. Real results
// take durationS and are not simulated.
type fakeSource struct {
	mu        sync.Mutex
	calls     int
	err       error
	delay     time.Duration // answer after this long, unless the call's context ends first
	durationS int
}

func (f *fakeSource) set(err error, delay time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err, f.delay = err, delay
}

func (f *fakeSource) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeSource) answer(ctx context.Context) (int, error) {
	f.mu.Lock()
	f.calls++
	err, delay, d := f.err, f.delay, f.durationS
	f.mu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	return d, err
}

func (f *fakeSource) Route(ctx context.Context, from, to latLng) (Route, error) {
	d, err := f.answer(ctx)
	points := []latLng{from, {(from.Lat + to.Lat) / 2, from.Lng}, to}
	return Route{Points: points, Polyline: encodePolyline(points), DistanceM: 1000, DurationS: d}, err
}

func (f *fakeSource) DriveTime(ctx context.Context, _, _ latLng) (Travel, error) {
	d, err := f.answer(ctx)
	return Travel{DurationS: d}, err
}

func (f *fakeSource) Walk(ctx context.Context, _, _ latLng) (Walk, error) {
	d, err := f.answer(ctx)
	return Walk{DurationS: d}, err
}

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{t: time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// testTravelConfig is the design configuration with a short timeout and a fake clock.
func testTravelConfig(clock *fakeClock) travelConfig {
	cfg := defaultTravelConfig()
	cfg.Timeout = 200 * time.Millisecond
	cfg.Now = clock.Now
	return cfg
}

var (
	songshan = latLng{25.05003, 121.578206}
	neihu    = latLng{25.0768, 121.5738}
	errDown  = errors.New("source down")
)

// estimateAll asks for all three estimates and returns them as (duration, simulated) pairs.
func estimateAll(t *testing.T, ctx context.Context, src TravelSource) [3]Travel {
	t.Helper()
	r, err := src.Route(ctx, songshan, neihu)
	if err != nil {
		t.Fatalf("route: %v", err)
	}
	d, err := src.DriveTime(ctx, songshan, neihu)
	if err != nil {
		t.Fatalf("drive time: %v", err)
	}
	w, err := src.Walk(ctx, songshan, neihu)
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	return [3]Travel{{r.DurationS, r.Simulated}, d, {w.DurationS, w.Simulated}}
}

// simulatedAll is what the simulated fallback answers for songshan → neihu.
func simulatedAll(t *testing.T) [3]Travel {
	t.Helper()
	return estimateAll(t, context.Background(), simulated{})
}

func realAll(durationS int) [3]Travel {
	return [3]Travel{{durationS, false}, {durationS, false}, {durationS, false}}
}

func TestFallbackUsesTheSourceWhenItAnswers(t *testing.T) {
	src := &fakeSource{durationS: 300}
	got := estimateAll(t, context.Background(), newFallback(src, testTravelConfig(newFakeClock())))
	if got != realAll(300) {
		t.Errorf("estimates = %v, want the source's, not simulated", got)
	}
}

func TestFallbackMarksTheEstimateSimulatedWhenTheSourceFails(t *testing.T) {
	src := &fakeSource{durationS: 300, err: errDown}
	got := estimateAll(t, context.Background(), newFallback(src, testTravelConfig(newFakeClock())))
	if want := simulatedAll(t); got != want {
		t.Errorf("estimates = %v, want the simulated ones %v (DD-09, REQ-063)", got, want)
	}
	for _, e := range got {
		if !e.Simulated {
			t.Error("an estimate made without the source must be marked simulated (REQ-063)")
		}
	}
}

func TestFallbackGivesUpOnASlowSource(t *testing.T) {
	cfg := testTravelConfig(newFakeClock())

	// Answers within the timeout: the real result.
	src := &fakeSource{durationS: 300, delay: cfg.Timeout / 4}
	if got := estimateAll(t, context.Background(), newFallback(src, cfg)); got != realAll(300) {
		t.Errorf("answered within the timeout: estimates = %v, want the source's", got)
	}

	// Answers only after the timeout: the simulated estimate, without waiting for the source.
	src = &fakeSource{durationS: 300, delay: 5 * cfg.Timeout}
	f := newFallback(src, cfg)
	start := time.Now()
	r, err := f.DriveTime(context.Background(), songshan, neihu)
	if err != nil || !r.Simulated {
		t.Fatalf("too slow: drive time = %v, %v; want a simulated estimate", r, err)
	}
	if waited := time.Since(start); waited >= 5*cfg.Timeout {
		t.Errorf("waited %v for a source that is too slow, want about the %v timeout", waited, cfg.Timeout)
	}
}

func TestBreakerSkipsTheSourceAfterRepeatedFailures(t *testing.T) {
	clock := newFakeClock()
	cfg := testTravelConfig(clock)
	src := &fakeSource{durationS: 300, err: errDown}
	f := newFallback(src, cfg)
	ctx := context.Background()

	// The breaker counts failures of every kind: the source is one service.
	f.Route(ctx, songshan, neihu)
	f.Walk(ctx, songshan, neihu)
	f.DriveTime(ctx, songshan, neihu)
	if src.callCount() != cfg.BreakerThreshold {
		t.Fatalf("calls = %d, want %d", src.callCount(), cfg.BreakerThreshold)
	}

	// Open: the source is not called, the answer is simulated.
	if r, _ := f.DriveTime(ctx, songshan, neihu); !r.Simulated {
		t.Error("open breaker: want a simulated estimate")
	}
	clock.Advance(cfg.BreakerCooldown - time.Second)
	f.DriveTime(ctx, songshan, neihu)
	if src.callCount() != cfg.BreakerThreshold {
		t.Fatalf("calls during the cooldown = %d, want still %d", src.callCount(), cfg.BreakerThreshold)
	}

	// After the cooldown it tries again; a failure opens it straight away.
	clock.Advance(time.Second)
	f.DriveTime(ctx, songshan, neihu)
	f.DriveTime(ctx, songshan, neihu)
	if want := cfg.BreakerThreshold + 1; src.callCount() != want {
		t.Fatalf("calls after the cooldown = %d, want one retry (%d)", src.callCount(), want)
	}

	// The next retry succeeds: back to real results, and the source is asked every time.
	clock.Advance(cfg.BreakerCooldown)
	src.set(nil, 0)
	if got := estimateAll(t, ctx, f); got != realAll(300) {
		t.Errorf("recovered: estimates = %v, want the source's", got)
	}
	f.DriveTime(ctx, songshan, neihu)
	if want := cfg.BreakerThreshold + 1 + 4; src.callCount() != want {
		t.Errorf("calls after recovering = %d, want %d", src.callCount(), want)
	}
}

func TestBreakerStaysClosedBelowTheThreshold(t *testing.T) {
	cfg := testTravelConfig(newFakeClock())
	src := &fakeSource{durationS: 300}
	f := newFallback(src, cfg)
	ctx := context.Background()

	fail := func(n int) {
		src.set(errDown, 0)
		for range n {
			f.DriveTime(ctx, songshan, neihu)
		}
		src.set(nil, 0)
	}
	// One failure short of the threshold, twice over with a success between: the failures are
	// not consecutive, so the source is still asked and its answer used.
	fail(cfg.BreakerThreshold - 1)
	if r, _ := f.DriveTime(ctx, songshan, neihu); r.Simulated {
		t.Fatal("below the threshold: want the source's answer")
	}
	fail(cfg.BreakerThreshold - 1)
	if r, _ := f.DriveTime(ctx, songshan, neihu); r.Simulated {
		t.Fatal("failures with a success between them: want the source's answer")
	}
	if want := 2 * cfg.BreakerThreshold; src.callCount() != want {
		t.Errorf("calls = %d, want every call to reach the source (%d)", src.callCount(), want)
	}
}

func TestFallbackSkipsTheSourceWhenTheBudgetIsSpent(t *testing.T) {
	cfg := testTravelConfig(newFakeClock())
	src := &fakeSource{durationS: 300}
	f := newFallback(src, cfg)

	// The budget is already spent: simulated, without calling the source.
	spent, cancel := context.WithCancel(context.Background())
	cancel()
	for range cfg.BreakerThreshold + 1 {
		if got := estimateAll(t, spent, f); got != simulatedAll(t) {
			t.Fatalf("spent budget: estimates = %v, want simulated", got)
		}
	}
	if src.callCount() != 0 {
		t.Fatalf("spent budget: calls = %d, want none", src.callCount())
	}

	// The budget runs out while the source is still answering: simulated, and not held
	// against the source.
	src.set(nil, cfg.Timeout/2)
	for range cfg.BreakerThreshold + 1 {
		budget, cancel := context.WithTimeout(context.Background(), cfg.Timeout/8)
		r, err := f.DriveTime(budget, songshan, neihu)
		cancel()
		if err != nil || !r.Simulated {
			t.Fatalf("budget ran out mid-call: drive time = %v, %v; want simulated", r, err)
		}
	}

	// None of it opened the breaker: with time to spare, the source answers.
	src.set(nil, 0)
	if r, _ := f.DriveTime(context.Background(), songshan, neihu); r.Simulated {
		t.Error("a spent budget must not count as a source failure")
	}
}
