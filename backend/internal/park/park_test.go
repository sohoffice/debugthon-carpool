package park

import (
	"strings"
	"testing"
)

const square = `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon",
"coordinates":[[[121.0,25.0],[121.0,25.1],[121.1,25.1],[121.1,25.0],[121.0,25.0]]]}}]}`

func TestContains(t *testing.T) {
	b, err := Parse(strings.NewReader(square))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name     string
		lat, lng float64
		want     bool
	}{
		{"inside", 25.05, 121.05, true},
		{"north of it", 25.2, 121.05, false},
		{"east of it", 25.05, 121.2, false},
		{"swapped lat/lng is outside", 121.05, 25.05, false},
	} {
		if got := b.Contains(c.lat, c.lng); got != c.want {
			t.Errorf("%s: Contains(%v, %v) = %v, want %v", c.name, c.lat, c.lng, got, c.want)
		}
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	for name, in := range map[string]string{
		"not json":   `nope`,
		"no polygon": `{"type":"FeatureCollection","features":[]}`,
	} {
		if _, err := Parse(strings.NewReader(in)); err == nil {
			t.Errorf("%s: Parse succeeded, want an error", name)
		}
	}
}

// The real boundary file: 世貿 and 大巨蛋 pickups are outside the park's destinations, a point in
// the middle of the park is inside, and Taipei Main Station is far outside.
func TestRealBoundary(t *testing.T) {
	b, err := Load("../../config/park/boundary.geojson")
	if err != nil {
		t.Fatal(err)
	}
	if !b.Contains(25.0768, 121.5738) {
		t.Error("瑞光路 內科大樓 A should be inside the park")
	}
	if b.Contains(25.0478, 121.5170) {
		t.Error("Taipei Main Station should be outside the park")
	}
}
