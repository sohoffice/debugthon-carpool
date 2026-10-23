package server

import (
	"math"
	"net/http"
	"testing"
	"time"
)

// simToday is today's simulated statistics per pickup point before now (DD-40 step 4).
func simToday(t *testing.T, e *supplyEnv, today string, now time.Time) (passengers, rides int64) {
	t.Helper()
	if err := e.tx.QueryRow(t.Context(), `
		SELECT COALESCE(sum(passenger_count), 0), COALESCE(sum(ride_count), 0) FROM supply_demand_stats
		 WHERE (slot_start AT TIME ZONE 'Asia/Taipei')::date = $1::date AND slot_start <= $2`, today, now).
		Scan(&passengers, &rides); err != nil {
		t.Fatal(err)
	}
	return passengers, rides
}

// REQ-080, DD-40: with only simulated data, today is the simulated statistics before now: rides
// completed, requests = passengers, no car = passengers - rides, the share matched, and the car
// trips saved labelled as an estimate; each pickup point's rides add up to the total.
func TestCityTodayFromSimulatedStatistics(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	// A day without real requests: the shared database keeps those of Karate and Demo runs.
	real := taipeiTime(t, "2027-03-10 18:00")
	if n := queryInt(t, e.tx, `SELECT count(*) FROM ride_requests WHERE created_at >= '2027-03-10 00:00+08' AND created_at < '2027-03-11 00:00+08'`); n != 0 {
		t.Fatalf("%d real requests on 2027-03-10", n)
	}
	regenerateAt(t, e.tx, real)
	a := newCityApp(t, e.tx, real)
	got := cityGet[cityTodayResp](a, "/api/city/today")
	passengers, rides := simToday(t, e, "2027-03-10", taipeiTime(t, "2027-03-10 08:15"))
	if got.Completed != int(rides) || got.Requests != int(passengers) || got.Matched != int(rides) ||
		got.NoMatch != int(passengers-rides) {
		t.Errorf("today %+v, want rides %d of %d passengers", got, rides, passengers)
	}
	if got.MatchRate == nil || math.Abs(*got.MatchRate-float64(rides)/float64(passengers)) > 1e-9 {
		t.Errorf("match rate %v, want %d/%d", got.MatchRate, rides, passengers)
	}
	if got.TripsSaved != got.Completed || !got.TripsSavedEstimate || !got.Simulated {
		t.Errorf("trips saved %d estimate %v simulated %v, want %d, true, true", got.TripsSaved, got.TripsSavedEstimate, got.Simulated, got.Completed)
	}
	sum := 0
	for _, p := range got.PickupPoints {
		sum += p.Completed
		if p.Name == "" || p.Lat == 0 {
			t.Errorf("pickup point %+v without a name or position", p)
		}
	}
	if len(got.PickupPoints) != 3 || sum != got.Completed {
		t.Errorf("%d pickup points with %d rides, want 3 adding up to %d", len(got.PickupPoints), sum, got.Completed)
	}
}

// REQ-080, REQ-083, DD-40 step 4: under demo_clock 08:15, a ride done on site (whatever the real
// time) adds one to today's rides and to its pickup point's, and one to pickup-rides' 08:15 slot.
func TestCityTodayCountsTheDemoRideWithPickupRides(t *testing.T) {
	for _, sent := range []string{"06:10", "08:20", "17:45"} {
		t.Run(sent, func(t *testing.T) {
			e := newSupplyEnv(t)
			setDemoClock(t, e.tx, 495)
			real := taipeiTime(t, "2026-10-22 18:00")
			regenerateAt(t, e.tx, real)
			a := newCityApp(t, e.tx, real) // no live query: no simulated arrivals in today
			before := cityGet[cityTodayResp](a, "/api/city/today")
			rideBefore := todayCell(getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30"), "08:15")

			completeRealRide(t, e, taipeiTime(t, "2026-10-22 "+sent))
			after := cityGet[cityTodayResp](a, "/api/city/today")
			if after.Completed != before.Completed+1 || after.completedAt(e.pickupID) != before.completedAt(e.pickupID)+1 {
				t.Errorf("rides %d -> %d, at the pickup %d -> %d; want both +1",
					before.Completed, after.Completed, before.completedAt(e.pickupID), after.completedAt(e.pickupID))
			}
			if after.Requests != before.Requests+1 || after.Matched != before.Matched+1 || after.NoMatch != before.NoMatch {
				t.Errorf("requests %d -> %d, matched %d -> %d, no car %d -> %d; want +1, +1, unchanged",
					before.Requests, after.Requests, before.Matched, after.Matched, before.NoMatch, after.NoMatch)
			}
			if got := todayCell(getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30"), "08:15"); got != rideBefore+1 {
				t.Errorf("pickup-rides 08:15 %d -> %d, want +1", rideBefore, got)
			}
		})
	}
}

// DD-40 step 4: without demo_clock, a ride whose request was sent outside the commute window counts
// for the day's total and its pickup point's rides, though no slot holds it.
func TestCityTodayRealClockCountsRideOutsideTheWindow(t *testing.T) {
	e := newSupplyEnv(t)
	removeDemoClock(t, e.tx)
	real := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, e.tx, real)
	a := newCityApp(t, e.tx, real)
	before := cityGet[cityTodayResp](a, "/api/city/today")
	completeRealRide(t, e, taipeiTime(t, "2026-10-22 17:30"))
	after := cityGet[cityTodayResp](a, "/api/city/today")
	if after.Completed != before.Completed+1 || after.completedAt(e.pickupID) != before.completedAt(e.pickupID)+1 {
		t.Errorf("rides %d -> %d, at the pickup %d -> %d; want both +1",
			before.Completed, after.Completed, before.completedAt(e.pickupID), after.completedAt(e.pickupID))
	}
}

