package server

import (
	"context"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// migrationUp returns the Up section of a migration, so a test can run the seed SQL itself.
func migrationUp(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile("../../migrations/" + name)
	if err != nil {
		t.Fatal(err)
	}
	up, _, _ := strings.Cut(string(b), "-- +goose Down")
	return strings.Replace(up, "-- +goose Up", "", 1)
}

// freshDemoSeed puts passenger1 and driver4 back to the state right after the seed migration:
// a manual demo on the dev database changes both (DD-19), so the test clears what the demo
// produced and runs the migration's own SQL again. It skips when the demo left rows that
// reference driver4's trips; `just backend db-reset` then restores a clean database.
func freshDemoSeed(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx := context.Background()
	sp, err := tx.Begin(ctx) // savepoint: a failed delete must not abort the test transaction
	if err != nil {
		t.Fatal(err)
	}
	_, err = sp.Exec(ctx, `DELETE FROM trips WHERE driver_id = (SELECT id FROM users WHERE username = 'driver4')`)
	if err != nil {
		_ = sp.Rollback(ctx)
		t.Skipf("driver4 has demo data that blocks re-seeding (run `just backend db-reset`): %v", err)
	}
	if err := sp.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	mustExec(t, tx, `DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1')`)
	mustExec(t, tx, migrationUp(t, "20261020120000_seed_demo_habitual_data.sql"))
}

// REQ-025, DD-19: passenger1's profile carries the seeded destination and accepted stops;
// passenger2 starts empty. The arrival time is not seeded.
func TestSeedPassengerProfile(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)

	type stop struct {
		StopID *int `json:"stop_id"`
	}
	type profile struct {
		UsualArrivalTime *string `json:"usual_arrival_time"`
		UsualDestination *place  `json:"usual_destination"`
		AcceptedStops    []stop  `json:"accepted_stops"`
	}
	p := decode[profile](t, call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger1", ""))
	if p.UsualDestination == nil || *p.UsualDestination != (place{"瑞光路 513 巷", 25.0765, 121.5742}) {
		t.Errorf("destination = %+v", p.UsualDestination)
	}
	if p.UsualArrivalTime != nil {
		t.Errorf("arrival time = %v, want null", *p.UsualArrivalTime)
	}
	var ids []int
	for _, s := range p.AcceptedStops {
		if s.StopID != nil {
			ids = append(ids, *s.StopID)
		}
	}
	if len(ids) != 2 || ids[0]+ids[1] != 1013+1106 {
		t.Errorf("accepted stops = %v, want 1013 and 1106", ids)
	}

	p = decode[profile](t, call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger2", ""))
	if p.UsualDestination != nil || p.UsualArrivalTime != nil || len(p.AcceptedStops) != 0 {
		t.Errorf("passenger2 profile = %+v, want empty", p)
	}
}

// REQ-016, DD-19: driver4's defaults are the seeded ended trip; driver5 has none. The seed
// leaves driver4 without a profile row and without an active or simulated trip.
func TestSeedDriverDefaults(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)
	ctx := context.Background()

	d := decode[defaultsResp](t, call(t, tx, http.MethodGet, "/api/driver/trips/defaults", "driver:driver4", ""))
	var pickupID, tagID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM pickup_points WHERE name = '松山車站'`).Scan(&pickupID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT id FROM tags WHERE name = '不抽菸'`).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	if d.PickupPointID == nil || *d.PickupPointID != pickupID {
		t.Errorf("pickup = %v, want %d", d.PickupPointID, pickupID)
	}
	if d.Destination == nil || *d.Destination != (place{"瑞光路 513 巷", 25.0765, 121.5742}) {
		t.Errorf("destination = %+v", d.Destination)
	}
	if d.Capacity == nil || *d.Capacity != 3 || d.AutoAccept {
		t.Errorf("capacity = %v auto_accept = %v, want 3 and false", d.Capacity, d.AutoAccept)
	}
	if len(d.TagFilters) != 1 || d.TagFilters[0].TagID != tagID || d.TagFilters[0].Intent != "preferred" {
		t.Errorf("tag filters = %+v, want 不抽菸 preferred", d.TagFilters)
	}

	var active, simulated, profiles, records int
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM trips WHERE driver_id = u.id AND status = 'active'),
		       (SELECT count(*) FROM trips WHERE driver_id = u.id AND simulated),
		       (SELECT count(*) FROM driver_profiles WHERE user_id = u.id),
		       (SELECT count(*) FROM service_records WHERE driver_id = u.id)
		  FROM users u WHERE u.username = 'driver4'`).Scan(&active, &simulated, &profiles, &records); err != nil {
		t.Fatal(err)
	}
	if active+simulated+profiles+records != 0 {
		t.Errorf("driver4: active=%d simulated=%d profiles=%d records=%d, want all 0", active, simulated, profiles, records)
	}

	d = decode[defaultsResp](t, call(t, tx, http.MethodGet, "/api/driver/trips/defaults", "driver:driver5", ""))
	if d.PickupPointID != nil || d.Destination != nil || d.Capacity != nil || len(d.TagFilters) != 0 {
		t.Errorf("driver5 defaults = %+v, want empty", d)
	}
}

// DD-19, T03: the migration can run again without duplicating or changing anything.
func TestSeedDemoMigrationIsRepeatable(t *testing.T) {
	tx := testTx(t)
	freshDemoSeed(t, tx)
	count := func() (n [4]int) {
		if err := tx.QueryRow(context.Background(), `
			SELECT (SELECT count(*) FROM passenger_profiles),
			       (SELECT count(*) FROM passenger_accepted_stops),
			       (SELECT count(*) FROM trips),
			       (SELECT count(*) FROM trip_tag_filters)`).Scan(&n[0], &n[1], &n[2], &n[3]); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()
	mustExec(t, tx, migrationUp(t, "20261020120000_seed_demo_habitual_data.sql"))
	if after := count(); after != before {
		t.Errorf("rows after a second run = %v, want %v", after, before)
	}
}

// seedRanking ranks the seeded cars at 松山車站 for passenger1's demo request (瑞光路 513 巷,
// stops 1013 and 1106). etaMin gives each driver's wait in minutes, since positions are not
// seeded; the rest, including routes, tags and capacities, comes from the seed.
func seedRanking(t *testing.T, tx pgx.Tx, etaMin map[string]float64, prefer bool, mutate func(*matchParams)) []string {
	t.Helper()
	ctx := context.Background()
	s := &Server{db: tx, routes: straightRoute{}, drives: straightRoute{}, walks: straightWalk{}}
	var pickupID int64
	var pickup latLng
	if err := tx.QueryRow(ctx, `SELECT id, lat, lng FROM pickup_points WHERE name = '松山車站'`).
		Scan(&pickupID, &pickup.Lat, &pickup.Lng); err != nil {
		t.Fatal(err)
	}
	var tagID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM tags WHERE name = '不抽菸'`).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	req := matchRequest{PickupPointID: pickupID, Destination: latLng{25.0765, 121.5742}}
	if prefer {
		req.Filters = preferred(tagID)
	}
	stops := map[int64]latLng{}
	rows, err := tx.Query(ctx, `SELECT id, stop_id, lat, lng FROM bus_stops`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		var stopID int
		var p latLng
		if err := rows.Scan(&id, &stopID, &p.Lat, &p.Lng); err != nil {
			t.Fatal(err)
		}
		stops[id] = p
		if stopID == 1013 || stopID == 1106 {
			req.AcceptedStops = append(req.AcceptedStops, id)
		}
	}
	rows.Close()

	trips, err := s.loadMatchTrips(ctx, ctx, pickupID)
	if err != nil {
		t.Fatal(err)
	}
	owner := map[int64]string{} // trip id -> driver username
	orows, err := tx.Query(ctx, `SELECT t.id, u.username FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.simulated`)
	if err != nil {
		t.Fatal(err)
	}
	for orows.Next() {
		var id int64
		var name string
		if err := orows.Scan(&id, &name); err != nil {
			t.Fatal(err)
		}
		owner[id] = name
	}
	orows.Close()
	for i := range trips {
		eta := int(minutes(etaMin[owner[trips[i].ID]]))
		trips[i].ETASeconds = &eta
	}

	p, err := loadMatchParams(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	if mutate != nil {
		mutate(&p)
	}
	ranked, failed := rankRequest(ctx, s.drives, s.walks, p, req, pickup, stops, trips)
	if len(failed) != 0 {
		t.Fatalf("trips failed pricing: %+v", failed)
	}
	var names []string
	for _, r := range ranked {
		names = append(names, owner[r.TripID])
	}
	return names
}

