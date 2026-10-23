package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// taipeiTime parses "2006-01-02 15:04" as Taipei time.
func taipeiTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.ParseInLocation("2006-01-02 15:04", s, taipei)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// callAt sends a GET as token with the real clock pinned to realNow.
func callAt(t *testing.T, db DB, realNow time.Time, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	deps := testDeps(t)
	deps.Clock = func() time.Time { return realNow }
	w := httptest.NewRecorder()
	NewRouter(db, deps).ServeHTTP(w, req)
	return w
}

func setDemoClock(t *testing.T, tx pgx.Tx, minutes int) {
	t.Helper()
	mustExec(t, tx, `UPDATE system_settings SET value = $1 WHERE key = 'demo_clock'`, minutes)
}

func removeDemoClock(t *testing.T, tx pgx.Tx) {
	t.Helper()
	mustExec(t, tx, `DELETE FROM system_settings WHERE key = 'demo_clock'`)
}

// regenerateAt rebuilds the simulated data as if the Demo were reset at realNow (DD-29, DD-40).
func regenerateAt(t *testing.T, tx pgx.Tx, realNow time.Time) {
	t.Helper()
	if err := regenerateCommuteSimulation(context.Background(), tx, realNow); err != nil {
		t.Fatal(err)
	}
}

type commuteWeather struct {
	StationID      string  `json:"station_id"`
	StationName    string  `json:"station_name"`
	ObsTime        string  `json:"obs_time"`
	Weather        string  `json:"weather"`
	AirTemperature float64 `json:"air_temperature"`
	Precipitation  float64 `json:"precipitation"`
}

type trafficResp struct {
	Now   time.Time `json:"now"`
	Today string    `json:"today"`
	Days  []struct {
		Date    string `json:"date"`
		Weekday int    `json:"weekday"`
		Slots   []struct {
			SlotStart        time.Time      `json:"slot_start"`
			Volume           int64          `json:"volume"`
			AvgSpeedKmh      *float64       `json:"avg_speed_kmh"`
			Weather          commuteWeather `json:"weather"`
			Simulated        bool           `json:"simulated"`
			WeatherSimulated bool           `json:"weather_simulated"`
		} `json:"slots"`
	} `json:"days"`
	Simulated        bool `json:"simulated"`
	WeatherSimulated bool `json:"weather_simulated"`
}

type weatherResp struct {
	Now              time.Time       `json:"now"`
	Today            string          `json:"today"`
	Weather          *commuteWeather `json:"weather"`
	WeatherSimulated bool            `json:"weather_simulated"`
}

func getTraffic(t *testing.T, tx pgx.Tx, realNow time.Time) trafficResp {
	t.Helper()
	w := callAt(t, tx, realNow, "/api/commute/traffic", "passenger:passenger1")
	wantStatus(t, w, http.StatusOK, "")
	return decode[trafficResp](t, w)
}

func getWeather(t *testing.T, tx pgx.Tx, realNow time.Time) weatherResp {
	t.Helper()
	w := callAt(t, tx, realNow, "/api/commute/weather", "driver:driver1")
	wantStatus(t, w, http.StatusOK, "")
	return decode[weatherResp](t, w)
}

func dates(r trafficResp) []string {
	var out []string
	for _, d := range r.Days {
		out = append(out, d.Date)
	}
	return out
}

// todaySlots lists today's simulated slot starts as Taipei "15:04".
func todaySlots(t *testing.T, tx pgx.Tx, today string) []string {
	t.Helper()
	rows, err := tx.Query(context.Background(), `
		SELECT DISTINCT to_char(slot_start AT TIME ZONE 'Asia/Taipei', 'HH24:MI') FROM traffic_observations
		 WHERE (slot_start AT TIME ZONE 'Asia/Taipei')::date = $1::date ORDER BY 1`, today)
	if err != nil {
		t.Fatal(err)
	}
	slots, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return slots
}