// REQ-080, DD-40: today's real requests follow their status: no_match is no car; confirmed and
// boarded are matched and not no car while unfinished; waiting is a request sent, neither matched
// nor no car; a request rejected at submission (REQ-034) is not counted.
func TestCityTodayRealRequestsByStatus(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	real := time.Now()
	regenerateAt(t, e.tx, real)
	a := newCityApp(t, e.tx, real)
	base := cityGet[cityTodayResp](a, "/api/city/today")
	diff := func(stage string, requests, matched, noMatch, completed int) {
		t.Helper()
		got := cityGet[cityTodayResp](a, "/api/city/today")
		if d := (todayCounts{got.Requests - base.Requests, got.Matched - base.Matched, got.NoMatch - base.NoMatch,
			got.Completed - base.Completed, false}); d != (todayCounts{requests, matched, noMatch, completed, false}) {
			t.Errorf("%s: change %+v, want requests %d matched %d no car %d rides %d", stage, d, requests, matched, noMatch, completed)
		}
		if got.MatchRate != nil && *got.MatchRate > 1 {
			t.Errorf("%s: match rate %v over 100%%", stage, *got.MatchRate)
		}
	}

	// rejected: too far from the pickup point (REQ-034)
	far := e.submit(t, offsetM(e.pickup, 5000), nil)
	if far.Status != reqRejected {
		t.Fatalf("far request %s, want rejected", far.Status)
	}
	diff("rejected", 0, 0, 0, 0)

	// no car on the road: no_match
	if r := e.submit(t, e.near(), nil); r.Status != reqNoMatch {
		t.Fatalf("request %s, want no_match", r.Status)
	}
	diff("no match", 1, 0, 1, 0)

	trip := e.addTrip(t, tripSpec{})
	driver := e.driverToken(t, trip)
	_, token := newUser(t, e.tx, rolePassenger)
	r := e.submitAs(t, token, e.body(e.near(), ""))
	assigned(t, r, trip)
	diff("waiting for the driver", 2, 0, 1, 0)
	e.answer(t, "accept", r.ID, driver, http.StatusOK)
	diff("confirmed", 2, 1, 1, 0)
	e.do(t, http.MethodPost, "/api/passenger/requests/"+itoa(r.ID)+"/board", token, http.StatusOK)
	diff("boarded", 2, 1, 1, 0)
	e.do(t, http.MethodPost, "/api/passenger/requests/"+itoa(r.ID)+"/complete", token, http.StatusOK)
	diff("completed", 2, 1, 1, 1)
}

