package server

import (
	"context"

	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// Eligibility screening of the matching engine (REQ-037..REQ-041, DD-10). Stateless: every
// input is passed in, so supply queries and the request flow screen with the same rules.

// matchParams are the system settings the screening reads (DD-20).
type matchParams struct {
	AddressMatchM float64 // address match distance, metres
	WaitLimitS    float64 // wait limit, seconds
	WaitWeight    float64 // 1 minute of waiting counts as this many minutes (REQ-042)
	WalkWeight    float64 // 1 minute of walking counts as this many minutes (REQ-042)
	TagBonusCapS  float64 // most the preferred tags can lower a cost, seconds (REQ-045)
}

// loadMatchParams reads the current values on every call, so an edited setting applies at once.
// wait_limit and tag_bonus_cap are stored in minutes.
func loadMatchParams(ctx context.Context, db DB) (matchParams, error) {
	r := settings.New(db)
	addr, err := r.Get(ctx, "address_match_distance")
	if err != nil {
		return matchParams{}, err
	}
	wait, err := r.Get(ctx, "wait_limit")
	if err != nil {
		return matchParams{}, err
	}
	waitW, err := r.Get(ctx, "wait_weight")
	if err != nil {
		return matchParams{}, err
	}
	walkW, err := r.Get(ctx, "walk_weight")
	if err != nil {
		return matchParams{}, err
	}
	bonus, err := r.Get(ctx, "tag_bonus_cap")
	if err != nil {
		return matchParams{}, err
	}
	return matchParams{AddressMatchM: addr, WaitLimitS: wait * 60, WaitWeight: waitW, WalkWeight: walkW,
		TagBonusCapS: bonus * 60}, nil
}

// tagFilter is a tag a side asks the other to carry. Only required ones screen (REQ-013,
// REQ-040); preferred ones belong to ranking (REQ-045).
type tagFilter struct {
	TagID  int64
	Intent string // "required" or "preferred"
}

// matchRequest is what the passenger asks for.
type matchRequest struct {
	PickupPointID int64
	Destination   latLng
	AcceptedStops []int64     // bus stops the passenger is willing to get off at
	Filters       []tagFilter // the passenger's tag filters
	Tags          []int64     // the tags the passenger carries
}

// matchTrip is a car's state at the time of screening.
type matchTrip struct {
	ID             int64
	PickupPointID  int64
	Active         bool
	PassedPickup   bool
	Destination    latLng
	RouteStops     []int64 // bus stops along the stored route (DD-21)
	Capacity       int
	SeatsHeld      int // held for a request the driver has not answered yet; still taken
	SeatsConfirmed int
	Filters        []tagFilter // the driver's tag filters
	Tags           []int64     // the tags the driver carries
	ETASeconds     *int        // seconds to the pickup point; nil when there is no ETA (T06A)
}

// eligible reports whether the trip passes every hard condition for the request.
func eligible(p matchParams, r matchRequest, t matchTrip) bool {
	return t.Active && t.PickupPointID == r.PickupPointID && !t.PassedPickup && // REQ-037
		destinationRelevant(p, r, t) && // REQ-038
		t.SeatsHeld+t.SeatsConfirmed < t.Capacity && // REQ-039, DD-12
		meetsRequired(r.Tags, t.Filters) && meetsRequired(t.Tags, r.Filters) && // REQ-040
		t.ETASeconds != nil && float64(*t.ETASeconds) <= p.WaitLimitS // REQ-041, never relaxed
}

// destinationRelevant: the driver's destination is within the address match distance of the
// passenger's, or the route passes one of the stops the passenger accepts.
func destinationRelevant(p matchParams, r matchRequest, t matchTrip) bool {
	if distanceM(t.Destination, r.Destination) <= p.AddressMatchM {
		return true
	}
	for _, s := range t.RouteStops {
		for _, a := range r.AcceptedStops {
			if s == a {
				return true
			}
		}
	}
	return false
}

// meetsRequired reports whether have contains the tag of every required filter.
func meetsRequired(have []int64, filters []tagFilter) bool {
	set := make(map[int64]bool, len(have))
	for _, id := range have {
		set[id] = true
	}
	for _, f := range filters {
		if f.Intent == "required" && !set[f.TagID] {
			return false
		}
	}
	return true
}
