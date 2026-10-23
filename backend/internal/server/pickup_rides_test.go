package server

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type rideSlotResp struct {
	SlotStart time.Time       `json:"slot_start"`
	RideCount int64           `json:"ride_count"`
	Weather   *commuteWeather `json:"weather"`
	Simulated bool            `json:"simulated"`
}

type rideDayResp struct {
	Date    string         `json:"date"`
	Weekday int            `json:"weekday"`
	Slots   []rideSlotResp `json:"slots"`
}

type pickupRidesResp struct {
	Now           time.Time     `json:"now"`
	PickupPointID int64         `json:"pickup_point_id"`
	Days          []rideDayResp `json:"days"`
	Today         rideDayResp   `json:"today"`
	Summary       struct {
		From           string   `json:"from"`
		To             string   `json:"to"`
		DailyAvg       float64  `json:"daily_avg"`
		Weekday        int      `json:"weekday"`
		SameWeekdayAvg *float64 `json:"same_weekday_avg"`
	} `json:"summary"`
	Simulated bool `json:"simulated"`
}

func pickupRidesPath(pickupID int64, from, to string) string {
	return "/api/commute/pickup-rides?pickup_point_id=" + itoa(pickupID) + "&from=" + from + "&to=" + to
}

func getPickupRides(t *testing.T, tx pgx.Tx, realNow time.Time, pickupID int64, from, to string) pickupRidesResp {
	t.Helper()
	w := callAt(t, tx, realNow, pickupRidesPath(pickupID, from, to), "passenger:passenger1")
	wantStatus(t, w, http.StatusOK, "")
	return decode[pickupRidesResp](t, w)
}

// todayCell is today's ride count in the slot starting at hhmm, or -1 when today has no such slot.
func todayCell(r pickupRidesResp, hhmm string) int64 {
	for _, s := range r.Today.Slots {
		if s.SlotStart.In(taipei).Format("15:04") == hhmm {
			return s.RideCount
		}
	}
	return -1
}

func slotTimes(d rideDayResp) []string {
	out := []string{}
	for _, s := range d.Slots {
		out = append(out, s.SlotStart.In(taipei).Format("15:04"))
	}
	return out
}

var commuteSlotTimes = []string{"07:00", "07:15", "07:30", "07:45", "08:00", "08:15",
	"08:30", "08:45", "09:00", "09:15", "09:30", "09:45"}

// completeRealRide completes one ride at e's pickup point through the request flow and moves its
// request's sending time to sentAt (the database stamps the real time; tests pin it).
func completeRealRide(t *testing.T, e *supplyEnv, sentAt time.Time) {
	t.Helper()
	_, _, id := e.confirmedRide(t)
	e.passengerAct(t, "complete", id, e.token, http.StatusOK)
	mustExec(t, e.tx, `UPDATE ride_requests SET created_at = $1 WHERE id = $2`, sentAt, id)
}

