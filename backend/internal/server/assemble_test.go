package server

import (
	"context"
	"errors"
	"math"
	"testing"
)

// fakeRoutes returns a ride time per destination, so a test can see which one was used.
type fakeRoutes struct {
	ride map[latLng]int
	sim  bool
	err  error
	n    int
}

func (f *fakeRoutes) DriveTime(_ context.Context, _, to latLng) (Travel, error) {
	f.n++
	return Travel{DurationS: f.ride[to], Simulated: f.sim}, f.err
}

type fakeWalks struct {
	walk map[latLng]int
	sim  bool
	err  error
}

func (f fakeWalks) Walk(_ context.Context, from, _ latLng) (Walk, error) {
	return Walk{DurationS: f.walk[from], Simulated: f.sim}, f.err
}

// REQ-043: candidates are the driver's destination plus RouteStops ∩ AcceptedStops, with ride
// and walk times from the injected providers; the shortest ride + walk is selected.
func TestRankRequestUsesProvidersAndCandidates(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	dest := latLng{25.0900, 121.5700}
	s1, s2, s3 := latLng{25.0850, 121.5700}, latLng{25.0860, 121.5700}, latLng{25.0870, 121.5700}
	stops := map[int64]latLng{1: s1, 2: s2, 3: s3}
	routes := &fakeRoutes{ride: map[latLng]int{dest: 900, s1: 600, s2: 700, s3: 100}}
	walks := fakeWalks{walk: map[latLng]int{dest: 60, s1: 300, s2: 120, s3: 0}}
	eta := 120
	trip := matchTrip{ID: 1, PickupPointID: 1, Active: true, Destination: dest, Capacity: 3,
		ETASeconds: &eta, RouteStops: []int64{1, 2, 3}}
	r := matchRequest{PickupPointID: 1, Destination: offsetM(dest, 10), AcceptedStops: []int64{1, 2}}

	got, failed := rankRequest(context.Background(), routes, walks, proposalParams(), r, pickup, stops, []matchTrip{trip})
	if len(failed) != 0 {
		t.Fatal(failed)
	}
	// dest 960, s1 900, s2 820; s3 (cheapest, 100) is not accepted so it must not appear.
	if len(got) != 1 || got[0].DropOff.StopID == nil || *got[0].DropOff.StopID != 2 {
		t.Fatalf("got %+v, want stop 2", got)
	}
	if got[0].DropOff.RideS != 700 || got[0].DropOff.WalkS != 120 {
		t.Errorf("times = %+v, want ride 700 walk 120", got[0].DropOff)
	}
	if routes.n != 3 {
		t.Errorf("route calls = %d, want 3 (destination, S1, S2)", routes.n)
	}
	// 2 min wait x2 + 700 s ride + 120 s walk x1.5
	if want := 240.0 + 700 + 180; got[0].CostS != want {
		t.Errorf("cost = %v, want %v", got[0].CostS, want)
	}
}

// The ranking across cars follows the provider values, and ineligible cars are never priced.
func TestRankRequestOrdersByProviderTimes(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	dA, dB, dC := latLng{25.0900, 121.5700}, latLng{25.0910, 121.5700}, latLng{25.0920, 121.5700}
	routes := &fakeRoutes{ride: map[latLng]int{dA: 900, dB: 600, dC: 100}}
	walks := fakeWalks{walk: map[latLng]int{dA: 0, dB: 0, dC: 0}}
	eta := 0
	mk := func(id int64, d latLng) matchTrip {
		return matchTrip{ID: id, PickupPointID: 1, Active: true, Destination: d, Capacity: 3, ETASeconds: &eta}
	}
	c := mk(3, dC)
	c.PassedPickup = true
	r := matchRequest{PickupPointID: 1, Destination: dA}
	// All three destinations lie within the match distance of dA's neighbourhood only when the
	// distance is generous, so widen it for the test.
	p := proposalParams()
	p.AddressMatchM = 5000

	got, failed := rankRequest(context.Background(), routes, walks, p, r, pickup, nil, []matchTrip{mk(1, dA), mk(2, dB), c})
	if len(failed) != 0 {
		t.Fatal(failed)
	}
	if ids := tripIDs(got); !equalIDs(ids, []int64{2, 1}) {
		t.Errorf("order = %v, want [2 1]", ids)
	}
	if routes.n != 2 {
		t.Errorf("route calls = %d, want 2 (the passed car is skipped)", routes.n)
	}
}