func sameNames(a, b []string) bool { return strings.Join(a, ",") == strings.Join(b, ",") }

// Proposal 7.3, REQ-042, REQ-044, REQ-045, DD-20: the seeded cars show the trade-off between
// waiting, walking and a suggested tag. driver1 and driver3 end at passenger1's destination
// (no walk); driver2 only passes 瑞光港墘路口, a walk away; driver3 carries the suggested tag
// 不抽菸 and has the fewest seats. Each step changes one thing and flips the winner.
func TestSeedShowsWaitWalkTagTradeoff(t *testing.T) {
	tx := testTx(t)

	eta := func(d1, d2, d3 float64) map[string]float64 {
		return map[string]float64{"driver1": d1, "driver2": d2, "driver3": d3}
	}
	cases := []struct {
		name   string
		eta    map[string]float64
		prefer bool
		mutate func(*matchParams)
		want   []string
	}{
		// Same wait, no suggestion: the exact-match cars beat the walk; driver1 is the one
		// whose destination is closest.
		{"no suggestion, equal waits", eta(3, 3, 3), false, nil, []string{"driver1", "driver3", "driver2"}},
		// The suggested tag lifts driver3 over driver1 (REQ-045).
		{"suggested tag wins at equal waits", eta(3, 3, 3), true, nil, []string{"driver3", "driver1", "driver2"}},
		// ...but only by the bonus: 3 more minutes of waiting (x2) outweigh 4 minutes of bonus.
		{"tag does not outweigh a longer wait", eta(3, 3, 6), true, nil, []string{"driver1", "driver3", "driver2"}},
		// A car that is almost here beats the exact match despite the walk.
		{"short wait beats walking", eta(8, 1, 8), true, nil, []string{"driver2", "driver3", "driver1"}},
		// Weighting the walk more (a system setting, DD-20) makes the exact match win again.
		{"heavier walk weight flips it back", eta(8, 1, 8), true, func(p *matchParams) { p.WalkWeight = 6 }, []string{"driver3", "driver1", "driver2"}},
		// The wait limit is a hard cut: driver3 at 11 minutes is out however good its tag is.
		{"over the wait limit is excluded", eta(3, 3, 11), true, nil, []string{"driver1", "driver2"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := seedRanking(t, tx, c.eta, c.prefer, c.mutate); !sameNames(got, c.want) {
				t.Errorf("order = %v, want %v", got, c.want)
			}
		})
	}
}
