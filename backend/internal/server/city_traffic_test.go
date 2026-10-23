package server

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"testing"
	"time"
)

type cityGatewayResp struct {
	VDID              string          `json:"vd_id"`
	Source            string          `json:"source"`
	Gateway           string          `json:"gateway"`
	RoadName          string          `json:"road_name"`
	RoadDirection     string          `json:"road_direction"`
	Bearing           string          `json:"bearing"`
	SortOrder         int             `json:"sort_order"`
	LocationNote      string          `json:"location_note"`
	Lat               float64         `json:"lat"`
	Lng               float64         `json:"lng"`
	Shape             json.RawMessage `json:"shape"`
	Proxy             bool            `json:"proxy"`
	ProxyNote         *string         `json:"proxy_note"`
	ReferenceSpeedKmh float64         `json:"reference_speed_kmh"`
	Volume            *int            `json:"volume"`
	AvgSpeedKmh       *float64        `json:"avg_speed_kmh"`
	OccupancyPct      *float64        `json:"occupancy_pct"`
	CoveragePct       *float64        `json:"coverage_pct"`
	PastAvgSpeedKmh   *float64        `json:"past_avg_speed_kmh"`
	PastMinSpeedKmh   *float64        `json:"past_min_speed_kmh"`
	PastMaxSpeedKmh   *float64        `json:"past_max_speed_kmh"`
	Simulated         bool            `json:"simulated"`
}

type citySlotResp struct {
	SlotStart        time.Time         `json:"slot_start"`
	Detectors        []cityGatewayResp `json:"detectors"`
	Weather          *commuteWeather   `json:"weather"`
	Simulated        bool              `json:"simulated"`
	WeatherSimulated bool              `json:"weather_simulated"`
}

type cityTrafficResp struct {
	cityClockResp
	citySlotResp
}

type cityTrafficDayResp struct {
	cityClockResp
	Date             string         `json:"date"`
	Slots            []citySlotResp `json:"slots"`
	Simulated        bool           `json:"simulated"`
	WeatherSimulated bool           `json:"weather_simulated"`
}

// demoMonday is the Demo setting of the acceptance criteria: demo_clock 08:15 and today 10/26
// (Saturday 10/24 moves to Monday), so 10/12-10/22 are measured and 10/23 is not.
func demoMonday(t *testing.T) *cityApp {
	t.Helper()
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	real := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, real)
	return newCityApp(t, tx, real)
}

func slotQuery(path, key string, v string) string { return path + "?" + key + "=" + url.QueryEscape(v) }

// REQ-079, DD-36, DD-41: without a parameter, the latest slot 08:00-08:15 today (simulated), with
// all 16 gateways and their static fields; weather is marked simulated on its own.
func TestCityTrafficLatestSlot(t *testing.T) {
	a := demoMonday(t)
	got := cityGet[cityTrafficResp](a, "/api/city/traffic")
	if want := taipeiTime(t, "2026-10-26 08:00"); !got.SlotStart.Equal(want) {
		t.Fatalf("slot %v, want %v", got.SlotStart, want)
	}
	if len(got.Detectors) != 16 || !got.Simulated || !got.WeatherSimulated || got.Weather == nil {
		t.Fatalf("%d gateways, simulated %v, weather simulated %v, weather %v", len(got.Detectors), got.Simulated, got.WeatherSimulated, got.Weather)
	}
	shapes, proxies := 0, 0
	for _, g := range got.Detectors {
		if g.Gateway == "" || g.Bearing == "" || g.Lat == 0 || g.ReferenceSpeedKmh <= 0 || !g.Simulated ||
			g.Volume == nil || *g.Volume <= 0 || g.AvgSpeedKmh == nil || g.OccupancyPct == nil ||
			g.CoveragePct == nil || *g.CoveragePct != 100 || g.PastAvgSpeedKmh == nil {
			t.Errorf("gateway %+v", g)
		}
		if string(g.Shape) != "null" {
			shapes++
		}
		if g.Proxy {
			proxies++
			if g.ProxyNote == nil || *g.ProxyNote == "" {
				t.Errorf("%s is a proxy without a note", g.Gateway)
			}
		}
	}
	if shapes != 6 || proxies != 2 {
		t.Errorf("%d gateways with a shape, %d proxies; want 6 and 2", shapes, proxies)
	}
	checkGatewayOrder(t, got.Detectors)
}

