package server

import "context"

// Walk is a walking estimate between two points. Simulated marks an estimate rather than a
// real routing result (DD-09).
type Walk struct {
	DurationS int
	Simulated bool
}

// WalkProvider estimates the walk from a drop-off place to the passenger's final destination.
// It is the narrow slice of walking-time estimation (T07) that the matching engine needs.
type WalkProvider interface {
	Walk(ctx context.Context, from, to latLng) (Walk, error)
}

// straightWalk is the simulated fallback of DD-09: the straight-line distance x 1.3, walked
// at 80 metres a minute.
type straightWalk struct{}

func (straightWalk) Walk(_ context.Context, from, to latLng) (Walk, error) {
	return Walk{DurationS: int(distanceM(from, to) * 1.3 / (80.0 / 60)), Simulated: true}, nil
}
