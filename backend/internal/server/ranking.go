package server

import "sort"

// Ranking of the matching engine (REQ-042..REQ-046, DD-11). Pure like the screening: the
// ride and walk times arrive on each dropOff; assemble.go fetches them from the providers.

// dropOff is a place the passenger can get off: the driver's destination (StopID nil) or a
// bus stop the route passes. RideS runs pickup → here, WalkS here → the final destination.
type dropOff struct {
	StopID *int64
	RideS  float64
	WalkS  float64
	// Simulated is true when the ride or the walk time is an estimate, not real data (DD-09, REQ-063).
	Simulated bool
}

// rankCandidate is a trip together with the drop-off places available on it.
type rankCandidate struct {
	Trip     matchTrip
	DropOffs []dropOff
}

// rankedTrip is a trip that passed screening, with the drop-off chosen for it.
type rankedTrip struct {
	TripID  int64
	DropOff dropOff
	WaitS   float64
	CostS   float64 // perceived cost, seconds; lower is better
}

// rankTrips drops the trips that fail screening and orders the rest by perceived cost,
// then by shorter wait. The driver's preferred filters are never read (REQ-046).
func rankTrips(p matchParams, r matchRequest, cands []rankCandidate) []rankedTrip {
	var out []rankedTrip
	for _, c := range cands {
		if !eligible(p, r, c.Trip) || len(c.DropOffs) == 0 {
			continue
		}
		wait := float64(*c.Trip.ETASeconds)
		d := bestDropOff(c.DropOffs) // REQ-043
		cost := p.WaitWeight*wait + d.RideS + p.WalkWeight*d.WalkS - tagBonusS(p, r, c.Trip)
		out = append(out, rankedTrip{TripID: c.Trip.ID, DropOff: d, WaitS: wait, CostS: cost})
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.CostS != b.CostS {
			return a.CostS < b.CostS
		}
		return a.WaitS < b.WaitS // REQ-044
	})
	return out
}

// bestDropOff picks the place with the shortest ride plus walk (REQ-043).
func bestDropOff(ds []dropOff) dropOff {
	best := ds[0]
	for _, d := range ds[1:] {
		if d.RideS+d.WalkS < best.RideS+best.WalkS {
			best = d
		}
	}
	return best
}

// tagBonusS is the cap scaled by the share of the passenger's preferred tags the car carries
// (REQ-045); it never exceeds the cap, however many tags are set.
func tagBonusS(p matchParams, r matchRequest, t matchTrip) float64 {
	have := make(map[int64]bool, len(t.Tags))
	for _, id := range t.Tags {
		have[id] = true
	}
	var set, matched int
	for _, f := range r.Filters {
		if f.Intent != "preferred" {
			continue
		}
		set++
		if have[f.TagID] {
			matched++
		}
	}
	if set == 0 {
		return 0
	}
	return p.TagBonusCapS * float64(matched) / float64(set)
}
