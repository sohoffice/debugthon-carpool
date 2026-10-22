package server

import (
	"math"
	"testing"
)

// minutes converts the proposal's minute figures to the seconds the engine works in.
func minutes(m float64) float64 { return m * 60 }

func ptr(id int64) *int64 { return &id }

// proposalCandidates is the simulation table of proposal 7.3. Passenger prefers tag 1
// ("same company") and accepts stops S1 (walk 4) and S2 (walk 9).
func proposalCandidates() (matchRequest, []rankCandidate) {
	dest := latLng{25.0800, 121.5700}
	far := offsetM(dest, 1000)
	eta := func(m float64) *int { s := int(minutes(m)); return &s }
	r := matchRequest{PickupPointID: 1, Destination: dest, AcceptedStops: []int64{1, 2}, Filters: preferred(1)}
	trip := func(id int64, waitMin float64) matchTrip {
		return matchTrip{ID: id, PickupPointID: 1, Active: true, Destination: dest, Capacity: 3, ETASeconds: eta(waitMin)}
	}
	a, b, c, d, e := trip(1, 8), trip(2, 2), trip(3, 1), trip(4, 6), trip(5, 12)
	b.Destination, b.RouteStops = far, []int64{1}
	c.Destination, c.RouteStops = far, []int64{2}
	d.Tags = []int64{1}
	return r, []rankCandidate{
		{a, []dropOff{{nil, minutes(15), minutes(1), false}}},
		{b, []dropOff{{ptr(1), minutes(13), minutes(4), false}}},
		{c, []dropOff{{ptr(2), minutes(11), minutes(9), false}}},
		{d, []dropOff{{nil, minutes(15), minutes(1), false}}},
		{e, []dropOff{{nil, minutes(15), minutes(1), false}}},
	}
}

func proposalParams() matchParams {
	return matchParams{AddressMatchM: 200, WaitLimitS: minutes(10), WaitWeight: 2, WalkWeight: 1.5, TagBonusCapS: minutes(4)}
}

func tripIDs(rs []rankedTrip) []int64 {
	out := make([]int64, len(rs))
	for i, r := range rs {
		out[i] = r.TripID
	}
	return out
}

func equalIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// REQ-042, REQ-045, DD-11: golden test from the proposal 7.3 table.
func TestRankProposalSimulation(t *testing.T) {
	r, cands := proposalCandidates()
	got := rankTrips(proposalParams(), r, cands)
	if want := []int64{2, 4, 3, 1}; !equalIDs(tripIDs(got), want) { // B → D → C → A, E excluded
		t.Fatalf("order = %v, want %v", tripIDs(got), want)
	}
	wantCost := map[int64]float64{2: 23, 4: 24.5, 3: 26.5, 1: 32.5}
	for _, g := range got {
		if math.Abs(g.CostS-minutes(wantCost[g.TripID])) > 1e-6 {
			t.Errorf("trip %d cost = %.2f min, want %.1f", g.TripID, g.CostS/60, wantCost[g.TripID])
		}
	}
}

// "How to tune": S1 is a 10 minute walk. Raising the walk weight from 1.5 to 2 (β 0.5 → 1)
// lets the exact-match car A win.
func TestRankWalkWeightTuning(t *testing.T) {
	r, cands := proposalCandidates()
	cands = cands[:2] // A and B
	cands[1].DropOffs = []dropOff{{ptr(1), minutes(13), minutes(10), false}}
	p := proposalParams()

	if got := tripIDs(rankTrips(p, r, cands)); got[0] != 2 {
		t.Errorf("beta 0.5: winner = %d, want B (2)", got[0])
	}
	p.WalkWeight = 2
	if got := tripIDs(rankTrips(p, r, cands)); got[0] != 1 {
		t.Errorf("beta 1: winner = %d, want A (1)", got[0])
	}
}

// REQ-043: the drop-off with the shortest ride plus walk is chosen, not the nearest stop
// nor the first listed.
func TestRankChoosesShortestDropOff(t *testing.T) {
	r, cands := proposalCandidates()
	c := cands[1] // B
	c.DropOffs = []dropOff{
		{ptr(1), minutes(13), minutes(8), false}, // 21
		{ptr(2), minutes(15), minutes(4), false}, // 19
		{nil, minutes(20), minutes(3), false},    // 23
	}
	got := rankTrips(proposalParams(), r, []rankCandidate{c})
	if len(got) != 1 || got[0].DropOff.StopID == nil || *got[0].DropOff.StopID != 2 {
		t.Fatalf("drop-off = %+v, want stop 2", got)
	}
}

// REQ-044: equal cost → shorter wait first. Wait weight 1 and walk weight 1 make
// (wait 2, ride 10) and (wait 4, ride 8) cost the same.
func TestRankTieShorterWaitFirst(t *testing.T) {
	r, cands := proposalCandidates()
	p := proposalParams()
	p.WaitWeight, p.WalkWeight = 1, 1
	x, y := cands[1], cands[2]
	x.Trip.ETASeconds, y.Trip.ETASeconds = new(int), new(int)
	*x.Trip.ETASeconds, *y.Trip.ETASeconds = 240, 120
	x.DropOffs = []dropOff{{ptr(1), minutes(8), minutes(4), false}}
	y.DropOffs = []dropOff{{ptr(2), minutes(10), minutes(4), false}}
	got := rankTrips(p, r, []rankCandidate{x, y})
	if got[0].CostS != got[1].CostS {
		t.Fatalf("costs differ: %v vs %v", got[0].CostS, got[1].CostS)
	}
	if got[0].TripID != y.Trip.ID {
		t.Errorf("first = %d, want the shorter-wait trip %d", got[0].TripID, y.Trip.ID)
	}
}

// REQ-045: bonus is cap × matched ÷ set, and never above the cap.
func TestTagBonus(t *testing.T) {
	p := proposalParams()
	cases := []struct {
		name    string
		filters []tagFilter
		tags    []int64
		wantMin float64
	}{
		{"no preferred tags", nil, []int64{1}, 0},
		{"required tags give no bonus", required(1), []int64{1}, 0},
		{"2 of 3 matched", preferred(1, 2, 3), []int64{1, 2}, 4.0 * 2 / 3},
		{"all matched", preferred(1, 2, 3), []int64{1, 2, 3}, 4},
		{"one of one matched", preferred(1), []int64{1, 9}, 4},
		{"none matched", preferred(1, 2), []int64{3}, 0},
	}
	for _, c := range cases {
		got := tagBonusS(p, matchRequest{Filters: c.filters}, matchTrip{Tags: c.tags})
		if math.Abs(got-minutes(c.wantMin)) > 1e-6 {
			t.Errorf("%s: bonus = %.3f min, want %.3f", c.name, got/60, c.wantMin)
		}
	}
}

// Ineligible trips never appear, whatever their cost would be.
func TestRankExcludesIneligible(t *testing.T) {
	r, cands := proposalCandidates()
	cands[1].Trip.PassedPickup = true
	cands[2].Trip.ETASeconds = nil
	if got := tripIDs(rankTrips(proposalParams(), r, cands)); !equalIDs(got, []int64{4, 1}) {
		t.Errorf("order = %v, want [4 1]", got)
	}
}
