package server

import (
	"context"
	"testing"
)

func required(ids ...int64) []tagFilter {
	out := make([]tagFilter, len(ids))
	for i, id := range ids {
		out[i] = tagFilter{id, "required"}
	}
	return out
}

func preferred(ids ...int64) []tagFilter {
	out := make([]tagFilter, len(ids))
	for i, id := range ids {
		out[i] = tagFilter{id, "preferred"}
	}
	return out
}

func TestEligible(t *testing.T) {
	p := matchParams{AddressMatchM: 200, WaitLimitS: 600}
	dest := latLng{25.0800, 121.5700}
	eta := func(s int) *int { return &s }

	base := func() (matchRequest, matchTrip) {
		return matchRequest{PickupPointID: 1, Destination: dest, AcceptedStops: []int64{7}},
			matchTrip{ID: 1, PickupPointID: 1, Active: true, Destination: dest, Capacity: 3, ETASeconds: eta(300)}
	}
	far := offsetM(dest, 1000)

	cases := []struct {
		name string
		mod  func(*matchRequest, *matchTrip)
		want bool
	}{
		{"all conditions met", func(*matchRequest, *matchTrip) {}, true},

		// REQ-037: same pickup, not yet passed.
		{"different pickup point", func(_ *matchRequest, t *matchTrip) { t.PickupPointID = 2 }, false},
		{"already passed the pickup", func(_ *matchRequest, t *matchTrip) { t.PassedPickup = true }, false},
		{"trip not active", func(_ *matchRequest, t *matchTrip) { t.Active = false }, false},

		// REQ-038: destination within the match distance, or a stop along the route.
		{"destination just inside the match distance", func(_ *matchRequest, t *matchTrip) { t.Destination = offsetM(dest, 190) }, true},
		{"destination just outside the match distance", func(_ *matchRequest, t *matchTrip) { t.Destination = offsetM(dest, 210) }, false},
		{"far destination but route passes an accepted stop", func(_ *matchRequest, t *matchTrip) {
			t.Destination, t.RouteStops = far, []int64{3, 7}
		}, true},
		{"far destination and route passes no accepted stop", func(_ *matchRequest, t *matchTrip) {
			t.Destination, t.RouteStops = far, []int64{3, 4}
		}, false},
		{"far destination and passenger accepts no stop", func(r *matchRequest, t *matchTrip) {
			t.Destination, t.RouteStops, r.AcceptedStops = far, []int64{3, 7}, nil
		}, false},

		// REQ-039: seats left after confirmed passengers.
		{"one seat left", func(_ *matchRequest, t *matchTrip) { t.SeatsConfirmed = 2 }, true},
		{"no seat left", func(_ *matchRequest, t *matchTrip) { t.SeatsConfirmed = 3 }, false},
		{"last seat is held, not confirmed", func(_ *matchRequest, t *matchTrip) { t.SeatsHeld, t.SeatsConfirmed = 1, 2 }, false},
		{"held and confirmed leave one seat", func(_ *matchRequest, t *matchTrip) { t.SeatsHeld, t.SeatsConfirmed = 1, 1 }, true},

		// REQ-040: required tags must match both ways.
		{"passenger requirement met by driver", func(r *matchRequest, t *matchTrip) {
			r.Filters, t.Tags = required(1, 2), []int64{1, 2, 3}
		}, true},
		{"passenger requirement not met by driver", func(r *matchRequest, t *matchTrip) {
			r.Filters, t.Tags = required(1, 2), []int64{1}
		}, false},
		{"driver requirement met by passenger", func(r *matchRequest, t *matchTrip) {
			t.Filters, r.Tags = required(4), []int64{4}
		}, true},
		{"driver requirement not met by passenger", func(r *matchRequest, t *matchTrip) {
			t.Filters, r.Tags = required(4), []int64{5}
		}, false},

		// REQ-013: a preferred filter never excludes a car.
		{"passenger preferred tag not met", func(r *matchRequest, t *matchTrip) {
			r.Filters, t.Tags = preferred(1), nil
		}, true},
		{"driver preferred tag not met", func(r *matchRequest, t *matchTrip) {
			t.Filters, r.Tags = preferred(4), nil
		}, true},
		{"preferred unmet but required met", func(r *matchRequest, t *matchTrip) {
			r.Filters, t.Tags = append(required(1), preferred(2)...), []int64{1}
		}, true},
		{"required unmet beside a preferred one met", func(r *matchRequest, t *matchTrip) {
			r.Filters, t.Tags = append(required(1), preferred(2)...), []int64{2}
		}, false},

		// REQ-041: wait limit, inclusive, no exception.
		{"wait exactly at the limit", func(_ *matchRequest, t *matchTrip) { t.ETASeconds = eta(600) }, true},
		{"wait just over the limit", func(_ *matchRequest, t *matchTrip) { t.ETASeconds = eta(601) }, false},
		{"no ETA", func(_ *matchRequest, t *matchTrip) { t.ETASeconds = nil }, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r, trip := base()
			c.mod(&r, &trip)
			if got := eligible(p, r, trip); got != c.want {
				t.Fatalf("eligible = %v, want %v", got, c.want)
			}
		})
	}
}

// The wait limit is a hard condition: matching tags, a close destination and free seats do not
// buy a car a longer wait (REQ-041).
func TestWaitLimitIsNeverRelaxed(t *testing.T) {
	p := matchParams{AddressMatchM: 200, WaitLimitS: 600}
	dest := latLng{25.0800, 121.5700}
	slow := 3600
	r := matchRequest{PickupPointID: 1, Destination: dest, Filters: required(1), Tags: []int64{1}}
	trip := matchTrip{PickupPointID: 1, Active: true, Destination: dest, Capacity: 4, Tags: []int64{1}, Filters: required(1), ETASeconds: &slow}
	if eligible(p, r, trip) {
		t.Fatal("a car beyond the wait limit was eligible despite matching everything else")
	}
}

func TestLoadMatchParams(t *testing.T) {
	tx := testTx(t)
	mustExec(t, tx, `UPDATE system_settings SET value = 150 WHERE key = 'address_match_distance'`)
	mustExec(t, tx, `UPDATE system_settings SET value = 10 WHERE key = 'wait_limit'`)
	p, err := loadMatchParams(context.Background(), tx)
	if err != nil {
		t.Fatal(err)
	}
	if p.AddressMatchM != 150 || p.WaitLimitS != 600 {
		t.Fatalf("params = %+v, want 150 m and 600 s (wait_limit is in minutes)", p)
	}

	// Edited settings apply on the next call, without a restart.
	mustExec(t, tx, `UPDATE system_settings SET value = 5 WHERE key = 'wait_limit'`)
	if p, _ = loadMatchParams(context.Background(), tx); p.WaitLimitS != 300 {
		t.Fatalf("WaitLimitS = %v after editing wait_limit to 5, want 300", p.WaitLimitS)
	}
}