// selectiveRoutes fails for one destination only.
type selectiveRoutes struct{ bad latLng }

func (f selectiveRoutes) DriveTime(_ context.Context, _, to latLng) (Travel, error) {
	if to == f.bad {
		return Travel{}, errors.New("boom")
	}
	return Travel{DurationS: 600}, nil
}

// A provider error drops only the trip being priced; the others are still ranked and the
// dropped one is reported.
func TestRankRequestProviderErrorDropsOnlyThatTrip(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	dBad, dOK := latLng{25.0900, 121.5700}, latLng{25.0910, 121.5700}
	eta := 0
	mk := func(id int64, d latLng) matchTrip {
		return matchTrip{ID: id, PickupPointID: 1, Active: true, Destination: d, Capacity: 3, ETASeconds: &eta}
	}
	r := matchRequest{PickupPointID: 1, Destination: dOK}
	p := proposalParams()
	p.AddressMatchM = 5000

	got, failed := rankRequest(context.Background(), selectiveRoutes{bad: dBad}, fakeWalks{}, p, r, pickup, nil,
		[]matchTrip{mk(1, dBad), mk(2, dOK)})
	if ids := tripIDs(got); !equalIDs(ids, []int64{2}) {
		t.Errorf("ranked = %v, want [2]", ids)
	}
	if len(failed) != 1 || failed[0].TripID != 1 || failed[0].Err == nil {
		t.Errorf("failed = %+v, want trip 1 with its error", failed)
	}

	// A walk error and a stop without a position drop the trip the same way.
	trip := mk(3, dOK)
	trip.RouteStops = []int64{9}
	r.AcceptedStops = []int64{9}
	for name, w := range map[string]WalkProvider{"walk error": fakeWalks{err: errors.New("boom")}, "no position": fakeWalks{}} {
		stops := map[int64]latLng{}
		if name == "walk error" {
			stops[9] = dOK
		}
		got, failed := rankRequest(context.Background(), &fakeRoutes{}, w, p, r, pickup, stops, []matchTrip{trip})
		if len(got) != 0 || len(failed) != 1 || failed[0].TripID != 3 {
			t.Errorf("%s: got %v, failed %+v", name, got, failed)
		}
	}
}

// DD-09: the simulated walk is straight distance x 1.3 at 80 m/min, marked as simulated.
func TestStraightWalk(t *testing.T) {
	from := latLng{25.0800, 121.5700}
	w, err := straightWalk{}.Walk(context.Background(), from, offsetM(from, 800))
	if err != nil {
		t.Fatal(err)
	}
	if want := 800 * 1.3 / 80 * 60; math.Abs(float64(w.DurationS)-want) > 2 { // 780 s
		t.Errorf("duration = %d s, want about %.0f", w.DurationS, want)
	}
	if !w.Simulated {
		t.Error("walk is not marked simulated")
	}
	if z, _ := (straightWalk{}).Walk(context.Background(), from, from); z.DurationS != 0 {
		t.Errorf("same point = %d s, want 0", z.DurationS)
	}
}

// DD-09, REQ-063: the chosen drop-off is marked simulated when the ride or the walk is.
func TestRankRequestKeepsSimulatedMark(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	dest := latLng{25.0900, 121.5700}
	eta := 0
	trip := matchTrip{ID: 1, PickupPointID: 1, Active: true, Destination: dest, Capacity: 3, ETASeconds: &eta}
	r := matchRequest{PickupPointID: 1, Destination: dest}

	for _, c := range []struct {
		name             string
		rideSim, walkSim bool
		want             bool
	}{
		{"both real", false, false, false},
		{"ride simulated", true, false, true},
		{"walk simulated", false, true, true},
	} {
		got, failed := rankRequest(context.Background(), &fakeRoutes{sim: c.rideSim}, fakeWalks{sim: c.walkSim},
			proposalParams(), r, pickup, nil, []matchTrip{trip})
		if len(failed) != 0 || len(got) != 1 || got[0].DropOff.Simulated != c.want {
			t.Errorf("%s: got %+v %v, want Simulated=%v", c.name, got, failed, c.want)
		}
	}
}
