package server

import (
	"reflect"
	"testing"
	"time"
)

func simDay(t *testing.T, date string) time.Time {
	t.Helper()
	d, err := time.ParseInLocation(dateLayout, date, taipei)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func simArrived(s liveSimSnapshot) int {
	n := 0
	for _, c := range s.Pickups {
		n += c.Arrived
	}
	return n
}

// DD-40 step 5: every pickup point has at least one route, each route starts away from its
// pickup point, passes it and ends in the park.
func TestLiveSimRoutesCoverEveryPickupPointAndEndInThePark(t *testing.T) {
	tx := testTx(t)
	points := map[string]latLng{}
	rows, err := tx.Query(t.Context(), `SELECT name, lat, lng FROM pickup_points`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var name string
		var p latLng
		if err := rows.Scan(&name, &p.Lat, &p.Lng); err != nil {
			t.Fatal(err)
		}
		points[name] = p
	}
	rows.Close()
	boundary := testDeps(t).Park
	used := map[string]int{}
	for i, r := range liveSimRoutes {
		pickup, ok := points[r.Pickup]
		if !ok {
			t.Fatalf("route %d: pickup point %q is not seeded", i, r.Pickup)
		}
		used[r.Pickup]++
		if d := distanceM(r.ToPickup[len(r.ToPickup)-1], pickup); d > 1 {
			t.Errorf("route %d: leg to the pickup ends %.0f m from %s", i, d, r.Pickup)
		}
		if r.ToPark[0] != r.ToPickup[len(r.ToPickup)-1] {
			t.Errorf("route %d: the park leg does not start at the pickup point", i)
		}
		// At least 500 m away as the crow flies, so the car is seen driving to the pickup point.
		if d := distanceM(r.ToPickup[0], pickup); d < 500 {
			t.Errorf("route %d: starts only %.0f m before %s", i, d, r.Pickup)
		}
		end := r.ToPark[len(r.ToPark)-1]
		if !boundary.Contains(end.Lat, end.Lng) {
			t.Errorf("route %d: destination %v is outside the park", i, end)
		}
	}
	for name := range points {
		if used[name] == 0 {
			t.Errorf("no live simulation route from %s", name)
		}
	}
}

// DD-40 step 5: a round is 30-40 cars, each with 1-3 passengers, every pickup point with cars; the
// departures spread over about 15 minutes.
func TestLiveSimPlanSizeAndSpread(t *testing.T) {
	for _, date := range []string{"2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"} {
		plan := liveSimPlan(simDay(t, date), liveSimRoutes)
		if len(plan) < liveSimMinCars || len(plan) > liveSimMaxCars {
			t.Errorf("%s: %d cars, want %d-%d", date, len(plan), liveSimMinCars, liveSimMaxCars)
		}
		byPickup := map[string]int{}
		first, last := plan[0].depart, plan[0].depart
		for _, c := range plan {
			byPickup[c.route.pickup]++
			if n := len(c.passengers); n < 1 || n > liveSimMaxPassengers {
				t.Errorf("%s: a car with %d passengers", date, n)
			}
			if !(c.depart < c.atPickup && c.atPickup < c.arrive) {
				t.Errorf("%s: car times out of order: %v %v %v", date, c.depart, c.atPickup, c.arrive)
			}
			first, last = min(first, c.depart), max(last, c.depart)
		}
		if len(byPickup) != 3 {
			t.Errorf("%s: cars from %d pickup points, want 3", date, len(byPickup))
		}
		if spread := last - first; spread < 12*time.Minute || spread > liveSimDepartureSpread {
			t.Errorf("%s: departures spread over %v, want about 15 minutes", date, spread)
		}
	}
}

// DD-40 step 5 (offset round, the developer's choice): the first query of a round already shows
// about 30-40 cars on the road, the first arrivals come within a few minutes, and after the round
// no car is left and the arrivals stop growing.
func TestLiveSimRoundStartsNearThePeakAndEnds(t *testing.T) {
	for _, date := range []string{"2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"} {
		plan := liveSimPlan(simDay(t, date), liveSimRoutes)
		first := liveSimAt(plan, 0)
		if n := len(first.Cars); n < 25 || n > liveSimMaxCars {
			t.Errorf("%s: %d cars on the road at the first query, want about 30-40", date, n)
		}
		if simArrived(first) != 0 {
			t.Errorf("%s: %d passengers arrived at the first query", date, simArrived(first))
		}
		if simArrived(liveSimAt(plan, 5*time.Minute)) == 0 {
			t.Errorf("%s: nobody arrived within 5 minutes", date)
		}
		end := liveSimAt(plan, time.Hour)
		passengers := 0
		for _, c := range plan {
			passengers += len(c.passengers)
		}
		if len(end.Cars) != 0 || simArrived(end) != passengers {
			t.Errorf("%s: after the round %d cars and %d arrived, want 0 and all %d", date, len(end.Cars), simArrived(end), passengers)
		}
		if later := liveSimAt(plan, 3*time.Hour); !reflect.DeepEqual(later, end) {
			t.Errorf("%s: the round changed after it ended", date)
		}
	}
}

// DD-40: the plan is seeded by today's date: the same day gives the same routes, order and times;
// another day gives another plan.
func TestLiveSimPlanSeededByToday(t *testing.T) {
	a := liveSimPlan(simDay(t, "2026-10-26"), liveSimRoutes)
	if !reflect.DeepEqual(a, liveSimPlan(simDay(t, "2026-10-26"), liveSimRoutes)) {
		t.Fatal("the same day gave two plans")
	}
	if reflect.DeepEqual(a, liveSimPlan(simDay(t, "2026-10-27"), liveSimRoutes)) {
		t.Fatal("two days gave the same plan")
	}
}

// DD-40 step 5: a car leaves from its route's start, is at the pickup point when it picks its
// passengers up, gets nearer the destination along the route as time passes, and is off the map on
// arrival; the same moment gives the same snapshot.
func TestLiveSimCarsAdvanceAlongTheRoute(t *testing.T) {
	plan := liveSimPlan(simDay(t, "2026-10-26"), liveSimRoutes)
	for _, c := range []liveSimCar{plan[0], plan[len(plan)-1]} {
		one := []liveSimCar{c}
		pos := func(d time.Duration) liveSimCarView {
			t.Helper()
			s := liveSimAt(one, d)
			if len(s.Cars) != 1 {
				t.Fatalf("at %v %d cars, want the one", d, len(s.Cars))
			}
			return s.Cars[0]
		}
		if len(liveSimAt(one, c.depart-time.Second).Cars) != 0 || len(liveSimAt(one, c.arrive).Cars) != 0 {
			t.Error("the car is on the map before leaving or after arriving")
		}
		if d := distanceM(pos(c.depart).Pos, c.route.points[0]); d > 1 {
			t.Errorf("at departure %.0f m from the start", d)
		}
		pickup := c.route.points[0]
		for i, m := range c.route.cumM {
			if m == c.route.pickupM {
				pickup = c.route.points[i]
			}
		}
		if at := pos(c.atPickup); distanceM(at.Pos, pickup) > 5 || at.OnBoard != len(c.passengers) {
			t.Errorf("at the pickup time %.0f m from the pickup point with %d on board", distanceM(at.Pos, pickup), at.OnBoard)
		}
		if pos(c.atPickup-time.Second).OnBoard != 0 {
			t.Error("passengers on board before the pickup point")
		}
		end := c.route.points[len(c.route.points)-1]
		if d := distanceM(pos(c.arrive-time.Second).Pos, end); d > 20 {
			t.Errorf("a second before arriving %.0f m from the destination", d)
		}
		// Halfway in time is halfway along the route, and later is nearer the end along it.
		mid := c.depart + (c.arrive-c.depart)/2
		if d := distanceM(pos(mid).Pos, c.route.points[0]); d < 100 {
			t.Errorf("halfway only %.0f m from the start", d)
		}
		if !reflect.DeepEqual(liveSimAt(plan, mid), liveSimAt(plan, mid)) {
			t.Error("the same moment gave two snapshots")
		}
	}
}

// liveSimPath.at follows the route: its start at 0, each point at its distance, the end at the length.
func TestLiveSimPathAt(t *testing.T) {
	p := newLiveSimPath(liveSimRoutes[0])
	for i, m := range p.cumM {
		if got, _ := p.at(m); distanceM(got, p.points[i]) > 0.5 {
			t.Errorf("point %d: at(%.0f) is %.1f m off", i, m, distanceM(got, p.points[i]))
		}
	}
	if got, _ := p.at(-10); got != p.points[0] {
		t.Error("before the start is not the start")
	}
	if got, _ := p.at(p.lengthM() + 10); got != p.points[len(p.points)-1] {
		t.Error("past the end is not the end")
	}
}

// DD-40 step 5: before its car reaches the pickup point a passenger is waiting or matched, on board
// until the car arrives, then counted as arrived; each passenger is in exactly one of these after
// showing up.
func TestLiveSimPassengersWaitMatchBoardArrive(t *testing.T) {
	plan := liveSimPlan(simDay(t, "2026-10-26"), liveSimRoutes)
	var seenWaiting, seenMatched bool
	for d := -20 * time.Minute; d <= time.Hour; d += 30 * time.Second {
		s := liveSimAt(plan, d)
		shown := 0
		for _, c := range plan {
			for _, p := range c.passengers {
				if d >= p.appear || d >= c.atPickup {
					shown++
				}
			}
		}
		total := 0
		for _, c := range s.Pickups {
			total += c.Waiting + c.Matched + c.OnBoard + c.Arrived
			seenWaiting = seenWaiting || c.Waiting > 0
			seenMatched = seenMatched || c.Matched > 0
		}
		if total != shown {
			t.Fatalf("at %v the pickups hold %d passengers, want %d shown so far", d, total, shown)
		}
		onBoard := 0
		for _, car := range s.Cars {
			onBoard += car.OnBoard
		}
		boarded := 0
		for _, c := range s.Pickups {
			boarded += c.OnBoard
		}
		if onBoard != boarded {
			t.Fatalf("at %v cars carry %d, pickups count %d on board", d, onBoard, boarded)
		}
	}
	if !seenWaiting || !seenMatched {
		t.Errorf("waiting seen %v, matched seen %v; want both", seenWaiting, seenMatched)
	}
}

// DD-29, DD-40 step 5: a round starts at the first live query of the commute day and keeps that
// start; the Demo reset starts a new one; a new commute day starts a new one.
func TestLiveRoundStartRestartAndNewDay(t *testing.T) {
	var r liveRound
	t0 := time.Date(2026, 10, 24, 15, 0, 0, 0, taipei)
	if _, ok := r.peek("2026-10-26"); ok {
		t.Fatal("a round before any query")
	}
	if got := r.startOrGet("2026-10-26", t0); !got.Equal(t0) {
		t.Fatalf("start = %v, want %v", got, t0)
	}
	if got := r.startOrGet("2026-10-26", t0.Add(5*time.Minute)); !got.Equal(t0) {
		t.Fatalf("a later query moved the start to %v", got)
	}
	if got, ok := r.peek("2026-10-26"); !ok || !got.Equal(t0) {
		t.Fatalf("peek = %v %v", got, ok)
	}
	r.restart()
	if _, ok := r.peek("2026-10-26"); ok {
		t.Fatal("a round after the reset, before any query")
	}
	t1 := t0.Add(10 * time.Minute)
	if got := r.startOrGet("2026-10-26", t1); !got.Equal(t1) {
		t.Fatalf("after the reset start = %v, want %v", got, t1)
	}
	t2 := t1.Add(24 * time.Hour)
	if got := r.startOrGet("2026-10-27", t2); !got.Equal(t2) {
		t.Fatalf("a new day kept the old start: %v", got)
	}
}
