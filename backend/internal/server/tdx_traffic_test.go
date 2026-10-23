package server

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// The TDX measurements in version control (DD-36), loaded by migration 20261023180000.
const tdxDataDir = "../../../docs/data/tdx-vd/"

func readCSV(t *testing.T, name string) []map[string]string {
	t.Helper()
	f, err := os.Open(tdxDataDir + name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	records, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]string
	for _, r := range records[1:] {
		row := map[string]string{}
		for i, h := range records[0] {
			row[h] = r[i]
		}
		out = append(out, row)
	}
	return out
}

func parseNum(t *testing.T, s string) float64 {
	t.Helper()
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// REQ-076, DD-36, DD-44: the database holds the 16 gateways of detectors.csv, 6 with a shape,
// 成美橋 and 成功橋 as proxies with the detector's real place; reference_speed_kmh is the all-day p85.
func TestTDXDetectorsMatchCSV(t *testing.T) {
	tx := testTx(t)
	csvRows := readCSV(t, "detectors.csv")
	refs := map[string]string{}
	for _, r := range readCSV(t, "reference-speeds.csv") {
		refs[r["vd_id"]] = r["p85_all_day"]
	}
	if len(csvRows) != 16 {
		t.Fatalf("detectors.csv has %d rows, want 16", len(csvRows))
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_detectors`); n != 16 {
		t.Fatalf("%d detectors, want 16", n)
	}
	for _, r := range csvRows {
		var source, gateway, road, dir, bearing string
		var lat, lng, ref float64
		var proxy bool
		var note *string
		var shape []byte
		if err := tx.QueryRow(context.Background(), `
			SELECT source, gateway, road_name, road_direction, bearing, lat, lng, proxy, proxy_note, reference_speed_kmh::float8, shape
			  FROM traffic_detectors WHERE vd_id = $1`, r["vd_id"]).
			Scan(&source, &gateway, &road, &dir, &bearing, &lat, &lng, &proxy, &note, &ref, &shape); err != nil {
			t.Fatalf("%s: %v", r["vd_id"], err)
		}
		if source != r["source"] || gateway != r["gateway"] || road != r["road_name"] || dir != r["road_direction"] ||
			bearing != r["bearing"] || lat != parseNum(t, r["lat"]) || lng != parseNum(t, r["lng"]) ||
			ref != parseNum(t, r["reference_speed_kmh"]) || r["reference_speed_kmh"] != refs[r["vd_id"]] ||
			strconv.FormatBool(proxy) != r["proxy"] {
			t.Errorf("%s: database %s/%s/%s/%s/%s %v,%v proxy %v ref %v; CSV %v", r["vd_id"], source, gateway, road, dir, bearing, lat, lng, proxy, ref, r)
		}
		if (note == nil) != (r["proxy_note"] == "") || (note != nil && *note != r["proxy_note"]) {
			t.Errorf("%s: proxy_note %v, CSV %q", r["vd_id"], note, r["proxy_note"])
		}
		if r["shape"] == "" {
			if shape != nil {
				t.Errorf("%s: shape %s, CSV has none", r["vd_id"], shape)
			}
			continue
		}
		var got, want []struct{ Lat, Lng float64 }
		if err := json.Unmarshal(shape, &got); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(r["shape"]), &want); err != nil {
			t.Fatal(err)
		}
		if !jsonEqual(t, got, want) {
			t.Errorf("%s: shape differs from the CSV", r["vd_id"])
		}
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_detectors WHERE shape IS NOT NULL`); n != 6 {
		t.Errorf("%d gateways with a shape, want 6", n)
	}
	rows, err := tx.Query(context.Background(), `SELECT vd_id || ' ' || proxy_note FROM traffic_detectors WHERE proxy ORDER BY vd_id`)
	if err != nil {
		t.Fatal(err)
	}
	proxies, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"VMSV820 橋北端的新明路", "VQ6WK40 橋北約 900 公尺的成功路二段"}; !jsonEqual(t, proxies, want) {
		t.Errorf("proxies %v, want %v", proxies, want)
	}
}