// REQ-056, REQ-084: on Saturday 10/24 with demo_clock 08:15, the past 10 workdays 10/12-10/23, each
// with its weekday and the 12 commute slots; today is Monday 10/26 from 07:00 through 08:15.
func TestPickupRidesPastWorkdaysAndToday(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)
	pickupID := firstPickupID(t, tx)

	r := getPickupRides(t, tx, sat, pickupID, "07:45", "08:45")
	wantDates := []string{"2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19",
		"2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"}
	var got []string
	for _, d := range r.Days {
		got = append(got, d.Date)
		day, _ := time.ParseInLocation(dateLayout, d.Date, taipei)
		if d.Weekday != int(day.Weekday()) {
			t.Errorf("%s weekday = %d, want %d", d.Date, d.Weekday, day.Weekday())
		}
		if !reflect.DeepEqual(slotTimes(d), commuteSlotTimes) {
			t.Errorf("%s slots = %v, want 07:00-09:45", d.Date, slotTimes(d))
		}
		for _, s := range d.Slots {
			if s.Weather == nil || !s.Simulated || s.RideCount < 0 {
				t.Errorf("%s %v: weather %v, simulated %v, rides %d", d.Date, s.SlotStart, s.Weather, s.Simulated, s.RideCount)
			}
		}
	}
	if !reflect.DeepEqual(got, wantDates) {
		t.Fatalf("dates = %v, want %v", got, wantDates)
	}
	if r.Today.Date != "2026-10-26" || r.Today.Weekday != 1 || r.PickupPointID != pickupID {
		t.Errorf("today = %s weekday %d, pickup %d", r.Today.Date, r.Today.Weekday, r.PickupPointID)
	}
	if want := []string{"07:00", "07:15", "07:30", "07:45", "08:00", "08:15"}; !reflect.DeepEqual(slotTimes(r.Today), want) {
		t.Errorf("today's slots = %v, want %v", slotTimes(r.Today), want)
	}
	// The slot holding now is not simulated nor observed yet: no weather until it ends.
	if cur := r.Today.Slots[5]; cur.Simulated || cur.Weather != nil {
		t.Errorf("08:15 slot = %+v, want not simulated and no weather", cur)
	}
	if !r.Simulated {
		t.Error("simulated = false, want true (REQ-063)")
	}
}

// REQ-056, REQ-083: every day's slot carries the same weather as /api/commute/traffic.
func TestPickupRidesWeatherMatchesTraffic(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	real := taipeiTime(t, "2026-10-22 15:00")
	regenerateAt(t, tx, real)
	traffic := map[time.Time]commuteWeather{}
	for _, d := range getTraffic(t, tx, real).Days {
		for _, s := range d.Slots {
			traffic[s.SlotStart.UTC()] = s.Weather
		}
	}
	rows, err := tx.Query(context.Background(), `SELECT id FROM pickup_points ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		t.Fatal(err)
	}
	compared := 0
	for _, id := range ids {
		for _, d := range getPickupRides(t, tx, real, id, "07:00", "10:00").Days {
			for _, s := range d.Slots {
				want, ok := traffic[s.SlotStart.UTC()]
				if !ok || s.Weather == nil || *s.Weather != want {
					t.Errorf("pickup %d %v: weather %+v, traffic %+v", id, s.SlotStart, s.Weather, want)
				}
				compared++
			}
		}
	}
	if compared != len(ids)*10*12 {
		t.Errorf("compared %d slots, want %d", compared, len(ids)*10*12)
	}
}

// REQ-083, DD-37, DD-40: across many days, every cell's rides stay within its passengers and the
// drivers' seats; every traffic slot with weather (the past 10 workdays and today, measured or
// simulated) has a cell at every pickup point and no other.
func TestPickupStatsRidesWithinPassengersAndSeats(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-01 12:00")
	for i := 0; i < 20; i++ {
		day := start.AddDate(0, 0, i)
		regenerateAt(t, tx, day)
		label := day.Format(dateLayout)
		if n := queryInt(t, tx, `SELECT count(*) FROM supply_demand_stats WHERE ride_count > passenger_count`); n != 0 {
			t.Errorf("%s: %d cells with more rides than passengers", label, n)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM supply_demand_stats WHERE ride_count > driver_count * 2`); n != 0 {
			t.Errorf("%s: %d cells with more rides than the drivers' seats", label, n)
		}
		if n := queryInt(t, tx, `SELECT count(*) FROM supply_demand_stats WHERE NOT simulated`); n != 0 {
			t.Errorf("%s: %d cells not simulated", label, n)
		}
		want := queryInt(t, tx, `SELECT count(DISTINCT slot_start) * (SELECT count(*) FROM pickup_points) FROM traffic_observations
		                         WHERE weather IS NOT NULL`)
		same := queryInt(t, tx, `
			SELECT count(*) FROM supply_demand_stats st
			 WHERE EXISTS (SELECT 1 FROM traffic_observations o WHERE o.slot_start = st.slot_start AND o.weather IS NOT NULL)`)
		if all := queryInt(t, tx, `SELECT count(*) FROM supply_demand_stats`); all != want || same != want {
			t.Errorf("%s: %d cells, %d on traffic slots, want %d", label, all, same, want)
		}
	}
	// The table refuses more rides than passengers, whatever writes it (DD-37).
	_, err := tx.Exec(context.Background(), `SAVEPOINT over`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(), `
		INSERT INTO supply_demand_stats VALUES ((SELECT min(id) FROM pickup_points), '2000-01-03 07:00+08', 1, 1, 2, false)`); err == nil {
		t.Error("a cell with 2 rides and 1 passenger was accepted")
	}
	mustExec(t, tx, `ROLLBACK TO SAVEPOINT over`)
}

