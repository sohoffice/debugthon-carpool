package server

import (
	"hash/fnv"
	"math"
	"math/rand/v2"
	"sort"
	"sync"
	"time"
)

// Live simulation for the city dashboard (DD-40 step 5, REQ-078, REQ-083): cars and their
// passengers computed from the time elapsed in the round, never written to the database, so they
// stay out of matching and the passenger's supply. The plan (routes, departure order, speeds,
// passengers) is seeded by today's date (DD-41) and does not follow the real clock's time of day:
// it is always a morning peak.

const (
	liveSimMinCars = 30
	liveSimMaxCars = 40
	// The round's departures, relative to the first dashboard query of the round: they spread over
	// liveSimDepartureSpread starting liveSimRoundOffset from the query. The negative offset puts
	// the first query near the peak, with most cars already on the road (developer's choice, DD-40).
	// A trip takes 15-33 minutes (5.6-8.3 km at the speeds below), so the first query sees about 30
	// cars on the road, the first arrivals come within a few minutes and the round is over within
	// half an hour.
	liveSimRoundOffset     = -14 * time.Minute
	liveSimDepartureSpread = 15 * time.Minute
	// Morning-peak speeds in town, slower than the simulator's 25 km/h on the demo drivers' routes.
	liveSimMinSpeedKmh   = 15
	liveSimMaxSpeedKmh   = 22
	liveSimMaxPassengers = 3
	// A passenger shows up at the pickup point 3-8 minutes before the car reaches it and is matched
	// half a minute after the later of that and the car's departure.
	liveSimMinLead    = 3 * time.Minute
	liveSimMaxLead    = 8 * time.Minute
	liveSimMatchDelay = 30 * time.Second
)

// liveRound remembers when the current round started: at the first dashboard query of the commute
// day, again after a Demo reset (DD-29). Kept in memory, as the simulation itself is.
type liveRound struct {
	mu    sync.Mutex
	day   string
	start time.Time
}

// startOrGet returns the round's start for day, starting it at realNow if there is none yet.
func (r *liveRound) startOrGet(day string, realNow time.Time) time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.day != day || r.start.IsZero() {
		r.day, r.start = day, realNow
	}
	return r.start
}

// peek returns the round's start for day without starting one; ok is false when it has not started.
func (r *liveRound) peek(day string) (start time.Time, ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.start, r.day == day && !r.start.IsZero()
}

// restart makes the next dashboard query start a new round (DD-29).
func (r *liveRound) restart() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.day, r.start = "", time.Time{}
}

type liveSimPassenger struct {
	appear, matched time.Duration // after the round start
}

// liveSimCar is one car of the round; times are after the round start.
type liveSimCar struct {
	route      liveSimPath
	depart     time.Duration
	atPickup   time.Duration
	arrive     time.Duration
	passengers []liveSimPassenger
}

// liveSimPath is a route with its cumulative distances, for placing a car along it.
type liveSimPath struct {
	pickup  string
	points  []latLng
	cumM    []float64 // distance from the start to each point
	pickupM float64   // distance from the start to the pickup point
}

func newLiveSimPath(r liveSimRoute) liveSimPath {
	p := liveSimPath{pickup: r.Pickup, points: append(append([]latLng{}, r.ToPickup...), r.ToPark[1:]...)}
	p.cumM = make([]float64, len(p.points))
	for i := 1; i < len(p.points); i++ {
		p.cumM[i] = p.cumM[i-1] + distanceM(p.points[i-1], p.points[i])
	}
	p.pickupM = p.cumM[len(r.ToPickup)-1]
	return p
}

func (p liveSimPath) lengthM() float64 { return p.cumM[len(p.cumM)-1] }

// at is the position and heading after travelling d metres from the start.
func (p liveSimPath) at(d float64) (latLng, float64) {
	i := sort.SearchFloat64s(p.cumM, d)
	if i <= 0 {
		return p.points[0], bearingDeg(p.points[0], p.points[1])
	}
	if i >= len(p.points) {
		n := len(p.points)
		return p.points[n-1], bearingDeg(p.points[n-2], p.points[n-1])
	}
	a, b := p.points[i-1], p.points[i]
	f := (d - p.cumM[i-1]) / (p.cumM[i] - p.cumM[i-1])
	return latLng{a.Lat + (b.Lat-a.Lat)*f, a.Lng + (b.Lng-a.Lng)*f}, bearingDeg(a, b)
}

// liveSimSeed turns today's date into the random source's seed (DD-40).
func liveSimSeed(today time.Time) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte("live-sim/" + today.Format(dateLayout)))
	s := h.Sum64()
	return rand.New(rand.NewPCG(s, s>>1|1))
}