// REQ-076, DD-36: every measured row of observations-15min.csv is in the database with the same
// values and simulated false, and nothing else on those days; the weather is simulated.
func TestTDXObservationsMatchCSV(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	regenerateAt(t, tx, taipeiTime(t, "2026-10-24 16:30")) // today 10/26: 10/12-10/22 in the window
	csvRows := readCSV(t, "observations-15min.csv")
	if len(csvRows) != 9*12*16 {
		t.Fatalf("observations-15min.csv has %d rows, want 9 workdays × 12 slots × 16", len(csvRows))
	}
	for _, r := range csvRows {
		slot, err := time.Parse(time.RFC3339, r["slot_start"])
		if err != nil {
			t.Fatal(err)
		}
		var volume int
		var speed, occupancy, coverage float64
		var simulated, weatherSimulated, hasWeather bool
		if err := tx.QueryRow(context.Background(), `
			SELECT volume, avg_speed_kmh::float8, occupancy_pct::float8, coverage_pct::float8, simulated, weather_simulated, weather IS NOT NULL
			  FROM traffic_observations WHERE vd_id = $1 AND slot_start = $2`, r["vd_id"], slot).
			Scan(&volume, &speed, &occupancy, &coverage, &simulated, &weatherSimulated, &hasWeather); err != nil {
			t.Fatalf("%s %s: %v", r["vd_id"], r["slot_start"], err)
		}
		if float64(volume) != parseNum(t, r["volume"]) || speed != parseNum(t, r["avg_speed_kmh"]) ||
			occupancy != parseNum(t, r["occupancy_pct"]) || coverage != parseNum(t, r["coverage_pct"]) ||
			simulated || !weatherSimulated || !hasWeather {
			t.Errorf("%s %s: %d %v %v %v sim %v weather sim %v %v; CSV %v", r["vd_id"], r["slot_start"],
				volume, speed, occupancy, coverage, simulated, weatherSimulated, hasWeather, r)
		}
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE NOT simulated`); n != int64(len(csvRows)) {
		t.Errorf("%d measured rows, want %d", n, len(csvRows))
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE NOT weather_simulated`); n != 0 {
		t.Errorf("%d rows with weather not simulated, want 0", n)
	}
}

