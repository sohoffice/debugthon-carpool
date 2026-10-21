package server

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type plannedRoute struct {
	route   Route
	stopIDs []int64
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
// confirmation screen (REQ-003, DD-21). It creates no trip; the route and its bus stops are saved
// as a preview whose id the departure refers to.
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
	route, stopIDs, err := s.planRoute(c, pickup, dest)
	if err != nil {
		s.internalError(c, err)
		return
	}
	plan := plannedRoute{route, stopIDs}
	previewID, err := s.savePreview(c, c.GetInt64(ctxUserID), *body.PickupPointID, dest, plan)
	if err != nil {
		s.internalError(c, err)
		return
	}
	stops, err := s.busStopsByID(c, plan.stopIDs)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"preview_id": previewID, "route": routeView{
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

// savePreview stores a planned route and its bus stops as an unused preview of the driver.
func (s *Server) savePreview(ctx context.Context, driverID, pickupID int64, dest latLng, plan plannedRoute) (int64, error) {
	var id int64
	err := s.inTx(ctx, func(db DB) error {
		if err := db.QueryRow(ctx, `
			INSERT INTO route_previews (driver_id, pickup_point_id, destination_lat, destination_lng,
			                            route_polyline, route_distance_m, route_duration_s, route_simulated)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
			driverID, pickupID, dest.Lat, dest.Lng,
			plan.route.Polyline, plan.route.DistanceM, plan.route.DurationS, plan.route.Simulated).Scan(&id); err != nil {
			return err
		}
		for i, stopID := range plan.stopIDs {
			if _, err := db.Exec(ctx, `INSERT INTO route_preview_stops (preview_id, seq, bus_stop_id) VALUES ($1, $2, $3)`,
				id, i+1, stopID); err != nil {
				return err
			}
		}
		return nil
	})
	return id, err
}

// errInvalidPreview means the preview id cannot be used for this departure (DD-21).
var errInvalidPreview = errors.New("invalid route preview")

// usePreview marks the driver's unused preview as used by a departure from the pickup point to
// dest and returns its route. It runs in the departure's transaction, so a failed departure
// leaves the preview unused (DD-21). The destination name is not compared. The UPDATE claims the
// preview atomically, so two departures cannot both use it.
func usePreview(ctx context.Context, db DB, previewID, driverID, pickupID int64, dest latLng) (plannedRoute, error) {
	var plan plannedRoute
	err := db.QueryRow(ctx, `
		UPDATE route_previews SET used_at = now()
		 WHERE id = $1 AND driver_id = $2 AND pickup_point_id = $3
		   AND destination_lat = $4 AND destination_lng = $5 AND used_at IS NULL
		RETURNING route_polyline, route_distance_m, route_duration_s, route_simulated`,
		previewID, driverID, pickupID, dest.Lat, dest.Lng).
		Scan(&plan.route.Polyline, &plan.route.DistanceM, &plan.route.DurationS, &plan.route.Simulated)
	if isNoRows(err) {
		return plan, errInvalidPreview
	}
	if err != nil {
		return plan, err
	}
	rows, err := db.Query(ctx, `SELECT bus_stop_id FROM route_preview_stops WHERE preview_id = $1 ORDER BY seq`, previewID)
	if err != nil {
		return plan, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return plan, err
		}
		plan.stopIDs = append(plan.stopIDs, id)
	}
	return plan, rows.Err()
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
