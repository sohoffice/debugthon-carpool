package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

// Route is a driving route with the points it passes through. Simulated marks an estimate
// rather than a real routing result (DD-09).
type Route struct {
	Points    []latLng
	Polyline  string // Encoded Polyline Algorithm Format, precision 5
	DistanceM int
	DurationS int
	Simulated bool
}

// RouteProvider plans the route a trip drives from its pickup point to its destination (DD-21).
// It is the narrow slice of route estimation (T07) that trip management needs.
type RouteProvider interface {
	Route(ctx context.Context, from, to latLng) (Route, error)
}

// straightRoute is the simulated fallback of DD-09: a straight line, with the distance taken as
// 1.3 x the straight-line distance and the car moving at 20 km/h.
type straightRoute struct{}

func (straightRoute) Route(_ context.Context, from, to latLng) (Route, error) {
	points := []latLng{from, to}
	dist := distanceM(from, to) * 1.3
	return Route{
		Points:    points,
		Polyline:  encodePolyline(points),
		DistanceM: int(dist),
		DurationS: int(dist / (20000.0 / 3600)),
		Simulated: true,
	}, nil
}

// DriveTime is the same estimate as Route, without building the route (DD-09).
func (s straightRoute) DriveTime(ctx context.Context, from, to latLng) (Travel, error) {
	r, _ := s.Route(ctx, from, to)
	return Travel{DurationS: r.DurationS, Simulated: true}, nil
}

// encodePolyline implements Google's Encoded Polyline Algorithm Format (precision 5).
func encodePolyline(points []latLng) string {
	var b strings.Builder
	var prevLat, prevLng int
	for _, p := range points {
		lat, lng := int(math.Round(p.Lat*1e5)), int(math.Round(p.Lng*1e5))
		encodePolylineValue(&b, lat-prevLat)
		encodePolylineValue(&b, lng-prevLng)
		prevLat, prevLng = lat, lng
	}
	return b.String()
}

func encodePolylineValue(b *strings.Builder, v int) {
	v <<= 1
	if v < 0 {
		v = ^v
	}
	for v >= 0x20 {
		b.WriteByte(byte((0x20 | v&0x1f) + 63))
		v >>= 5
	}
	b.WriteByte(byte(v + 63))
}

// decodePolyline reverses encodePolyline, so a real route's stops can be found along it (DD-21).
func decodePolyline(s string) ([]latLng, error) {
	var points []latLng
	var lat, lng int
	for i := 0; i < len(s); {
		var delta [2]int
		for k := range delta {
			v, shift := 0, 0
			for {
				if i >= len(s) {
					return nil, errors.New("polyline: truncated")
				}
				b := int(s[i]) - 63
				i++
				if b < 0 || b > 63 || shift > 30 {
					return nil, fmt.Errorf("polyline: invalid byte at %d", i-1)
				}
				v |= (b & 0x1f) << shift
				shift += 5
				if b < 0x20 {
					break
				}
			}
			if v&1 != 0 {
				delta[k] = ^(v >> 1)
			} else {
				delta[k] = v >> 1
			}
		}
		lat, lng = lat+delta[0], lng+delta[1]
		points = append(points, latLng{float64(lat) / 1e5, float64(lng) / 1e5})
	}
	return points, nil
}

type stopPos struct {
	ID  int64
	Pos latLng
}

// stopsAlong returns the ids of the stops within maxOffsetM of the route, in travel order.
func stopsAlong(route []latLng, stops []stopPos, maxOffsetM float64) []int64 {
	type hit struct {
		id    int64
		along float64
	}
	var hits []hit
	for _, s := range stops {
		best, bestAlong := math.Inf(1), 0.0
		cum := 0.0
		for i := 0; i+1 < len(route); i++ {
			segLen := distanceM(route[i], route[i+1])
			d, t := distanceToSegment(s.Pos, route[i], route[i+1])
			if d < best {
				best, bestAlong = d, cum+t*segLen
			}
			cum += segLen
		}
		if best <= maxOffsetM {
			hits = append(hits, hit{s.ID, bestAlong})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].along < hits[j].along })
	ids := make([]int64, len(hits))
	for i, h := range hits {
		ids[i] = h.id
	}
	return ids
}

// distanceToSegment returns the distance in metres from p to segment a-b, and how far along the
// segment (0..1) the nearest point lies. It uses a local flat projection, ample at park scale.
func distanceToSegment(p, a, b latLng) (distM, t float64) {
	rad := math.Pi / 180
	kx := earthRadiusM * rad * math.Cos(a.Lat*rad)
	ky := earthRadiusM * rad
	bx, by := (b.Lng-a.Lng)*kx, (b.Lat-a.Lat)*ky
	px, py := (p.Lng-a.Lng)*kx, (p.Lat-a.Lat)*ky
	if l2 := bx*bx + by*by; l2 > 0 {
		t = math.Max(0, math.Min(1, (px*bx+py*by)/l2))
	}
	return math.Hypot(px-t*bx, py-t*by), t
}
