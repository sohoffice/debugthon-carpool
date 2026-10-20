package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const googleRoutesURL = "https://routes.googleapis.com"

// googleRoutes is the Google Routes adapter (carpool-oi-02, DD-09): trip routes and driving times
// follow live traffic, walks use the walking mode. It has no timeout of its own; the fallback
// bounds every call.
type googleRoutes struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func newGoogleRoutes(apiKey string) *googleRoutes {
	return &googleRoutes{baseURL: googleRoutesURL, apiKey: apiKey, client: &http.Client{}}
}

func (g *googleRoutes) Route(ctx context.Context, from, to latLng) (Route, error) {
	r, err := g.computeRoute(ctx, from, to, "DRIVE",
		"routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline")
	if err != nil {
		return Route{}, err
	}
	points, err := decodePolyline(r.Polyline.EncodedPolyline)
	if err != nil {
		return Route{}, err
	}
	if len(points) < 2 {
		return Route{}, errors.New("google routes: route without a polyline")
	}
	return Route{
		Points:    points,
		Polyline:  r.Polyline.EncodedPolyline,
		DistanceM: r.DistanceMeters,
		DurationS: r.durationS,
	}, nil
}

func (g *googleRoutes) DriveTime(ctx context.Context, from, to latLng) (Travel, error) {
	r, err := g.computeRoute(ctx, from, to, "DRIVE", "routes.duration,routes.distanceMeters")
	if err != nil {
		return Travel{}, err
	}
	return Travel{DurationS: r.durationS}, nil
}

func (g *googleRoutes) Walk(ctx context.Context, from, to latLng) (Walk, error) {
	r, err := g.computeRoute(ctx, from, to, "WALK", "routes.duration,routes.distanceMeters")
	if err != nil {
		return Walk{}, err
	}
	return Walk{DurationS: r.durationS}, nil
}

type googleWaypoint struct {
	Location struct {
		LatLng struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"latLng"`
	} `json:"location"`
}

func waypoint(p latLng) googleWaypoint {
	var w googleWaypoint
	w.Location.LatLng.Latitude, w.Location.LatLng.Longitude = p.Lat, p.Lng
	return w
}

type googleRoute struct {
	Duration       string `json:"duration"` // e.g. "1020s"
	DistanceMeters int    `json:"distanceMeters"`
	Polyline       struct {
		EncodedPolyline string `json:"encodedPolyline"`
	} `json:"polyline"`
	durationS int
}

// computeRoute calls directions/v2:computeRoutes and returns its first route. The field mask
// asks only for what the caller needs.
func (g *googleRoutes) computeRoute(ctx context.Context, from, to latLng, mode, fieldMask string) (googleRoute, error) {
	body := map[string]any{
		"origin":      waypoint(from),
		"destination": waypoint(to),
		"travelMode":  mode,
	}
	if mode == "DRIVE" {
		body["routingPreference"] = "TRAFFIC_AWARE"
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return googleRoute{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.baseURL+"/directions/v2:computeRoutes", bytes.NewReader(buf))
	if err != nil {
		return googleRoute{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", g.apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	resp, err := g.client.Do(req)
	if err != nil {
		return googleRoute{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return googleRoute{}, err
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error struct{ Message string } `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		return googleRoute{}, fmt.Errorf("google routes: %s: %s", resp.Status, e.Error.Message)
	}
	var out struct {
		Routes []googleRoute `json:"routes"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return googleRoute{}, fmt.Errorf("google routes: %w", err)
	}
	if len(out.Routes) == 0 {
		return googleRoute{}, errors.New("google routes: no route")
	}
	r := out.Routes[0]
	d, err := time.ParseDuration(r.Duration)
	if err != nil {
		return googleRoute{}, fmt.Errorf("google routes: bad duration %q", r.Duration)
	}
	r.durationS = int(d.Round(time.Second) / time.Second)
	return r, nil
}
