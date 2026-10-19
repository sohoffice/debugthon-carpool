package server

import (
	"context"
	"fmt"
)

// tripFailure is a trip left out of the ranking because a provider failed while pricing it.
type tripFailure struct {
	TripID int64
	Err    error
}

// rankRequest screens the trips, builds each one's drop-off candidates and ranks them
// (REQ-042, REQ-043, DD-11). Ride and walk times come from the injected providers; stops
// holds the position of every bus stop a route may pass. A provider error only drops the trip
// being priced: the rest are still ranked, and the dropped trips are returned so the caller
// can log or surface them.
func rankRequest(ctx context.Context, routes RouteProvider, walks WalkProvider, p matchParams,
	r matchRequest, pickup latLng, stops map[int64]latLng, trips []matchTrip) ([]rankedTrip, []tripFailure) {
	var failed []tripFailure
	var cands []rankCandidate
	for _, t := range trips {
		if !eligible(p, r, t) { // no point pricing a car that cannot be assigned
			continue
		}
		ds, err := dropOffsFor(ctx, routes, walks, r, pickup, stops, t)
		if err != nil {
			failed = append(failed, tripFailure{t.ID, err})
			continue
		}
		cands = append(cands, rankCandidate{Trip: t, DropOffs: ds})
	}
	return rankTrips(p, r, cands), failed
}

// dropOffsFor lists where the passenger can get off this trip: the driver's destination, and
// each stop the route passes that the passenger accepts (REQ-043).
func dropOffsFor(ctx context.Context, routes RouteProvider, walks WalkProvider, r matchRequest,
	pickup latLng, stops map[int64]latLng, t matchTrip) ([]dropOff, error) {
	price := func(id *int64, at latLng) (dropOff, error) {
		ride, err := routes.Route(ctx, pickup, at)
		if err != nil {
			return dropOff{}, err
		}
		walk, err := walks.Walk(ctx, at, r.Destination)
		if err != nil {
			return dropOff{}, err
		}
		return dropOff{StopID: id, RideS: float64(ride.DurationS), WalkS: float64(walk.DurationS),
			Simulated: ride.Simulated || walk.Simulated}, nil
	}

	d, err := price(nil, t.Destination)
	if err != nil {
		return nil, err
	}
	out := []dropOff{d}
	accepted := make(map[int64]bool, len(r.AcceptedStops))
	for _, id := range r.AcceptedStops {
		accepted[id] = true
	}
	for _, id := range t.RouteStops {
		if !accepted[id] {
			continue
		}
		pos, ok := stops[id]
		if !ok {
			return nil, fmt.Errorf("bus stop %d has no position", id)
		}
		d, err := price(&id, pos)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}