// REQ-080, REQ-083, DD-40 step 5: as simulated cars arrive, today's rides and requests sent grow by
// their passengers, each matched, and the match rate stays within 100%; after the round, the
// simulation adds nothing more. /today alone does not start a round.
func TestCityTodayAddsArrivedSimulatedPassengers(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, tx, start)
	a := newCityApp(t, tx, start)
	base := cityGet[cityTodayResp](a, "/api/city/today")
	a.clock = start.Add(10 * time.Minute)
	if got := cityGet[cityTodayResp](a, "/api/city/today"); got.Completed != base.Completed {
		t.Fatalf("today changed without a live query: %d -> %d", base.Completed, got.Completed)
	}

	a.clock = start
	cityGet[cityLiveResp](a, "/api/city/live") // starts the round
	if got := cityGet[cityTodayResp](a, "/api/city/today"); got.Completed != base.Completed {
		t.Errorf("rides grew to %d at the round's first query, want %d", got.Completed, base.Completed)
	}
	plan := liveSimPlan(simDay(t, "2026-10-22"), liveSimRoutes)
	var prev cityTodayResp = base
	for _, after := range []time.Duration{5 * time.Minute, 15 * time.Minute, time.Hour} {
		a.clock = start.Add(after)
		got := cityGet[cityTodayResp](a, "/api/city/today")
		arrived := simArrived(liveSimAt(plan, after))
		if got.Completed != base.Completed+arrived || got.Requests != base.Requests+arrived ||
			got.Matched != base.Matched+arrived || got.NoMatch != base.NoMatch {
			t.Errorf("after %v: %+v, want %d arrived passengers added to %+v", after, got, arrived, base)
		}
		if got.Completed < prev.Completed {
			t.Errorf("after %v rides went down", after)
		}
		if got.MatchRate == nil || *got.MatchRate > 1 {
			t.Errorf("after %v match rate %v", after, got.MatchRate)
		}
		sum := 0
		for _, p := range got.PickupPoints {
			sum += p.Completed
		}
		if sum != got.Completed {
			t.Errorf("after %v pickup points add up to %d, total %d", after, sum, got.Completed)
		}
		prev = got
	}
	a.clock = start.Add(3 * time.Hour)
	if got := cityGet[cityTodayResp](a, "/api/city/today"); got.Completed != prev.Completed {
		t.Errorf("after the round rides grew %d -> %d", prev.Completed, got.Completed)
	}
}

// REQ-083, DD-40 step 5: the live simulation's arrived passengers count on the dashboard only:
// on the same backend, /api/city/today grows with them while every pickup point's pickup-rides
// today, for drivers and passengers, stays as it was.
func TestCityLiveArrivalsStayOutOfPickupRides(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, tx, start)
	a := newCityApp(t, tx, start)
	points, err := (&Server{db: tx}).cityPickupPoints(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	pickupToday := func(token string) map[int64]rideDayResp {
		t.Helper()
		out := map[int64]rideDayResp{}
		for _, p := range points {
			w := a.do(http.MethodGet, pickupRidesPath(p.ID, "07:00", "10:00"), token)
			wantStatus(t, w, http.StatusOK, "")
			out[p.ID] = decode[pickupRidesResp](t, w).Today
		}
		return out
	}
	tokens := []string{"driver:driver1", "passenger:passenger1"}
	before := map[string]map[int64]rideDayResp{}
	for _, token := range tokens {
		before[token] = pickupToday(token)
	}
	base := cityGet[cityTodayResp](a, "/api/city/today")

	cityGet[cityLiveResp](a, "/api/city/live") // starts the round
	plan := liveSimPlan(simDay(t, "2026-10-22"), liveSimRoutes)
	after := 15 * time.Minute
	arrived := simArrived(liveSimAt(plan, after))
	if arrived == 0 {
		t.Fatalf("nobody arrived after %v", after)
	}
	a.clock = start.Add(after)
	if got := cityGet[cityTodayResp](a, "/api/city/today"); got.Completed != base.Completed+arrived {
		t.Errorf("city today %d, want %d + %d arrived", got.Completed, base.Completed, arrived)
	}
	for _, token := range tokens {
		if got := pickupToday(token); !jsonEqual(t, got, before[token]) {
			t.Errorf("%s: pickup-rides today changed with the simulated arrivals", token)
		}
	}
}

