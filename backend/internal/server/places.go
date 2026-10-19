package server

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const maxPlaces = 8

// searchPlaces finds destinations inside the park for the address field: places already used as
// destinations, then the park's bus stops by name. There is no geocoding service in the PoC.
func (s *Server) searchPlaces(c *gin.Context) {
	q := strings.ReplaceAll(strings.TrimSpace(c.Query("q")), " ", "")
	rows, err := s.db.Query(c, `
		SELECT name, lat, lng FROM (
		    SELECT destination_name AS name, destination_lat AS lat, destination_lng AS lng, 0 AS kind FROM trips
		    UNION ALL
		    SELECT usual_destination_name, usual_destination_lat, usual_destination_lng, 0 FROM passenger_profiles
		     WHERE usual_destination_name IS NOT NULL
		    UNION ALL
		    SELECT name, lat, lng, 1 FROM bus_stops
		) p
		 WHERE replace(name, ' ', '') LIKE '%' || $1 || '%'
		 ORDER BY kind, name`, q)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []place{}
	seen := map[string]bool{}
	for rows.Next() && len(out) < maxPlaces {
		var p place
		if err := rows.Scan(&p.Name, &p.Lat, &p.Lng); err != nil {
			s.internalError(c, err)
			return
		}
		if seen[p.Name] || !s.park.Contains(p.Lat, p.Lng) {
			continue
		}
		seen[p.Name] = true
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

type routePreviewBody struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Destination   *struct {
		Name string   `json:"name"`
		Lat  *float64 `json:"lat"`
		Lng  *float64 `json:"lng"`
	} `json:"destination"`
}

// previewRoute is the route a departure would get, shown on the departure screen's map before
// departing (REQ-003). It is planned the same way as at departure (DD-21) but not stored.
func (s *Server) previewRoute(c *gin.Context) {
	var body routePreviewBody
	if err := c.ShouldBindJSON(&body); err != nil || body.PickupPointID == nil || body.Destination == nil ||
		body.Destination.Lat == nil || body.Destination.Lng == nil {
		apiError(c, http.StatusBadRequest, "invalid_request", "需要 pickup_point_id 與 destination（name、lat、lng）")
		return
	}
	var pickup latLng
	err := s.db.QueryRow(c, `SELECT lat, lng FROM pickup_points WHERE id = $1`, *body.PickupPointID).Scan(&pickup.Lat, &pickup.Lng)
	if isNoRows(err) {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	dest := latLng{*body.Destination.Lat, *body.Destination.Lng}
	if !s.park.Contains(dest.Lat, dest.Lng) {
		apiError(c, http.StatusBadRequest, "destination_outside_park", "目的地必須在內湖科學園區內")
		return
	}
	route, stopIDs, err := s.planRoute(c, pickup, dest)
	if err != nil {
		s.internalError(c, err)
		return
	}
	view := routeView{Polyline: route.Polyline, DistanceM: route.DistanceM, DurationS: route.DurationS, Simulated: route.Simulated, BusStops: []busStop{}}
	for _, id := range stopIDs {
		var b busStop
		if err := s.db.QueryRow(c, `SELECT id, stop_id, name, lat, lng FROM bus_stops WHERE id = $1`, id).
			Scan(&b.ID, &b.StopID, &b.Name, &b.Lat, &b.Lng); err != nil {
			s.internalError(c, err)
			return
		}
		view.BusStops = append(view.BusStops, b)
	}
	c.JSON(http.StatusOK, view)
}