// checkGatewayOrder: gateways come by sort_order 1-16, UD-28's grid rows, each with a location note.
func checkGatewayOrder(t *testing.T, gateways []cityGatewayResp) {
	t.Helper()
	var names []string
	for i, g := range gateways {
		names = append(names, g.Gateway)
		if g.SortOrder != i+1 || g.LocationNote == "" {
			t.Errorf("gateway %d %s: sort_order %d, location_note %q", i, g.Gateway, g.SortOrder, g.LocationNote)
		}
	}
	if !jsonEqual(t, names, ud28Order) {
		t.Errorf("gateways %v, want UD-28's order %v", names, ud28Order)
	}
}

// REQ-079, DD-36: a measured slot gives the CSV's values, simulated false, weather still simulated.
func TestCityTrafficMeasuredSlot(t *testing.T) {
	a := demoMonday(t)
	got := cityGet[cityTrafficResp](a, slotQuery("/api/city/traffic", "slot", "2026-10-12T07:15:00+08:00"))
	if got.Simulated || !got.WeatherSimulated {
		t.Fatalf("simulated %v, weather simulated %v; want false, true", got.Simulated, got.WeatherSimulated)
	}
	for _, g := range got.Detectors {
		if g.VDID != "V6120C0" {
			continue
		}
		// observations-15min.csv: V6120C0,2026-10-12T07:15, 394 vehicles, 63.0 km/h, 4.9%, coverage 93.3%.
		if *g.Volume != 394 || *g.AvgSpeedKmh != 63.0 || *g.OccupancyPct != 4.9 || *g.CoveragePct != 93.3 || g.Simulated {
			t.Errorf("V6120C0 at 07:15: %+v", g)
		}
		return
	}
	t.Fatal("V6120C0 missing")
}

// REQ-079, 4.20, DD-44: the past mean, lowest and highest speed are over the past 10 workdays
// before today at the same time of day, leaving the selected day out; for today, all 10 days.
func TestCityTrafficPastAverageLeavesTheDayOut(t *testing.T) {
	a := demoMonday(t)
	check := func(slot time.Time, wantDays int64) {
		t.Helper()
		got := cityGet[cityTrafficResp](a, slotQuery("/api/city/traffic", "slot", slot.Format(time.RFC3339)))
		for _, g := range got.Detectors {
			var want, low, high *float64
			var days int64
			if err := a.tx.QueryRow(t.Context(), `
				SELECT round(avg(o.avg_speed_kmh), 1)::float8, min(o.avg_speed_kmh)::float8, max(o.avg_speed_kmh)::float8, count(*)
				  FROM traffic_observations o
				 WHERE o.vd_id = $1
				   AND (o.slot_start AT TIME ZONE 'Asia/Taipei')::time = ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::time
				   AND (o.slot_start AT TIME ZONE 'Asia/Taipei')::date IN (SELECT commute_past_workdays('2026-10-26', 10))
				   AND (o.slot_start AT TIME ZONE 'Asia/Taipei')::date <> ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::date`,
				g.VDID, slot).Scan(&want, &low, &high, &days); err != nil {
				t.Fatal(err)
			}
			if days != wantDays || g.PastAvgSpeedKmh == nil || math.Abs(*g.PastAvgSpeedKmh-*want) > 1e-9 {
				t.Errorf("%s %v: past %v over %d days, want %v over %d", g.VDID, slot, g.PastAvgSpeedKmh, days, *want, wantDays)
			}
			if g.PastMinSpeedKmh == nil || g.PastMaxSpeedKmh == nil || *g.PastMinSpeedKmh != *low || *g.PastMaxSpeedKmh != *high ||
				*g.PastMinSpeedKmh > *g.PastAvgSpeedKmh || *g.PastAvgSpeedKmh > *g.PastMaxSpeedKmh {
				t.Errorf("%s %v: past min/max %v/%v, want %v/%v", g.VDID, slot, g.PastMinSpeedKmh, g.PastMaxSpeedKmh, *low, *high)
			}
		}
	}
	check(taipeiTime(t, "2026-10-22 08:00"), 9)  // a measured day
	check(taipeiTime(t, "2026-10-23 08:00"), 9)  // the simulated workday is in the window too
	check(taipeiTime(t, "2026-10-26 08:00"), 10) // today is not in the window
}

