package server

import "math"

type latLng struct{ Lat, Lng float64 }

const earthRadiusM = 6371000.0

// distanceM is the haversine distance in metres.
func distanceM(a, b latLng) float64 {
	rad := math.Pi / 180
	dLat := (b.Lat - a.Lat) * rad
	dLng := (b.Lng - a.Lng) * rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(h))
}

// passedPickup reports whether a vehicle has passed the pickup point: some report
// fell within radiusM of it and a later one fell beyond radiusM+marginM (DD-06).
// Reports must be in reporting order. Entering alone is not passing, since the
// vehicle may still be waiting at the point, and the margin keeps positioning
// noise at the edge of the range from counting as leaving.
func passedPickup(pickup latLng, radiusM, marginM float64, reports []latLng) bool {
	entered := false
	for _, p := range reports {
		d := distanceM(pickup, p)
		if d <= radiusM {
			entered = true
		} else if entered && d > radiusM+marginM {
			return true
		}
	}
	return false
}
