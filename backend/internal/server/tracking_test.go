package server

import "testing"

func TestPassedPickup(t *testing.T) {
	pickup := latLng{25.0800, 121.5700}
	const radius, margin = 50.0, 25.0
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
		{"entered then left", []latLng{at(300), at(40), at(5), at(-90)}, true},
		{"first report already inside then left", []latLng{at(10), at(200)}, true},
		{"detour while approaching does not count", []latLng{at(300), at(200), at(400), at(250)}, false},
		{"left then returned stays passed", []latLng{at(30), at(200), at(10)}, true},
		{"jitter just outside the radius is not leaving", []latLng{at(40), at(55), at(48), at(70)}, false},
		{"just beyond the margin is leaving", []latLng{at(40), at(76)}, true},
		{"just inside the margin is not leaving", []latLng{at(40), at(74)}, false},
		{"jitter then a real departure", []latLng{at(40), at(55), at(90)}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := passedPickup(pickup, radius, margin, tc.reports); got != tc.want {
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
	far := latLng{pickup.Lat + 0.01, pickup.Lng}
	// Exactly the radius counts as inside.
	if !passedPickup(pickup, d, 0, []latLng{onEdge, far}) {
		t.Fatal("a report on the radius should count as entering")
	}
	// A zero margin leaves the single-threshold behaviour: just past the radius is leaving.
	just := latLng{pickup.Lat + 51*0.000009, pickup.Lng}
	if !passedPickup(pickup, d, 0, []latLng{onEdge, just}) {
		t.Fatal("with no margin, a report just past the radius should count as leaving")
	}
}
