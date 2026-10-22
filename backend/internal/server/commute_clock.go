package server

import (
	"context"
	"time"
)

// taipei is the park's time zone; Taiwan has no daylight saving, so a fixed offset is exact.
var taipei = time.FixedZone("Asia/Taipei", 8*60*60)

// commuteMoment is "now" for Phase 2 data (DD-41): commute, city dashboard and pickup statistics.
type commuteMoment struct {
	Now   time.Time // today at demo_clock, or the real time when demo_clock is not set
	Today time.Time // midnight of Now's Taipei date
}

// commuteNow is the one place Phase 2 reads "now" (REQ-084, DD-41). The SQL function
// commute_now applies demo_clock, so the generator and the API agree; realNow is the real clock,
// passed in so tests can pin it. Matching, trips, requests and timeouts do not use this.
func commuteNow(ctx context.Context, db DB, realNow time.Time) (commuteMoment, error) {
	var m commuteMoment
	if err := db.QueryRow(ctx, `SELECT commute_now($1)`, realNow).Scan(&m.Now); err != nil {
		return commuteMoment{}, err
	}
	m.Now = m.Now.In(taipei)
	y, mo, d := m.Now.Date()
	m.Today = time.Date(y, mo, d, 0, 0, 0, 0, taipei)
	return m, nil
}

// regenerateCommuteSimulation replaces the simulated traffic and weather with the data for the
// commute day of realNow (DD-40, DD-41).
func regenerateCommuteSimulation(ctx context.Context, db DB, realNow time.Time) error {
	_, err := db.Exec(ctx, `SELECT generate_commute_simulation(commute_now($1))`, realNow)
	return err
}