// REQ-079, 4.20: the selected day holding the slowest speed is left out of the lowest, and the
// fastest out of the highest; asked for another day, both count again.
func TestCityTrafficPastRangeLeavesTheDayOut(t *testing.T) {
	a := demoMonday(t)
	mustExec(t, a.tx, `UPDATE traffic_observations SET avg_speed_kmh = 1 WHERE vd_id = 'VQBUL20' AND slot_start = '2026-10-20 08:00+08'`)
	mustExec(t, a.tx, `UPDATE traffic_observations SET avg_speed_kmh = 199 WHERE vd_id = 'VQBUL20' AND slot_start = '2026-10-21 08:00+08'`)
	gateway := func(slot string) cityGatewayResp {
		t.Helper()
		for _, g := range cityGet[cityTrafficResp](a, slotQuery("/api/city/traffic", "slot", slot)).Detectors {
			if g.VDID == "VQBUL20" {
				return g
			}
		}
		t.Fatal("VQBUL20 missing")
		return cityGatewayResp{}
	}
	if g := gateway("2026-10-20T08:00:00+08:00"); *g.PastMinSpeedKmh == 1 || *g.PastMaxSpeedKmh != 199 {
		t.Errorf("10/20: min/max %v/%v, want 10/20's 1 left out and 10/21's 199 in", *g.PastMinSpeedKmh, *g.PastMaxSpeedKmh)
	}
	if g := gateway("2026-10-21T08:00:00+08:00"); *g.PastMinSpeedKmh != 1 || *g.PastMaxSpeedKmh == 199 {
		t.Errorf("10/21: min/max %v/%v, want 10/20's 1 in and 10/21's 199 left out", *g.PastMinSpeedKmh, *g.PastMaxSpeedKmh)
	}
	if g := gateway("2026-10-26T08:00:00+08:00"); *g.PastMinSpeedKmh != 1 || *g.PastMaxSpeedKmh != 199 {
		t.Errorf("today: min/max %v/%v, want 1/199", *g.PastMinSpeedKmh, *g.PastMaxSpeedKmh)
	}
}

// REQ-079, DD-39: date gives the day's 12 slots × 16 gateways; today only through the latest slot.
func TestCityTrafficDate(t *testing.T) {
	a := demoMonday(t)
	day := cityGet[cityTrafficDayResp](a, slotQuery("/api/city/traffic", "date", "2026-10-22"))
	if day.Date != "2026-10-22" || len(day.Slots) != 12 || day.Simulated || !day.WeatherSimulated {
		t.Fatalf("date %s, %d slots, simulated %v, weather simulated %v", day.Date, len(day.Slots), day.Simulated, day.WeatherSimulated)
	}
	for i, s := range day.Slots {
		checkGatewayOrder(t, s.Detectors)
		if want := taipeiTime(t, "2026-10-22 07:00").Add(time.Duration(i) * 15 * time.Minute); !s.SlotStart.Equal(want) || len(s.Detectors) != 16 || s.Simulated {
			t.Errorf("slot %d: %v with %d gateways, simulated %v", i, s.SlotStart, len(s.Detectors), s.Simulated)
		}
	}
	// One slot of the day equals the same slot asked for alone.
	one := cityGet[cityTrafficResp](a, slotQuery("/api/city/traffic", "slot", "2026-10-22T08:30:00+08:00"))
	if !jsonEqual(t, day.Slots[6], one.citySlotResp) {
		t.Error("the 08:30 slot of the day differs from ?slot=08:30")
	}

	today := cityGet[cityTrafficDayResp](a, slotQuery("/api/city/traffic", "date", "2026-10-26"))
	if len(today.Slots) != 5 || !today.Slots[4].SlotStart.Equal(taipeiTime(t, "2026-10-26 08:00")) || !today.Simulated {
		t.Errorf("today: %d slots, simulated %v; want 07:00-08:00 simulated", len(today.Slots), today.Simulated)
	}
	if sim := cityGet[cityTrafficDayResp](a, slotQuery("/api/city/traffic", "date", "2026-10-23")); len(sim.Slots) != 12 || !sim.Simulated {
		t.Errorf("10/23: %d slots, simulated %v; want 12 simulated", len(sim.Slots), sim.Simulated)
	}
}

