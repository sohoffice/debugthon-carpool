package server

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type place struct {
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

// usualPlace builds the nullable usual-destination triple; all three columns are set together.
func usualPlace(name *string, lat, lng *float64) *place {
	if name == nil || lat == nil || lng == nil {
		return nil
	}
	return &place{Name: *name, Lat: *lat, Lng: *lng}
}

// getDriverProfile returns the driver's name (the same display_name as /api/me), the habitual data
// accumulated from completed rides (DD-19), the vehicle (REQ-074) and the point balance (REQ-071,
// DD-34): everything the driver drawer shows except the point rows (DD-35). The habitual fields are null for an account with
// no rides yet, even though the demo seed gives every demo driver a profile row for its points; a
// driver with no row has a balance of 0. vehicle is null for a driver without one.
func (s *Server) getDriverProfile(c *gin.Context) {
	var (
		pickupID         *int64
		destName         *string
		destLat, destLng *float64
		capacity         *int
		balance          int
		displayName      string
		pickup           *pickupPoint
		vehicle          *vehicleView
	)
	err := s.db.QueryRow(c, `
		SELECT usual_pickup_point_id, usual_destination_name, usual_destination_lat, usual_destination_lng, capacity,
		       point_balance
		  FROM driver_profiles WHERE user_id = $1`, c.GetInt64(ctxUserID)).
		Scan(&pickupID, &destName, &destLat, &destLng, &capacity, &balance)
	if err != nil && !isNoRows(err) {
		s.internalError(c, err)
		return
	}
	if pickupID != nil {
		pickup = &pickupPoint{}
		err := s.db.QueryRow(c, `SELECT id, name, lat, lng, radius_m FROM pickup_points WHERE id = $1`, *pickupID).
			Scan(&pickup.ID, &pickup.Name, &pickup.Lat, &pickup.Lng, &pickup.RadiusM)
		if err != nil {
			s.internalError(c, err)
			return
		}
	}
	if err := s.db.QueryRow(c, `SELECT display_name FROM users WHERE id = $1`, c.GetInt64(ctxUserID)).Scan(&displayName); err != nil {
		s.internalError(c, err)
		return
	}
	var v vehicleView
	err = s.db.QueryRow(c, `SELECT plate, description FROM vehicles WHERE user_id = $1`, c.GetInt64(ctxUserID)).
		Scan(&v.Plate, &v.Description)
	switch {
	case err == nil:
		vehicle = &v
	case !isNoRows(err):
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"display_name":       displayName,
		"usual_pickup_point": pickup,
		"usual_destination":  usualPlace(destName, destLat, destLng),
		"capacity":           capacity,
		"vehicle":            vehicle,
		"point_balance":      balance,
	})
}

func (s *Server) getPassengerProfile(c *gin.Context) {
	var (
		arrival          *string
		destName         *string
		destLat, destLng *float64
	)
	err := s.db.QueryRow(c, `
		SELECT to_char(usual_arrival_time, 'HH24:MI'), usual_destination_name, usual_destination_lat, usual_destination_lng
		  FROM passenger_profiles WHERE user_id = $1`, c.GetInt64(ctxUserID)).
		Scan(&arrival, &destName, &destLat, &destLng)
	if err != nil && !isNoRows(err) {
		s.internalError(c, err)
		return
	}

	rows, err := s.db.Query(c, `
		SELECT b.id, b.stop_id, b.name, b.lat, b.lng
		  FROM passenger_accepted_stops a JOIN bus_stops b ON b.id = a.bus_stop_id
		 WHERE a.user_id = $1 ORDER BY b.id`, c.GetInt64(ctxUserID))
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	stops := []busStop{}
	for rows.Next() {
		var b busStop
		if err := rows.Scan(&b.ID, &b.StopID, &b.Name, &b.Lat, &b.Lng); err != nil {
			s.internalError(c, err)
			return
		}
		stops = append(stops, b)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"usual_arrival_time": arrival,
		"usual_destination":  usualPlace(destName, destLat, destLng),
		"accepted_stops":     stops,
	})
}
