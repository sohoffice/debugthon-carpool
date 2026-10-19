// Package park answers whether a point lies inside the 內湖科學園區 boundary (REQ-001).
// The boundary is a GeoJSON file loaded at startup, not database data.
package park

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

// Boundary is the park polygon's outer ring, as [lng, lat] pairs (GeoJSON order).
type Boundary struct{ ring [][2]float64 }

type featureCollection struct {
	Features []struct {
		Geometry struct {
			Type        string         `json:"type"`
			Coordinates [][][2]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
}

// Load reads the boundary from a GeoJSON file.
func Load(path string) (*Boundary, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f)
}

// Parse reads the first Polygon feature from a GeoJSON FeatureCollection.
func Parse(r io.Reader) (*Boundary, error) {
	var fc featureCollection
	if err := json.NewDecoder(r).Decode(&fc); err != nil {
		return nil, fmt.Errorf("park boundary: %w", err)
	}
	for _, f := range fc.Features {
		if f.Geometry.Type == "Polygon" && len(f.Geometry.Coordinates) > 0 && len(f.Geometry.Coordinates[0]) >= 4 {
			return &Boundary{ring: f.Geometry.Coordinates[0]}, nil
		}
	}
	return nil, errors.New("park boundary: no polygon feature")
}

// Contains reports whether the point is inside the boundary (ray casting).
func (b *Boundary) Contains(lat, lng float64) bool {
	in := false
	for i, j := 0, len(b.ring)-1; i < len(b.ring); j, i = i, i+1 {
		xi, yi := b.ring[i][0], b.ring[i][1]
		xj, yj := b.ring[j][0], b.ring[j][1]
		if (yi > lat) != (yj > lat) && lng < (xj-xi)*(lat-yi)/(yj-yi)+xi {
			in = !in
		}
	}
	return in
}