// REQ-079: a bad date or slot, or both at once, is 400; a day or slot without data is 404.
func TestCityTrafficRefused(t *testing.T) {
	a := demoMonday(t)
	for _, q := range []string{
		slotQuery("/api/city/traffic", "date", "2026/10/22"),
		slotQuery("/api/city/traffic", "date", "2026-10-32"),
		slotQuery("/api/city/traffic", "date", "yesterday"),
		slotQuery("/api/city/traffic", "slot", "08:00"),
		slotQuery("/api/city/traffic", "slot", "2026-10-22T08:07:00+08:00"),
		"/api/city/traffic?date=2026-10-22&slot=" + url.QueryEscape("2026-10-22T08:00:00+08:00"),
	} {
		wantStatus(t, a.do(http.MethodGet, q, cityToken), http.StatusBadRequest, "invalid_request")
	}
	for _, q := range []string{
		slotQuery("/api/city/traffic", "date", "2026-10-24"),                // Saturday
		slotQuery("/api/city/traffic", "date", "2026-10-09"),                // before the past 10 workdays
		slotQuery("/api/city/traffic", "date", "2026-10-27"),                // after today
		slotQuery("/api/city/traffic", "slot", "2026-10-26T08:15:00+08:00"), // not over yet
		slotQuery("/api/city/traffic", "slot", "2026-10-22T06:00:00+08:00"), // outside the window
		slotQuery("/api/city/traffic", "slot", "2026-09-01T08:00:00+08:00"),
	} {
		wantStatus(t, a.do(http.MethodGet, q, cityToken), http.StatusNotFound, "not_found")
	}
}

// REQ-079: a gateway without a row in the slot keeps its place, its values null (not zero).
func TestCityTrafficGatewayWithoutData(t *testing.T) {
	a := demoMonday(t)
	mustExec(t, a.tx, `DELETE FROM traffic_observations WHERE vd_id = 'VQBUL20' AND slot_start = '2026-10-22 08:00+08'`)
	got := cityGet[cityTrafficResp](a, slotQuery("/api/city/traffic", "slot", "2026-10-22T08:00:00+08:00"))
	if len(got.Detectors) != 16 {
		t.Fatalf("%d gateways, want 16", len(got.Detectors))
	}
	for _, g := range got.Detectors {
		missing := g.Volume == nil && g.AvgSpeedKmh == nil && g.OccupancyPct == nil && g.CoveragePct == nil && !g.Simulated
		if (g.VDID == "VQBUL20") != missing {
			t.Errorf("%s: volume %v, speed %v, occupancy %v", g.VDID, g.Volume, g.AvgSpeedKmh, g.OccupancyPct)
		}
		if g.VDID == "VQBUL20" && (g.PastAvgSpeedKmh == nil || g.PastMinSpeedKmh == nil || g.PastMaxSpeedKmh == nil) {
			t.Error("VQBUL20 lost its past speeds with its row")
		}
	}
}
