package server

import "testing"

func TestPassedPickup(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	const radius = 50.0
	// ~0.00009 degrees of latitude is about 10 m.
	at := func(metres float64) latLng { return latLng{pickup.Lat + metres*0.000009, pickup.Lng} }

	tests := []struct {
		name    string
		reports []latLng
		want    bool
	}{
		{"no reports", nil, false},
		{"approaching only", []latLng{at(500), at(300), at(120)}, false},
		{"entered and still inside", []latLng{at(300), at(40), at(5)}, false},
		{"entered then left", []latLng{at(300), at(40), at(5), at(-60)}, true},
		{"first report already inside then left", []latLng{at(10), at(200)}, true},
		{"detour while approaching does not count", []latLng{at(300), at(200), at(400), at(250)}, false},
		{"left then returned stays passed", []latLng{at(30), at(200), at(10)}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := passedPickup(pickup, radius, tc.reports); got != tc.want {
				t.Fatalf("passedPickup = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestPassedPickupBoundary(t *testing.T) {
	pickup := latLng{25.08, 121.57}
	onEdge := latLng{pickup.Lat + 50*0.000009, pickup.Lng}
	d := distanceM(pickup, onEdge)
	if d < 49 || d > 51 {
		t.Fatalf("test point is %.1f m away, want ~50", d)
	}
	// Exactly the radius counts as inside.
	if !passedPickup(pickup, d, []latLng{onEdge, {pickup.Lat + 0.01, pickup.Lng}}) {
		t.Fatal("a report on the radius should count as entering")
	}
}
