package server

import (
	"context"
	"math"
	"slices"
	"sync"
	"time"
)

// travelCache keeps real estimates in memory, keyed by kind, origin and destination (DD-09).
// Simulated estimates are never kept, so real data returns as soon as the source recovers.
type travelCache struct {
	next TravelSource
	cfg  travelConfig

	mu        sync.Mutex
	entries   map[cacheKey]cacheEntry
	nextSweep time.Time
}

type cacheKey struct {
	kind     string
	from, to latLng
}

type cacheEntry struct {
	value   any
	expires time.Time
}

func newTravelCache(next TravelSource, cfg travelConfig) *travelCache {
	return &travelCache{next: next, cfg: cfg, entries: map[cacheKey]cacheEntry{}}
}

func (c *travelCache) Route(ctx context.Context, from, to latLng) (Route, error) {
	key := cacheKey{"route", from, to}
	if r, ok := c.get(key).(Route); ok {
		return copyRoute(r), nil
	}
	r, err := c.next.Route(ctx, from, to)
	if err == nil && !r.Simulated {
		c.put(key, copyRoute(r), c.cfg.RouteTTL)
	}
	return r, err
}

// DriveTime snaps the origin to the grid: it is where a car is for an ETA (DD-06), and a car
// that has moved a few metres should still hit. Pickup points, the other origin, are far apart.
func (c *travelCache) DriveTime(ctx context.Context, from, to latLng) (Travel, error) {
	key := cacheKey{"drive", snapToGrid(from, c.cfg.GridM), to}
	if t, ok := c.get(key).(Travel); ok {
		return t, nil
	}
	t, err := c.next.DriveTime(ctx, from, to)
	if err == nil && !t.Simulated {
		c.put(key, t, c.cfg.DriveTTL)
	}
	return t, err
}

func (c *travelCache) Walk(ctx context.Context, from, to latLng) (Walk, error) {
	key := cacheKey{"walk", from, to}
	if w, ok := c.get(key).(Walk); ok {
		return w, nil
	}
	w, err := c.next.Walk(ctx, from, to)
	if err == nil && !w.Simulated {
		c.put(key, w, c.cfg.WalkTTL)
	}
	return w, err
}

func (c *travelCache) get(key cacheKey) any {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || !c.cfg.Now().Before(e.expires) {
		return nil
	}
	return e.value
}

// put stores a value and, at most once per driving TTL, drops the expired entries so positions
// a car has left do not pile up.
func (c *travelCache) put(key cacheKey, value any, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.cfg.Now()
	if !now.Before(c.nextSweep) {
		for k, e := range c.entries {
			if !now.Before(e.expires) {
				delete(c.entries, k)
			}
		}
		c.nextSweep = now.Add(c.cfg.DriveTTL)
	}
	c.entries[key] = cacheEntry{value, now.Add(ttl)}
}

// copyRoute gives the caller its own points, so changing them cannot change the cache.
func copyRoute(r Route) Route {
	r.Points = slices.Clone(r.Points)
	return r
}

// snapToGrid moves a point to the centre of its cell of about sizeM metres.
func snapToGrid(p latLng, sizeM float64) latLng {
	latStep := sizeM / (earthRadiusM * math.Pi / 180)
	lat := math.Round(p.Lat/latStep) * latStep
	lngStep := latStep / math.Cos(lat*math.Pi/180)
	return latLng{lat, math.Round(p.Lng/lngStep) * lngStep}
}
