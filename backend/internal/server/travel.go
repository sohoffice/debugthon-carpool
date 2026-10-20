package server

import (
	"context"
	"time"
)

// Travel is a driving time between two points. Simulated marks an estimate rather than a real
// routing result (DD-09).
type Travel struct {
	DurationS int
	Simulated bool
}

// DriveTimer estimates only the driving time between two points, without building a route: the
// ride from a pickup point to a drop-off place, and a car's ETA to its pickup point (DD-09).
type DriveTimer interface {
	DriveTime(ctx context.Context, from, to latLng) (Travel, error)
}

// TravelSource provides all three estimates of DD-09: trip routes, driving times and walks.
type TravelSource interface {
	RouteProvider
	DriveTimer
	WalkProvider
}

// simulated is the simulated fallback of DD-09 for all three estimates.
type simulated struct {
	straightRoute
	straightWalk
}

// travelConfig holds the protection settings of DD-09. They are design values, kept as
// parameters so tests can shrink them.
type travelConfig struct {
	Timeout          time.Duration // per call to the external source
	BreakerThreshold int           // consecutive failures that open the breaker
	BreakerCooldown  time.Duration // how long the breaker stays open
	GridM            float64       // cell size that car positions snap to in the cache
	RouteTTL         time.Duration
	DriveTTL         time.Duration // short: driving times follow the traffic
	WalkTTL          time.Duration
	Now              func() time.Time
}

func defaultTravelConfig() travelConfig {
	return travelConfig{
		Timeout:          1500 * time.Millisecond,
		BreakerThreshold: 3,
		BreakerCooldown:  30 * time.Second,
		GridM:            50,
		RouteTTL:         10 * time.Minute,
		DriveTTL:         5 * time.Minute,
		WalkTTL:          24 * time.Hour,
		Now:              time.Now,
	}
}

// newTravel wraps an external source in the protections of DD-09, outermost first:
// cache → fallback (timeout, breaker, time budget) → the source, or the simulated estimate.
// Simulated results stay out of the cache, so real data returns as soon as the source recovers.
func newTravel(source TravelSource, cfg travelConfig) TravelSource {
	return newTravelCache(newFallback(source, cfg), cfg)
}

// NewGoogleTravel estimates routes and times with Google Routes (carpool-oi-02), protected as
// DD-09 describes. The key stays on the server.
func NewGoogleTravel(apiKey string) TravelSource {
	return newTravel(newGoogleRoutes(apiKey), defaultTravelConfig())
}
