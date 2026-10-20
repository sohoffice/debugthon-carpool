package server

import (
	"context"
	"log"
	"sync"
	"time"
)

// fallback calls the external source and turns to the simulated estimate when it fails, times
// out or cannot be reached, so callers always get a result marked as real or simulated (DD-09).
type fallback struct {
	source  TravelSource
	sim     TravelSource
	timeout time.Duration
	breaker *breaker
}

func newFallback(source TravelSource, cfg travelConfig) *fallback {
	return &fallback{
		source:  source,
		sim:     simulated{},
		timeout: cfg.Timeout,
		breaker: &breaker{threshold: cfg.BreakerThreshold, cooldown: cfg.BreakerCooldown, now: cfg.Now},
	}
}

func (f *fallback) Route(ctx context.Context, from, to latLng) (Route, error) {
	return guarded(f, ctx, "route", f.source.Route, f.sim.Route, from, to)
}

func (f *fallback) DriveTime(ctx context.Context, from, to latLng) (Travel, error) {
	return guarded(f, ctx, "drive time", f.source.DriveTime, f.sim.DriveTime, from, to)
}

func (f *fallback) Walk(ctx context.Context, from, to latLng) (Walk, error) {
	return guarded(f, ctx, "walk", f.source.Walk, f.sim.Walk, from, to)
}

type estimate[T any] func(ctx context.Context, from, to latLng) (T, error)

// guarded asks the source within the timeout, unless the caller's time budget is already spent
// or the breaker is open. Only the source's own failures count towards the breaker: a budget
// that runs out is the caller's doing, not a sign that the source is down.
func guarded[T any](f *fallback, ctx context.Context, kind string, real, sim estimate[T], from, to latLng) (T, error) {
	if ctx.Err() != nil || !f.breaker.allow() {
		return sim(ctx, from, to)
	}
	callCtx, cancel := context.WithTimeout(ctx, f.timeout)
	defer cancel()
	v, err := real(callCtx, from, to)
	if err == nil {
		f.breaker.record(true)
		return v, nil
	}
	if ctx.Err() == nil {
		f.breaker.record(false)
		log.Printf("travel: %s from the external source failed, using the simulated estimate: %v", kind, err)
	}
	return sim(ctx, from, to)
}

// breaker stops calling the external source for a cooldown after threshold consecutive
// failures, so a source that is down does not make every request wait for the timeout (DD-09).
// After the cooldown the next call tries again; a success closes it, a failure reopens it.
type breaker struct {
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	mu        sync.Mutex
	failures  int
	openUntil time.Time
}

func (b *breaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.now().Before(b.openUntil)
}

func (b *breaker) record(ok bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ok {
		b.failures = 0
		return
	}
	b.failures++
	if b.failures >= b.threshold {
		b.openUntil = b.now().Add(b.cooldown)
		log.Printf("travel: external source failed %d times in a row, using the simulated estimate for %s", b.failures, b.cooldown)
	}
}