// DD-40 step 3: across many days, Friday has more passengers than the other weekdays, and a rainy
// slot has more passengers than the same pickup point, weekday and time when dry.
func TestPickupStatsFollowWeekdayAndWeather(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	start := taipeiTime(t, "2026-10-01 12:00")
	var fridayPassengers, otherPassengers, fridayDays, otherDays float64
	var wetMore, wetCompared float64
	for i := 0; i < 20; i++ {
		regenerateAt(t, tx, start.AddDate(0, 0, i))
		var f, o, fd, od float64
		if err := tx.QueryRow(context.Background(), `
			WITH d AS (SELECT (slot_start AT TIME ZONE 'Asia/Taipei')::date AS day, sum(passenger_count) AS p
			             FROM supply_demand_stats GROUP BY 1)
			SELECT COALESCE(sum(p) FILTER (WHERE extract(isodow FROM day) = 5), 0)::float8,
			       COALESCE(sum(p) FILTER (WHERE extract(isodow FROM day) <> 5), 0)::float8,
			       count(*) FILTER (WHERE extract(isodow FROM day) = 5)::float8,
			       count(*) FILTER (WHERE extract(isodow FROM day) <> 5)::float8
			  FROM d WHERE day < (SELECT max((slot_start AT TIME ZONE 'Asia/Taipei')::date) FROM supply_demand_stats)`).
			Scan(&f, &o, &fd, &od); err != nil {
			t.Fatal(err)
		}
		fridayPassengers, otherPassengers, fridayDays, otherDays = fridayPassengers+f, otherPassengers+o, fridayDays+fd, otherDays+od
		var more, n float64
		if err := tx.QueryRow(context.Background(), `
			WITH c AS (
			    SELECT st.pickup_point_id, st.passenger_count,
			           extract(isodow FROM st.slot_start AT TIME ZONE 'Asia/Taipei') AS dow,
			           (st.slot_start AT TIME ZONE 'Asia/Taipei')::time AS tod,
			           (SELECT (o.weather->>'precipitation')::numeric > 0 FROM traffic_observations o
			             WHERE o.slot_start = st.slot_start LIMIT 1) AS wet
			      FROM supply_demand_stats st),
			pairs AS (
			    SELECT w.passenger_count AS wet_p, avg(d.passenger_count) AS dry_p
			      FROM c w JOIN c d ON d.pickup_point_id = w.pickup_point_id AND d.dow = w.dow AND d.tod = w.tod
			     WHERE w.wet AND NOT d.wet GROUP BY w.pickup_point_id, w.dow, w.tod, w.passenger_count)
			SELECT count(*) FILTER (WHERE wet_p > dry_p)::float8, count(*)::float8 FROM pairs`).Scan(&more, &n); err != nil {
			t.Fatal(err)
		}
		wetMore, wetCompared = wetMore+more, wetCompared+n
	}
	if fridayPassengers/fridayDays <= otherPassengers/otherDays {
		t.Errorf("Friday %.1f passengers a day, not above the other weekdays' %.1f",
			fridayPassengers/fridayDays, otherPassengers/otherDays)
	}
	if wetCompared == 0 || wetMore/wetCompared < 0.75 {
		t.Errorf("rainy cells with more passengers than dry: %.0f of %.0f, want at least 75%%", wetMore, wetCompared)
	}
}