// REQ-084, DD-41: with demo_clock, now is today at that minute and a weekend day becomes the
// next Monday; without it, the real time.
func TestCommuteNow(t *testing.T) {
	tx := testTx(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name, real, wantNow string
		clock               int // minutes; -1 removes demo_clock
	}{
		{"weekday afternoon uses 08:15 today", "2026-10-22 15:30", "2026-10-22 08:15", 495},
		{"before 08:15 still 08:15 today", "2026-10-23 06:00", "2026-10-23 08:15", 495},
		{"Saturday becomes next Monday", "2026-10-24 10:00", "2026-10-26 08:15", 495},
		{"Sunday late becomes next Monday", "2026-10-25 23:59", "2026-10-26 08:15", 495},
		{"Monday just after midnight is that Monday", "2026-10-26 00:01", "2026-10-26 08:15", 495},
		{"another demo_clock value", "2026-10-22 15:30", "2026-10-22 09:40", 580},
		{"no demo_clock uses the real time", "2026-10-24 10:07", "2026-10-24 10:07", -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sp, err := tx.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer sp.Rollback(ctx)
			if tc.clock < 0 {
				removeDemoClock(t, sp)
			} else {
				setDemoClock(t, sp, tc.clock)
			}
			m, err := commuteNow(ctx, sp, taipeiTime(t, tc.real))
			if err != nil {
				t.Fatal(err)
			}
			if want := taipeiTime(t, tc.wantNow); !m.Now.Equal(want) {
				t.Errorf("now = %v, want %v", m.Now, want)
			}
			if got, want := m.Today.Format(dateLayout), tc.wantNow[:10]; got != want {
				t.Errorf("today = %s, want %s", got, want)
			}
		})
	}
}

// DD-20, DD-41: the setting is read as minutes after midnight; an out-of-range value is an error,
// not a silently wrong clock.
func TestCommuteNowRejectsInvalidDemoClock(t *testing.T) {
	ctx := context.Background()
	for _, v := range []float64{-1, 1440, 495.5} {
		tx := testTx(t)
		mustExec(t, tx, `UPDATE system_settings SET value = $1 WHERE key = 'demo_clock'`, v)
		if _, err := commuteNow(ctx, tx, time.Now()); err == nil {
			t.Errorf("demo_clock %v: want an error", v)
		}
	}
}

// DD-36, DD-41: the past 10 workdays count back from the workday before today, skipping weekends.
func TestCommutePastWorkdays(t *testing.T) {
	tx := testTx(t)
	rows, err := tx.Query(context.Background(), `SELECT d::text FROM commute_past_workdays('2026-10-26', 10) d`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19",
		"2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("past workdays = %v, want %v", got, want)
	}
}

// REQ-077, REQ-084: on Saturday 10/24 with demo_clock 08:15, today is Monday 10/26; the API returns
// 10/12-10/23, 12 commute slots a day with the weekday, and today holds only 07:00-08:00. 10/23 has
// no measurements, so its slots are simulated; the others are TDX (DD-36). Weather is always
// simulated.
func TestCommuteTrafficOnDemoSaturday(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)

	r := getTraffic(t, tx, sat)
	if r.Today != "2026-10-26" || !r.Now.Equal(taipeiTime(t, "2026-10-26 08:15")) {
		t.Fatalf("today, now = %s, %v; want 2026-10-26 08:15", r.Today, r.Now)
	}
	wantDates := []string{"2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19",
		"2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"}
	if got := dates(r); !reflect.DeepEqual(got, wantDates) {
		t.Fatalf("dates = %v, want %v", got, wantDates)
	}
	if !r.Simulated || !r.WeatherSimulated {
		t.Errorf("simulated %v, weather simulated %v; want both true: 10/23 is simulated (REQ-063)", r.Simulated, r.WeatherSimulated)
	}
	for _, d := range r.Days {
		day, _ := time.ParseInLocation(dateLayout, d.Date, taipei)
		if want := int(day.Weekday()); d.Weekday != want {
			t.Errorf("%s weekday = %d, want %d", d.Date, d.Weekday, want)
		}
		if len(d.Slots) != 12 {
			t.Fatalf("%s has %d slots, want 12", d.Date, len(d.Slots))
		}
		for i, s := range d.Slots {
			want := day.Add(7*time.Hour + time.Duration(i)*15*time.Minute)
			if !s.SlotStart.Equal(want) {
				t.Errorf("%s slot %d starts %v, want %v", d.Date, i, s.SlotStart, want)
			}
			if s.Volume <= 0 || s.AvgSpeedKmh == nil || *s.AvgSpeedKmh <= 0 || s.Simulated != (d.Date == "2026-10-23") || !s.WeatherSimulated {
				t.Errorf("%s %v: volume %d, speed %v, simulated %v, weather simulated %v", d.Date, s.SlotStart, s.Volume, s.AvgSpeedKmh, s.Simulated, s.WeatherSimulated)
			}
		}
	}
	if got, want := todaySlots(t, tx, "2026-10-26"), []string{"07:00", "07:15", "07:30", "07:45", "08:00"}; !reflect.DeepEqual(got, want) {
		t.Errorf("today's slots = %v, want %v", got, want)
	}
}

