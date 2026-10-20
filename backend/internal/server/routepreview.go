package server

import (
	"context"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
)

// planKey identifies a planned route by what DD-21 calls "the same pickup point and destination":
// the destination name is not part of it.
type planKey struct {
	pickupID int64
	dest     latLng
}

type plannedRoute struct {
	route   Route
	stopIDs []int64
}

// previewCache keeps the latest preview of each pickup point and destination in memory, so a
// departure shows the driver the route they previewed, however long ago, simulated or not
// (DD-21). It is not the DD-09 estimate cache, and is empty after a restart.
type previewCache struct {
	mu sync.Mutex
	m  map[planKey]plannedRoute
}

func (c *previewCache) get(k planKey) (plannedRoute, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.m[k]
	return p, ok
}

func (c *previewCache) put(k planKey, p plannedRoute) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[planKey]plannedRoute{}
	}
	c.m[k] = p
}

// previewBody is the departure confirmation's route part: pickup point and destination.
type previewBody struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Destination   *struct {
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	} `json:"destination"`
}

// previewRoute plans the pickup -> destination route and its bus stops for the departure
// confirmation screen (REQ-003, DD-21). It creates no trip and writes nothing to the database;
// the result is remembered so that departing with the same pickup point and destination uses it.
func (s *Server) previewRoute(c *gin.Context) {
	var body previewBody
	if err := c.ShouldBindJSON(&body); err != nil || body.PickupPointID == nil || body.Destination == nil ||
		body.Destination.Lat == nil || body.Destination.Lng == nil ||
		*body.Destination.Lat < -90 || *body.Destination.Lat > 90 || *body.Destination.Lng < -180 || *body.Destination.Lng > 180 {
		apiError(c, http.StatusBadRequest, "invalid_request", "需要 pickup_point_id 與 destination（lat、lng）")
		return
	}
	dest := latLng{*body.Destination.Lat, *body.Destination.Lng}
	pickup, ok := s.checkRoutePoints(c, *body.PickupPointID, dest)
	if !ok {
		return
	}
	plan, err := s.planAndRemember(c, *body.PickupPointID, pickup, dest)
	if err != nil {
		s.internalError(c, err)
		return
	}
	stops, err := s.busStopsByID(c, plan.stopIDs)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": routeView{
		Polyline: plan.route.Polyline, DistanceM: plan.route.DistanceM, DurationS: plan.route.DurationS,
		Simulated: plan.route.Simulated, BusStops: stops,
	}})
}

// checkRoutePoints rejects a pickup point outside the predefined list and a destination outside
// the park (REQ-001), the same way for previewing and departing. On failure it has already
// written the response.
func (s *Server) checkRoutePoints(c *gin.Context, pickupID int64, dest latLng) (latLng, bool) {
	var pickup latLng
	err := s.db.QueryRow(c, `SELECT lat, lng FROM pickup_points WHERE id = $1`, pickupID).Scan(&pickup.Lat, &pickup.Lng)
	if isNoRows(err) {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return pickup, false
	}
	if err != nil {
		s.internalError(c, err)
		return pickup, false
	}
	if !s.park.Contains(dest.Lat, dest.Lng) {
		apiError(c, http.StatusBadRequest, "destination_outside_park", "目的地必須在內湖科學園區內")
		return pickup, false
	}
	return pickup, true
}

// planAndRemember plans a fresh route and replaces the remembered preview for the same key.
func (s *Server) planAndRemember(ctx context.Context, pickupID int64, pickup, dest latLng) (plannedRoute, error) {
	route, stopIDs, err := s.planRoute(ctx, pickup, dest)
	if err != nil {
		return plannedRoute{}, err
	}
	plan := plannedRoute{route, stopIDs}
	s.previews.put(planKey{pickupID, dest}, plan)
	return plan, nil
}

// routeForDeparture reuses the preview of the same pickup point and destination, however old,
// and plans only when there is none (DD-21).
func (s *Server) routeForDeparture(ctx context.Context, pickupID int64, pickup, dest latLng) (plannedRoute, error) {
	if plan, ok := s.previews.get(planKey{pickupID, dest}); ok {
		return plan, nil
	}
	route, stopIDs, err := s.planRoute(ctx, pickup, dest)
	return plannedRoute{route, stopIDs}, err
}

// busStopsByID loads the stops in the given order.
func (s *Server) busStopsByID(ctx context.Context, ids []int64) ([]busStop, error) {
	out := []busStop{}
	for _, id := range ids {
		var b busStop
		if err := s.db.QueryRow(ctx, `SELECT id, stop_id, name, lat, lng FROM bus_stops WHERE id = $1`, id).
			Scan(&b.ID, &b.StopID, &b.Name, &b.Lat, &b.Lng); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}