// REQ-056: the summary's daily average is the from-to rides per day over the 10 days, and the
// same-weekday average the same over the days on today's weekday; today is left out. Checks
// several windows, including the window's edges.
func TestPickupRidesSummaryAveragesTheDays(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	real := taipeiTime(t, "2026-10-22 15:00") // Thursday
	regenerateAt(t, tx, real)
	pickupID := firstPickupID(t, tx)
	for _, w := range [][2]string{{"07:45", "08:45"}, {"07:00", "10:00"}, {"09:45", "10:00"}, {"07:00", "07:15"}} {
		r := getPickupRides(t, tx, real, pickupID, w[0], w[1])
		from, _ := parseSlotTime(w[0])
		to, _ := parseSlotTime(w[1])
		var total, same, sameDays float64
		for _, d := range r.Days {
			for _, s := range d.Slots {
				m := s.SlotStart.In(taipei).Hour()*60 + s.SlotStart.In(taipei).Minute()
				if m >= from && m < to {
					total += float64(s.RideCount)
					if d.Weekday == 4 {
						same += float64(s.RideCount)
					}
				}
			}
			if d.Weekday == 4 {
				sameDays++
			}
		}
		if r.Summary.From != w[0] || r.Summary.To != w[1] || r.Summary.Weekday != 4 {
			t.Errorf("%v: summary = %+v", w, r.Summary)
		}
		if math.Abs(r.Summary.DailyAvg-total/10) > 1e-9 {
			t.Errorf("%v: daily_avg = %v, want %v", w, r.Summary.DailyAvg, total/10)
		}
		if sameDays != 2 || r.Summary.SameWeekdayAvg == nil || math.Abs(*r.Summary.SameWeekdayAvg-same/sameDays) > 1e-9 {
			t.Errorf("%v: same_weekday_avg = %v, want %v over %v days", w, r.Summary.SameWeekdayAvg, same/sameDays, sameDays)
		}
	}
}

// REQ-056, REQ-083, REQ-084, DD-41: with demo_clock 08:15, a ride completed at the pickup point
// today adds one to today's 08:15-08:30, whatever the real time it was sent; other slots and other
// pickup points are unchanged; a ride sent on another real day does not count.
func TestPickupRidesDemoClockCountsRealRideInNowSlot(t *testing.T) {
	for _, sent := range []string{"06:10", "08:20", "17:45"} {
		t.Run(sent, func(t *testing.T) {
			e := newSupplyEnv(t)
			setDemoClock(t, e.tx, 495)
			real := taipeiTime(t, "2026-10-22 18:00")
			regenerateAt(t, e.tx, real)
			other := queryInt(t, e.tx, `SELECT max(id) FROM pickup_points`)
			before := getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30")
			otherBefore := getPickupRides(t, e.tx, real, other, "08:00", "08:30")

			completeRealRide(t, e, taipeiTime(t, "2026-10-22 "+sent))
			after := getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30")
			if got, want := todayCell(after, "08:15"), todayCell(before, "08:15")+1; got != want {
				t.Errorf("today 08:15 = %d, want %d", got, want)
			}
			for _, hhmm := range []string{"07:00", "07:45", "08:00"} {
				if todayCell(after, hhmm) != todayCell(before, hhmm) {
					t.Errorf("today %s changed: %d -> %d", hhmm, todayCell(before, hhmm), todayCell(after, hhmm))
				}
			}
			if !reflect.DeepEqual(after.Days, before.Days) || !reflect.DeepEqual(after.Summary, before.Summary) {
				t.Error("the past days or the summary changed with today's ride")
			}
			if !reflect.DeepEqual(getPickupRides(t, e.tx, real, other, "08:00", "08:30").Today, otherBefore.Today) {
				t.Error("another pickup point's today changed")
			}
			// The next real day does not count today's ride.
			next := taipeiTime(t, "2026-10-23 18:00")
			regenerateAt(t, e.tx, next)
			fresh := getPickupRides(t, e.tx, next, e.pickupID, "08:00", "08:30")
			var simulated int64
			if err := e.tx.QueryRow(context.Background(), `SELECT COALESCE(sum(ride_count), 0) FROM supply_demand_stats
			     WHERE pickup_point_id = $1 AND slot_start = '2026-10-23 08:15+08'`, e.pickupID).Scan(&simulated); err != nil {
				t.Fatal(err)
			}
			if got := todayCell(fresh, "08:15"); got != simulated {
				t.Errorf("next day 08:15 = %d, want only the simulated %d", got, simulated)
			}
		})
	}
}