// liveSimPlan is the round for today: 30-40 cars departing one after another over the spread,
// each in its own share of it with a random place inside, so the departures are even but not
// regular. Routes go to the cars in a shuffled order, every route used in turn, so each pickup
// point has cars.
func liveSimPlan(today time.Time, routes []liveSimRoute) []liveSimCar {
	rng := liveSimSeed(today)
	paths := make([]liveSimPath, len(routes))
	for i, r := range routes {
		paths[i] = newLiveSimPath(r)
	}
	n := liveSimMinCars + rng.IntN(liveSimMaxCars-liveSimMinCars+1)
	order := rng.Perm(n)
	cars := make([]liveSimCar, n)
	for i := range cars {
		c := liveSimCar{route: paths[order[i]%len(paths)]}
		c.depart = liveSimRoundOffset + time.Duration((float64(i)+rng.Float64())/float64(n)*float64(liveSimDepartureSpread))
		mps := (liveSimMinSpeedKmh + rng.Float64()*(liveSimMaxSpeedKmh-liveSimMinSpeedKmh)) / 3.6
		c.atPickup = c.depart + secondsDuration(c.route.pickupM/mps)
		c.arrive = c.depart + secondsDuration(c.route.lengthM()/mps)
		c.passengers = make([]liveSimPassenger, 1+rng.IntN(liveSimMaxPassengers))
		for j := range c.passengers {
			appear := c.atPickup - liveSimMinLead - time.Duration(rng.Float64()*float64(liveSimMaxLead-liveSimMinLead))
			c.passengers[j] = liveSimPassenger{appear: appear, matched: min(max(appear, c.depart)+liveSimMatchDelay, c.atPickup)}
		}
		cars[i] = c
	}
	return cars
}

func secondsDuration(s float64) time.Duration {
	return time.Duration(math.Round(s * float64(time.Second)))
}

// liveSimCarView is a simulated car on the road at that moment.
type liveSimCarView struct {
	Pos        latLng
	HeadingDeg float64
	OnBoard    int
}

// liveSimPickupCounts are one pickup point's simulated passengers at that moment.
type liveSimPickupCounts struct {
	Waiting int // shown at the pickup point, not matched yet
	Matched int // matched, the car not there yet
	OnBoard int
	Arrived int // passengers whose car reached the park: requests matched and rides completed
}

type liveSimSnapshot struct {
	Cars    []liveSimCarView               // departed and not yet arrived
	Pickups map[string]liveSimPickupCounts // by pickup point name
}

// liveSimAt is the round t after its start.
func liveSimAt(plan []liveSimCar, t time.Duration) liveSimSnapshot {
	snap := liveSimSnapshot{Cars: []liveSimCarView{}, Pickups: map[string]liveSimPickupCounts{}}
	for _, c := range plan {
		counts := snap.Pickups[c.route.pickup]
		switch {
		case t >= c.arrive:
			counts.Arrived += len(c.passengers)
		case t >= c.atPickup:
			counts.OnBoard += len(c.passengers)
		default:
			for _, p := range c.passengers {
				if t >= p.matched {
					counts.Matched++
				} else if t >= p.appear {
					counts.Waiting++
				}
			}
		}
		snap.Pickups[c.route.pickup] = counts
		if t >= c.depart && t < c.arrive {
			mps := c.route.lengthM() / (c.arrive - c.depart).Seconds()
			pos, heading := c.route.at((t - c.depart).Seconds() * mps)
			v := liveSimCarView{Pos: pos, HeadingDeg: heading}
			if t >= c.atPickup {
				v.OnBoard = len(c.passengers)
			}
			snap.Cars = append(snap.Cars, v)
		}
	}
	return snap
}

// liveSim is the round at realNow for the commute day m, starting the round if it has not
// started: only GET /api/city/live starts it (DD-40 step 5).
func (s *Server) liveSim(m commuteMoment, realNow time.Time) liveSimSnapshot {
	start := s.round.startOrGet(m.Today.Format(dateLayout), realNow)
	return liveSimAt(liveSimPlan(m.Today, liveSimRoutes), realNow.Sub(start))
}

// liveSimArrived is the passengers per pickup point whose simulated car has reached the park by
// realNow; none before the round starts.
func (s *Server) liveSimArrived(m commuteMoment, realNow time.Time) map[string]int {
	out := map[string]int{}
	start, ok := s.round.peek(m.Today.Format(dateLayout))
	if !ok {
		return out
	}
	for name, c := range liveSimAt(liveSimPlan(m.Today, liveSimRoutes), realNow.Sub(start)).Pickups {
		out[name] = c.Arrived
	}
	return out
}