// DD-40 step 2, DD-41: with demo_clock 08:15 and today 10/26, the simulated rows are 10/23 (the
// workday without measurements) and today 07:00-08:00, each gateway's mean at that time over the
// measured days with variation; a Demo reset regenerates them and leaves the measured rows alone.
func TestTDXSimulatesOnlyDaysWithoutMeasurements(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)

	rows, err := tx.Query(context.Background(), `
		SELECT DISTINCT (slot_start AT TIME ZONE 'Asia/Taipei')::date::text FROM traffic_observations WHERE simulated ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	simDays, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"2026-10-23", "2026-10-26"}; !jsonEqual(t, simDays, want) {
		t.Fatalf("simulated days %v, want %v", simDays, want)
	}
	if got := todaySlots(t, tx, "2026-10-26"); len(got) != 5 || got[4] != "08:00" {
		t.Errorf("today's slots %v, want 07:00-08:00", got)
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE (slot_start AT TIME ZONE 'Asia/Taipei')::date = '2026-10-23' AND simulated`); n != 12*16 {
		t.Errorf("10/23 has %d simulated rows, want 12 × 16", n)
	}
	// Each simulated value stays within its variation around the measured mean (volume ±8%,
	// speed ±5%, occupancy ±10%), with coverage 100.
	if n := queryInt(t, tx, `
		WITH usual AS (
		    SELECT vd_id, (slot_start AT TIME ZONE 'Asia/Taipei')::time AS at,
		           avg(volume) AS v, avg(avg_speed_kmh) AS s, avg(occupancy_pct) AS o
		      FROM traffic_observations WHERE NOT simulated GROUP BY 1, 2)
		SELECT count(*) FROM traffic_observations x JOIN usual u ON u.vd_id = x.vd_id AND u.at = (x.slot_start AT TIME ZONE 'Asia/Taipei')::time
		 WHERE x.simulated AND (x.volume NOT BETWEEN floor(u.v * 0.92) AND ceil(u.v * 1.08)
		                        OR x.avg_speed_kmh NOT BETWEEN u.s * 0.95 - 0.05 AND u.s * 1.05 + 0.05
		                        OR x.occupancy_pct NOT BETWEEN u.o * 0.9 - 0.05 AND u.o * 1.1 + 0.05
		                        OR x.coverage_pct <> 100 OR NOT x.weather_simulated)`); n != 0 {
		t.Errorf("%d simulated rows off the measured mean", n)
	}

	measured := func() string {
		var s string
		if err := tx.QueryRow(context.Background(), `
			SELECT md5(string_agg(concat_ws('|', vd_id, slot_start, volume, avg_speed_kmh, occupancy_pct, coverage_pct), ','
			                      ORDER BY vd_id, slot_start)) FROM traffic_observations WHERE NOT simulated`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := measured()
	mustExec(t, tx, `UPDATE traffic_observations SET volume = 0 WHERE simulated`)
	if err := resetDemoData(context.Background(), tx, sat); err != nil {
		t.Fatal(err)
	}
	if measured() != before {
		t.Error("the Demo reset changed the measured rows")
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE simulated AND volume = 0`); n != 0 {
		t.Errorf("%d simulated rows not regenerated by the reset", n)
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE simulated`); n != (12+5)*16 {
		t.Errorf("%d simulated rows after the reset, want (12 + 5) × 16", n)
	}
}

// DD-36: a later migration that loads a day's measurements (e.g. 10/23) replaces that day's
// simulated rows; from then on the generator leaves the day alone.
func TestTDXLaterMeasurementsReplaceSimulation(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	sat := taipeiTime(t, "2026-10-24 16:30")
	regenerateAt(t, tx, sat)
	// What such a migration does: drop the day's simulated rows, insert the measured ones.
	mustExec(t, tx, `DELETE FROM traffic_observations WHERE simulated AND slot_start >= '2026-10-23 00:00+08' AND slot_start < '2026-10-24 00:00+08'`)
	mustExec(t, tx, `
		INSERT INTO traffic_observations (vd_id, slot_start, volume, avg_speed_kmh, occupancy_pct, coverage_pct, simulated, weather_simulated)
		SELECT vd_id, '2026-10-23 07:00+08', 100, 40, 10, 100, false, true FROM traffic_detectors`)
	regenerateAt(t, tx, sat)
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE simulated AND (slot_start AT TIME ZONE 'Asia/Taipei')::date = '2026-10-23'`); n != 0 {
		t.Errorf("10/23 has %d simulated rows after its measurements were loaded", n)
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE NOT simulated AND weather IS NOT NULL AND slot_start = '2026-10-23 07:00+08'`); n != 16 {
		t.Errorf("10/23 07:00: %d measured rows with weather, want 16", n)
	}
}

// DD-40, DD-41: a measured day that falls out of the past 10 workdays keeps its traffic but has no
// weather, and is not in the commute APIs.
func TestTDXMeasuredDayOutsideWindowHasNoWeather(t *testing.T) {
	tx := testTx(t)
	setDemoClock(t, tx, 495)
	regenerateAt(t, tx, taipeiTime(t, "2026-11-05 09:00")) // past 10 workdays: 10/22-11/04
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE NOT simulated AND slot_start < '2026-10-22 00:00+08' AND weather IS NOT NULL`); n != 0 {
		t.Errorf("%d measured rows before the window with weather", n)
	}
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE NOT simulated`); n != 9*12*16 {
		t.Errorf("%d measured rows, want all %d kept", n, 9*12*16)
	}
	// No weather is not simulated weather (REQ-063).
	if n := queryInt(t, tx, `SELECT count(*) FROM traffic_observations WHERE weather IS NULL AND weather_simulated`); n != 0 {
		t.Errorf("%d rows without weather marked as simulated weather", n)
	}
}