// REQ-084, DD-41: on Saturday 10/24 under demo_clock, today is Monday 10/26 and the rides done on
// 10/24 count in its 08:15 slot.
func TestPickupRidesDemoClockWeekendRideCountsForMonday(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	sat := taipeiTime(t, "2026-10-24 14:00")
	regenerateAt(t, e.tx, sat)
	before := getPickupRides(t, e.tx, sat, e.pickupID, "08:00", "08:30")
	completeRealRide(t, e, taipeiTime(t, "2026-10-24 13:50"))
	after := getPickupRides(t, e.tx, sat, e.pickupID, "08:00", "08:30")
	if after.Today.Date != "2026-10-26" || todayCell(after, "08:15") != todayCell(before, "08:15")+1 {
		t.Errorf("today %s 08:15 = %d, want 2026-10-26 and %d", after.Today.Date, todayCell(after, "08:15"), todayCell(before, "08:15")+1)
	}
}

// REQ-083, DD-40 step 4: without demo_clock, today's ride counts in the slot its request was sent
// in, the window's edges included; one sent outside 07:00-10:00 counts in no slot.
func TestPickupRidesRealClockCountsRideInSentSlot(t *testing.T) {
	for _, tc := range []struct{ sent, slot string }{
		{"06:59", ""},
		{"07:00", "07:00"},
		{"08:29", "08:15"},
		{"08:30", "08:30"},
		{"09:59", "09:45"},
		{"10:00", ""},
		{"17:10", ""},
	} {
		t.Run(tc.sent, func(t *testing.T) {
			e := newSupplyEnv(t)
			removeDemoClock(t, e.tx)
			real := taipeiTime(t, "2026-10-22 18:00") // all 12 of today's slots are past
			regenerateAt(t, e.tx, real)
			before := getPickupRides(t, e.tx, real, e.pickupID, "07:00", "10:00")
			completeRealRide(t, e, taipeiTime(t, "2026-10-22 "+tc.sent))
			after := getPickupRides(t, e.tx, real, e.pickupID, "07:00", "10:00")
			if !reflect.DeepEqual(slotTimes(after.Today), commuteSlotTimes) {
				t.Fatalf("today's slots = %v", slotTimes(after.Today))
			}
			for i, s := range after.Today.Slots {
				want := before.Today.Slots[i].RideCount
				if commuteSlotTimes[i] == tc.slot {
					want++
				}
				if s.RideCount != want {
					t.Errorf("today %s = %d, want %d", commuteSlotTimes[i], s.RideCount, want)
				}
			}
		})
	}
}