// REQ-076: only the commute window 07:00-10:00 is kept; nothing at, for example, 12:00.
func TestCommuteSimulationOnlyCommuteWindow(t *testing.T) {
	tx := testTx(t)
	removeDemoClock(t, tx)
	regenerateAt(t, tx, taipeiTime(t, "2026-10-28 18:00"))
	outside := queryInt(t, tx, `
		SELECT count(*) FROM traffic_observations
		 WHERE (slot_start AT TIME ZONE 'Asia/Taipei')::time NOT BETWEEN '07:00' AND '09:45'
		    OR extract(minute FROM slot_start AT TIME ZONE 'Asia/Taipei')::int % 15 <> 0`)
	if outside != 0 {
		t.Errorf("%d rows outside the commute slots", outside)
	}
	if got := todaySlots(t, tx, "2026-10-28"); len(got) != 12 {
		t.Errorf("today after 10:00 has %d slots, want all 12", len(got))
	}
}

// REQ-084, DD-41: with demo_clock 08:15, today has the 5 slots 07:00-08:15 whatever the real time.
func TestCommuteTodayFollowsDemoClock(t *testing.T) {
	for _, real := range []string{"2026-10-29 06:00", "2026-10-29 08:20", "2026-10-29 17:45"} {
		t.Run(real, func(t *testing.T) {
			tx := testTx(t)
			setDemoClock(t, tx, 495)
			regenerateAt(t, tx, taipeiTime(t, real))
			if got := todaySlots(t, tx, "2026-10-29"); len(got) != 5 || got[4] != "08:00" {
				t.Errorf("today's slots = %v, want 07:00-08:00", got)
			}
		})
	}
}

// REQ-084: removing demo_clock goes back to the real date and time, for generating and querying.
func TestCommuteWithoutDemoClockUsesRealTime(t *testing.T) {
	tx := testTx(t)
	removeDemoClock(t, tx)
	real := taipeiTime(t, "2026-10-28 08:40") // a Wednesday without measurements
	regenerateAt(t, tx, real)

	if got, want := todaySlots(t, tx, "2026-10-28"), []string{"07:00", "07:15", "07:30", "07:45", "08:00", "08:15"}; !reflect.DeepEqual(got, want) {
		t.Errorf("today's slots = %v, want %v", got, want)
	}
	r := getTraffic(t, tx, real)
	if r.Today != "2026-10-28" || !r.Now.Equal(real) || r.Days[0].Date != "2026-10-27" || r.Days[9].Date != "2026-10-14" {
		t.Errorf("today %s, now %v, days %v", r.Today, r.Now, dates(r))
	}
	wr := getWeather(t, tx, real)
	if wr.Weather == nil || wr.Weather.ObsTime != "2026-10-28T08:25:00+08:00" {
		t.Errorf("weather = %+v, want the 08:15 slot observed at 08:25", wr.Weather)
	}

	// On a real Saturday there is no commute today: no observation, weather is null.
	sat := taipeiTime(t, "2026-10-24 08:40")
	regenerateAt(t, tx, sat)
	if wr := getWeather(t, tx, sat); wr.Today != "2026-10-24" || wr.Weather != nil {
		t.Errorf("Saturday weather = %+v, want today 2026-10-24 and null", wr)
	}
}

