package server

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// hangingSource is an external source that answers only when its context ends, like a source
// that is slow but does not time out by itself.
type hangingSource struct{ simulated }

func (hangingSource) DriveTime(ctx context.Context, _, _ latLng) (Travel, error) {
	<-ctx.Done()
	return Travel{}, ctx.Err()
}

func (hangingSource) Walk(ctx context.Context, _, _ latLng) (Walk, error) {
	<-ctx.Done()
	return Walk{}, ctx.Err()
}

// slowTravel wraps a hanging source as main does, with a per-call timeout far above the budget,
// so only the time budget ends the waiting.
func slowTravel() TravelSource {
	cfg := defaultTravelConfig()
	cfg.Timeout = time.Minute
	return newTravel(hangingSource{}, cfg)
}

// DD-09, REQ-042: a ranking against a slow source ends within the time budget, the estimates
// after the budget are simulated and marked so, and the source is not counted as down.
func TestRankingFinishesWithinTheBudgetAndMarksSimulated(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	dest := latLng{25.0900, 121.5700}
	stops := map[int64]latLng{1: {25.0850, 121.5700}, 2: {25.0860, 121.5700}}
	eta := 120
	var trips []matchTrip
	for id := int64(1); id <= 3; id++ { // 3 trips x 3 drop-offs x 2 estimates, all waiting on the source
		trips = append(trips, matchTrip{ID: id, PickupPointID: 1, Active: true, Destination: dest, Capacity: 3,
			ETASeconds: &eta, RouteStops: []int64{1, 2}})
	}
	r := matchRequest{PickupPointID: 1, Destination: offsetM(dest, 10), AcceptedStops: []int64{1, 2}}
	src := slowTravel()

	budget := 200 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	start := time.Now()
	got, failed := rankRequest(ctx, src, src, proposalParams(), r, pickup, stops, trips)
	if took := time.Since(start); took > budget+500*time.Millisecond {
		t.Errorf("ranking took %v, want about the %v budget", took, budget)
	}
	if len(failed) != 0 || len(got) != 3 {
		t.Fatalf("ranked %d, failed %v, want all 3 trips ranked", len(got), failed)
	}
	for _, g := range got {
		if !g.DropOff.Simulated {
			t.Errorf("trip %d is marked real, want simulated: the source never answered", g.TripID)
		}
	}
	if !src.(*travelCache).next.(*fallback).breaker.allow() {
		t.Error("the breaker opened: running out of budget is not a source failure")
	}
}

// DD-09: the budget never reaches the database. A slow source makes the ranking spend the whole
// budget while the request's transaction is open; the request still commits.
func TestSlowSourceStillCommitsTheRequest(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	f := newRaceFixture(t, pool)

	src := slowTravel()
	s := &Server{db: pool, routes: src, drives: src, walks: src, rankBudget: 200 * time.Millisecond}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	start := time.Now()
	v, err := s.placeRequest(ctx, tx, f.input(f.passengers[0]))
	if err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); took > 2*time.Second {
		t.Errorf("placing the request took %v, want about the 200ms budget (the per-call timeout is a minute)", took)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit after the budget ran out: %v", err)
	}
	if v.Status != reqWaitingDriver || v.TripID == nil || *v.TripID != f.trip {
		t.Errorf("request = %+v, want the seat on trip %d", v, f.trip)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM ride_requests WHERE id = $1`, v.ID).Scan(&status); err != nil || status != reqWaitingDriver {
		t.Errorf("stored status %q (%v), want %s", status, err, reqWaitingDriver)
	}
}