// DD-41: without demo_clock, today runs through the slot holding the real now: none before 07:00,
// the 08:15 slot at 08:20, and the request sent then counts there.
func TestPickupRidesRealClockTodayStopsAtNow(t *testing.T) {
	e := newSupplyEnv(t)
	removeDemoClock(t, e.tx)
	early := taipeiTime(t, "2026-10-22 06:30")
	regenerateAt(t, e.tx, early)
	if r := getPickupRides(t, e.tx, early, e.pickupID, "07:00", "08:00"); len(r.Today.Slots) != 0 {
		t.Errorf("at 06:30 today has slots %v, want none", slotTimes(r.Today))
	}
	now := taipeiTime(t, "2026-10-22 08:20")
	regenerateAt(t, e.tx, now)
	before := getPickupRides(t, e.tx, now, e.pickupID, "07:00", "08:00")
	completeRealRide(t, e, now)
	r := getPickupRides(t, e.tx, now, e.pickupID, "07:00", "08:00")
	if want := commuteSlotTimes[:6]; !reflect.DeepEqual(slotTimes(r.Today), want) {
		t.Errorf("at 08:20 today's slots = %v, want %v", slotTimes(r.Today), want)
	}
	if got := todayCell(r, "08:15"); got != todayCell(before, "08:15")+1 || got != 1 {
		t.Errorf("08:15 = %d, want the one real ride", got)
	}
}

// DD-37: each request is one ride, so a request reassigned before completing counts once.
func TestPickupRidesReassignedRequestCountsOnce(t *testing.T) {
	e := newSupplyEnv(t)
	setDemoClock(t, e.tx, 495)
	real := taipeiTime(t, "2026-10-22 18:00")
	regenerateAt(t, e.tx, real)
	before := getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30")
	first := e.addTrip(t, tripSpec{northM: 500})
	second := e.addTrip(t, tripSpec{northM: 2000})
	r := e.submit(t, e.near(), nil)
	assigned(t, r, first)
	e.answer(t, "decline", r.ID, e.driverToken(t, first), http.StatusOK)
	e.answer(t, "accept", r.ID, e.driverToken(t, second), http.StatusOK)
	e.passengerAct(t, "complete", r.ID, e.token, http.StatusOK)
	// The database stamps the real time; pin it to the pinned day, as completeRealRide does.
	mustExec(t, e.tx, `UPDATE ride_requests SET created_at = $1 WHERE id = $2`, taipeiTime(t, "2026-10-22 08:20"), r.ID)
	after := getPickupRides(t, e.tx, real, e.pickupID, "08:00", "08:30")
	if got := todayCell(after, "08:15"); got != todayCell(before, "08:15")+1 {
		t.Errorf("08:15 = %d, want %d", got, todayCell(before, "08:15")+1)
	}
}

// REQ-056, DD-37: drivers and passengers get rides only, never driver or passenger counts; the
// response is flagged as simulated (REQ-063).
func TestPickupRidesHidesDriverAndPassengerCounts(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	real := taipeiTime(t, "2026-10-22 15:00")
	regenerateAt(t, tx, real)
	w := callAt(t, tx, real, pickupRidesPath(firstPickupID(t, tx), "07:45", "08:45"), "driver:driver1")
	wantStatus(t, w, http.StatusOK, "")
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if raw["simulated"] != true {
		t.Errorf("simulated = %v, want true", raw["simulated"])
	}
	var walk func(v any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, val := range x {
				if k == "driver_count" || k == "passenger_count" || k == "drivers" || k == "passengers" {
					t.Errorf("response has %q", k)
				}
				walk(val)
			}
		case []any:
			for _, val := range x {
				walk(val)
			}
		}
	}
	walk(raw)
}