// snapshot is every simulated row, to compare two generations.
func snapshot(t *testing.T, tx pgx.Tx) string {
	t.Helper()
	var s string
	if err := tx.QueryRow(context.Background(), `
		SELECT md5(string_agg(concat_ws('|', vd_id, slot_start, volume, avg_speed_kmh, occupancy_pct, weather), ',' ORDER BY vd_id, slot_start))
		  FROM traffic_observations`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// DD-40, DD-41: the random variation is seeded by today, so a reset on Saturday 10/24 and one on
// Sunday 10/25 (both today = 10/26) produce the same data; another day produces other data.
func TestCommuteSimulationSeededByToday(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	regenerateAt(t, tx, taipeiTime(t, "2026-10-24 09:00"))
	sat := snapshot(t, tx)
	regenerateAt(t, tx, taipeiTime(t, "2026-10-25 20:00"))
	if sun := snapshot(t, tx); sun != sat {
		t.Error("10/24 and 10/25 generated different data")
	}
	regenerateAt(t, tx, taipeiTime(t, "2026-10-27 09:00"))
	if tue := snapshot(t, tx); tue == sat {
		t.Error("10/27 generated the same data as 10/26")
	}
}

// DD-36: generating on another day covers that day's past 10 workdays.
func TestCommuteRegenerateOnNewDay(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	regenerateAt(t, tx, taipeiTime(t, "2026-10-22 09:00"))
	if got := dates(getTraffic(t, tx, taipeiTime(t, "2026-10-22 09:00"))); got[0] != "2026-10-21" || got[9] != "2026-10-08" {
		t.Fatalf("10/22 dates = %v", got)
	}
	later := taipeiTime(t, "2026-10-29 09:00")
	regenerateAt(t, tx, later)
	r := getTraffic(t, tx, later)
	if got := dates(r); got[0] != "2026-10-28" || got[9] != "2026-10-15" {
		t.Fatalf("10/29 dates = %v", got)
	}
	for _, d := range r.Days {
		if len(d.Slots) != 12 {
			t.Errorf("%s has %d slots, want 12", d.Date, len(d.Slots))
		}
	}
	// Simulated rows from before the new window are gone; the TDX measurements stay (DD-36).
	if old := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE slot_start < '2026-10-15T00:00+08:00' AND simulated`); old != 0 {
		t.Errorf("%d simulated rows left from before the new window", old)
	}
}

// REQ-076, REQ-083, DD-40: across many days, every slot in the past 10 workdays and today has one
// weather for all 16 gateways; 2-3 of the past 10 workdays rain. The traffic does not follow the
// simulated weather (DD-40 step 2): every day in the window has all 16 gateways in every slot,
// measured or simulated, and only days without measurements are simulated.
func TestCommuteSimulationIsConsistent(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	ctx := context.Background()
	start := taipeiTime(t, "2026-10-14 12:00")
	for i := 0; i < 20; i++ {
		day := start.AddDate(0, 0, i)
		regenerateAt(t, tx, day)
		label := day.Format(dateLayout)
		m, err := commuteNow(ctx, tx, day)
		if err != nil {
			t.Fatal(err)
		}
		today := m.Today.Format(dateLayout)

		if n := queryInt(t, tx, `SELECT count(*) FROM (SELECT slot_start FROM traffic_observations WHERE weather IS NOT NULL
		                          GROUP BY slot_start HAVING count(DISTINCT weather) > 1 OR count(*) <> 16) x`); n != 0 {
			t.Errorf("%s: %d slots with more than one weather or not all 16 gateways", label, n)
		}
		rainy := queryInt(t, tx, `
			SELECT count(DISTINCT (slot_start AT TIME ZONE 'Asia/Taipei')::date) FROM traffic_observations
			 WHERE (weather->>'precipitation')::numeric > 0 AND slot_start < $1::date::timestamp AT TIME ZONE 'Asia/Taipei'`, today)
		if rainy < 2 || rainy > 3 {
			t.Errorf("%s: %d rainy days in the past 10, want 2-3", label, rainy)
		}
		// Every past workday has its 12 slots with weather.
		if n := queryInt(t, tx, `
			SELECT count(*) FROM commute_past_workdays($1::date, 10) d
			 WHERE (SELECT count(DISTINCT o.slot_start) FROM traffic_observations o
			         WHERE o.weather IS NOT NULL AND (o.slot_start AT TIME ZONE 'Asia/Taipei')::date = d) <> 12`, today); n != 0 {
			t.Errorf("%s: %d past workdays without 12 slots", label, n)
		}
		// A day is simulated exactly when it has no measurement.
		if n := queryInt(t, tx, `
			SELECT count(*) FROM (
			    SELECT (slot_start AT TIME ZONE 'Asia/Taipei')::date FROM traffic_observations
			     GROUP BY 1 HAVING bool_or(simulated) AND bool_or(NOT simulated)) x`); n != 0 {
			t.Errorf("%s: %d days mixing measured and simulated rows", label, n)
		}
	}
}

// REQ-077, DD-41: today's latest weather at or before now, with now and today; under demo_clock
// 08:15 the observation is no later than 08:15.
func TestCommuteWeatherBeforeNow(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	real := taipeiTime(t, "2026-10-22 16:00")
	regenerateAt(t, tx, real)

	r := getWeather(t, tx, real)
	if !r.Now.Equal(taipeiTime(t, "2026-10-22 08:15")) || r.Today != "2026-10-22" || !r.WeatherSimulated {
		t.Fatalf("now %v, today %s, weather simulated %v", r.Now, r.Today, r.WeatherSimulated)
	}
	if r.Weather == nil {
		t.Fatal("weather is null")
	}
	obs, err := time.Parse(time.RFC3339, r.Weather.ObsTime)
	if err != nil {
		t.Fatal(err)
	}
	if obs.After(r.Now) || obs.Before(taipeiTime(t, "2026-10-22 08:00")) {
		t.Errorf("obs_time %v, want the latest observation at or before 08:15", obs)
	}
	if r.Weather.StationID == "" || r.Weather.Weather == "" || r.Weather.AirTemperature == 0 || r.Weather.Precipitation < 0 {
		t.Errorf("weather fields = %+v", r.Weather)
	}
	// The same slot in the traffic table carries the same weather (REQ-083).
	var stored json.RawMessage
	if err := tx.QueryRow(context.Background(), `SELECT weather FROM traffic_observations WHERE weather->>'obs_time' = $1 LIMIT 1`,
		r.Weather.ObsTime).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var want commuteWeather
	if err := json.Unmarshal(stored, &want); err != nil || want != *r.Weather {
		t.Errorf("weather %+v, stored %+v (%v)", *r.Weather, want, err)
	}
}

// REQ-077: both roles can read; an account without the token's role and no token are refused.
func TestCommuteAPIsAuth(t *testing.T) {
	tx := testTx(t)
	now := time.Now()
	for _, path := range []string{"/api/commute/traffic", "/api/commute/weather"} {
		for _, token := range []string{"driver:driver1", "passenger:passenger1"} {
			wantStatus(t, callAt(t, tx, now, path, token), http.StatusOK, "")
		}
		wantStatus(t, callAt(t, tx, now, path, "driver:passenger1"), http.StatusForbidden, "forbidden")
		wantStatus(t, callAt(t, tx, now, path, ""), http.StatusUnauthorized, "unauthorized")
	}
}

// DD-29: the Demo reset regenerates the simulated traffic for today and the weather of the 10 days.
func TestDemoResetRegeneratesCommute(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	mustExec(t, tx, `DELETE FROM traffic_observations WHERE simulated`)
	if err := resetDemoData(context.Background(), tx, taipeiTime(t, "2026-10-24 10:00")); err != nil {
		t.Fatal(err)
	}
	if got := todaySlots(t, tx, "2026-10-26"); len(got) != 5 {
		t.Errorf("after the reset today has %d slots, want 5", len(got))
	}
	if n := queryInt(t, tx, `SELECT count(DISTINCT (slot_start AT TIME ZONE 'Asia/Taipei')::date) FROM traffic_observations
	                          WHERE weather IS NOT NULL`); n != 11 {
		t.Errorf("after the reset %d days of data, want 10 past workdays and today", n)
	}
}

// DD-29, DD-40: two generations at once (two Demo resets, or Karate next to a reset) both succeed
// and leave one copy of the data, instead of the second failing on the primary key. Needs real
// transactions, so it commits; it regenerates the data for now, the same as a reset would.
func TestCommuteSimulationConcurrent(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	errs := make(chan error, 6)
	for i := 0; i < cap(errs); i++ {
		go func() {
			errs <- pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				return regenerateCommuteSimulation(ctx, tx, time.Now())
			})
		}()
	}
	for i := 0; i < cap(errs); i++ {
		if err := <-errs; err != nil {
			t.Errorf("concurrent generation: %v", err)
		}
	}
	var dup int64
	if err := pool.QueryRow(ctx, `SELECT count(*) - count(DISTINCT (vd_id, slot_start)) FROM traffic_observations`).Scan(&dup); err != nil || dup != 0 {
		t.Errorf("duplicate rows = %d, %v", dup, err)
	}
}