// REQ-080, REQ-082, REQ-083, DD-41: on Saturday 10/24 the history is 10/12-10/23, the days and the
// weather those of /api/commute/traffic; each day's rides are the pickup points' rides added up,
// and its no car (passengers - rides) never negative; each pickup point's numbers per day are the
// 10 days' sums over 10, to one decimal.
func TestCityHistoryDaysAndPickupAverages(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)
	a := newCityApp(t, tx, sat)
	got := cityGet[cityHistoryResp](a, "/api/city/history")
	traffic := getTraffic(t, tx, sat)
	if len(got.Days) != 10 || got.Days[0].Date != "2026-10-23" || got.Days[9].Date != "2026-10-12" || !got.Simulated {
		t.Fatalf("days %d from %s to %s, want 10 from 10/23 to 10/12", len(got.Days), got.Days[0].Date, got.Days[len(got.Days)-1].Date)
	}
	for i, d := range got.Days {
		td := traffic.Days[i]
		if d.Date != td.Date || d.Weekday != td.Weekday {
			t.Errorf("day %d: %s (%d), traffic %s (%d)", i, d.Date, d.Weekday, td.Date, td.Weekday)
		}
		// the day's weather is the rainiest slot's, from the same traffic rows (DD-38)
		var want *commuteWeather
		for _, s := range td.Slots {
			if want == nil || s.Weather.Precipitation > want.Precipitation {
				w := s.Weather
				want = &w
			}
		}
		if d.Weather == nil || want == nil || *d.Weather != *want {
			t.Errorf("%s: weather %+v, traffic's rainiest slot %+v", d.Date, d.Weather, want)
		}
		var rides, passengers int64
		if err := tx.QueryRow(t.Context(), `SELECT sum(ride_count), sum(passenger_count) FROM supply_demand_stats
		     WHERE (slot_start AT TIME ZONE 'Asia/Taipei')::date = $1::date`, d.Date).Scan(&rides, &passengers); err != nil {
			t.Fatal(err)
		}
		if int64(d.Rides) != rides || passengers < rides {
			t.Errorf("%s: rides %d, pickup points add up to %d of %d passengers", d.Date, d.Rides, rides, passengers)
		}
	}
	if len(got.PickupPoints) != 3 {
		t.Fatalf("%d pickup points, want 3", len(got.PickupPoints))
	}
	for _, p := range got.PickupPoints {
		var drivers, passengers, rides float64
		if err := tx.QueryRow(t.Context(), `
			SELECT sum(driver_count), sum(passenger_count), sum(ride_count) FROM supply_demand_stats
			 WHERE pickup_point_id = $1 AND slot_start >= '2026-10-12 00:00+08' AND slot_start < '2026-10-24 00:00+08'`, p.ID).
			Scan(&drivers, &passengers, &rides); err != nil {
			t.Fatal(err)
		}
		round1 := func(v float64) float64 { return math.Round(v/10*10) / 10 }
		if p.DriversPerDay != round1(drivers) || p.PassengersPerDay != round1(passengers) || p.RidesPerDay != round1(rides) {
			t.Errorf("%s: per day %v/%v/%v, want the 10-day sums %v/%v/%v over 10 to one decimal",
				p.Name, p.DriversPerDay, p.PassengersPerDay, p.RidesPerDay, drivers, passengers, rides)
		}
	}
}

// REQ-080: today's real rides do not change the history.
func TestCityHistoryLeavesTodayOut(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	real := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, e.tx, real)
	a := newCityApp(t, e.tx, real)
	before := cityGet[cityHistoryResp](a, "/api/city/history")
	completeRealRide(t, e, real)
	if after := cityGet[cityHistoryResp](a, "/api/city/history"); !jsonEqual(t, after, before) {
		t.Error("a ride today changed the history")
	}
}

// REQ-063, DD-36: each day's traffic source is that day's ?date= simulated: 10/12-10/22 are TDX
// measured (false), 10/23 has no measured data (true); the rides' simulated flag stays apart.
func TestCityHistoryTrafficSimulated(t *testing.T) {
	a := demoMonday(t)
	got := cityGet[cityHistoryResp](a, "/api/city/history")
	if len(got.Days) != 10 {
		t.Fatalf("%d days, want 10", len(got.Days))
	}
	for _, d := range got.Days {
		day := cityGet[cityTrafficDayResp](a, slotQuery("/api/city/traffic", "date", d.Date))
		if d.TrafficSimulated != day.Simulated {
			t.Errorf("%s: traffic simulated %v, ?date= says %v", d.Date, d.TrafficSimulated, day.Simulated)
		}
		if want := d.Date == "2026-10-23"; d.TrafficSimulated != want {
			t.Errorf("%s: traffic simulated %v, want %v", d.Date, d.TrafficSimulated, want)
		}
		if !d.Simulated {
			t.Errorf("%s: rides simulated false, want the simulated statistics", d.Date)
		}
	}
}