// REQ-056: pickup_point_id, from and to are checked; an unknown pickup point is not found.
func TestPickupRidesValidation(t *testing.T) {
	tx := testTx(t)
	id := itoa(firstPickupID(t, tx))
	now := time.Now()
	for _, q := range []string{
		"from=07:45&to=08:45",
		"pickup_point_id=abc&from=07:45&to=08:45",
		"pickup_point_id=" + id,
		"pickup_point_id=" + id + "&from=07:45",
		"pickup_point_id=" + id + "&to=08:45",
		"pickup_point_id=" + id + "&from=08:45&to=07:45", // from after to
		"pickup_point_id=" + id + "&from=08:00&to=08:00", // empty window
		"pickup_point_id=" + id + "&from=06:45&to=08:00", // before the window
		"pickup_point_id=" + id + "&from=09:45&to=10:15", // after the window
		"pickup_point_id=" + id + "&from=07:50&to=08:30", // not on a 15-minute boundary
		"pickup_point_id=" + id + "&from=7:45&to=08:30",
		"pickup_point_id=" + id + "&from=07:45:00&to=08:30",
		"pickup_point_id=" + id + "&from=0745&to=0830",
	} {
		wantStatus(t, callAt(t, tx, now, "/api/commute/pickup-rides?"+q, "passenger:passenger1"), http.StatusBadRequest, "invalid_request")
	}
	missing := itoa(queryInt(t, tx, `SELECT max(id) + 1000 FROM pickup_points`))
	wantStatus(t, callAt(t, tx, now, "/api/commute/pickup-rides?pickup_point_id="+missing+"&from=07:45&to=08:45", "passenger:passenger1"),
		http.StatusNotFound, "not_found")
	// The edges of the window are accepted.
	wantStatus(t, callAt(t, tx, now, "/api/commute/pickup-rides?pickup_point_id="+id+"&from=07:00&to=10:00", "passenger:passenger1"),
		http.StatusOK, "")
}

// REQ-056: both roles can read; an account without the token's role and no token are refused.
func TestPickupRidesAuth(t *testing.T) {
	tx := testTx(t)
	path := pickupRidesPath(firstPickupID(t, tx), "07:45", "08:45")
	now := time.Now()
	for _, token := range []string{"driver:driver1", "passenger:passenger1"} {
		wantStatus(t, callAt(t, tx, now, path, token), http.StatusOK, "")
	}
	wantStatus(t, callAt(t, tx, now, path, "driver:passenger1"), http.StatusForbidden, "forbidden")
	wantStatus(t, callAt(t, tx, now, path, ""), http.StatusUnauthorized, "unauthorized")
}

// DD-29, DD-40: the Demo reset regenerates the pickup statistics with the traffic, for today.
func TestDemoResetRegeneratesPickupStats(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	mustExec(t, tx, `DELETE FROM supply_demand_stats`)
	if err := resetDemoData(context.Background(), tx, taipeiTime(t, "2026-10-24 10:00")); err != nil {
		t.Fatal(err)
	}
	if n := queryInt(t, tx, `SELECT count(DISTINCT (slot_start AT TIME ZONE 'Asia/Taipei')::date) FROM supply_demand_stats`); n != 11 {
		t.Errorf("after the reset %d days of statistics, want 10 past workdays and today", n)
	}
	if n := queryInt(t, tx, `SELECT count(DISTINCT slot_start) FROM supply_demand_stats WHERE slot_start >= '2026-10-26 00:00+08'`); n != 5 {
		t.Errorf("after the reset today has %d slots, want 5 (07:00-08:00)", n)
	}
}

// DD-40: the same today gives the same statistics, so rehearsals and the Demo match.
func TestPickupStatsSeededByToday(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	stats := func() string {
		var s string
		if err := tx.QueryRow(context.Background(), `
			SELECT md5(string_agg(concat_ws('|', pickup_point_id, slot_start, driver_count, passenger_count, ride_count), ','
			                      ORDER BY pickup_point_id, slot_start)) FROM supply_demand_stats`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	regenerateAt(t, tx, taipeiTime(t, "2026-10-24 09:00"))
	sat := stats()
	regenerateAt(t, tx, taipeiTime(t, "2026-10-25 20:00"))
	if stats() != sat {
		t.Error("10/24 and 10/25 generated different statistics")
	}
}
