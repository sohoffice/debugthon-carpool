package server

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Polling views of the request flow (DD-03): the driver's requests (REQ-049, REQ-066) and the
// passenger's request status (REQ-052, REQ-053, REQ-069).

type vehicleView struct {
	Plate       string `json:"plate"`
	Description string `json:"description"`
}

// driverRequestItem is one request on the driver's trip. A waiting one asks for an answer; a
// confirmed or boarded one is a passenger on the way, shown with the drop-off (REQ-066).
type driverRequestItem struct {
	ID                 int64       `json:"id"`
	Status             string      `json:"status"`
	PassengerName      string      `json:"passenger_name"`
	PickupPoint        pickupPoint `json:"pickup_point"`
	Dropoff            dropoffView `json:"dropoff"`
	Relaxed            bool        `json:"relaxed"`
	ResponseDeadlineAt *time.Time  `json:"response_deadline_at"`
	Boarded            bool        `json:"boarded"`
	BoardedAt          *time.Time  `json:"boarded_at"`
}

// dropoffView is the passenger's drop-off: a bus stop along the route, or the trip's destination
// when bus_stop_id is null.
type dropoffView struct {
	BusStopID *int64  `json:"bus_stop_id"`
	Name      string  `json:"name"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
}

type driverRequestsView struct {
	TripID     *int64              `json:"trip_id"`
	Pending    []driverRequestItem `json:"pending"`    // waiting for the driver's answer
	Passengers []driverRequestItem `json:"passengers"` // confirmed, with who has boarded
}

// listDriverRequests handles GET /api/driver/requests.
func (s *Server) listDriverRequests(c *gin.Context) {
	v := driverRequestsView{Pending: []driverRequestItem{}, Passengers: []driverRequestItem{}}
	var tripID int64
	err := s.db.QueryRow(c, `SELECT id FROM trips WHERE driver_id = $1 AND status = 'active'`, c.GetInt64(ctxUserID)).Scan(&tripID)
	if isNoRows(err) {
		c.JSON(http.StatusOK, v)
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	v.TripID = &tripID

	rows, err := s.db.Query(c, `
		SELECT q.id, q.status, u.display_name, p.id, p.name, p.lat, p.lng, p.radius_m,
		       q.dropoff_bus_stop_id, COALESCE(b.name, t.destination_name),
		       COALESCE(b.lat, t.destination_lat), COALESCE(b.lng, t.destination_lng),
		       q.relaxed, q.response_deadline_at, q.boarded_at
		  FROM ride_requests q
		  JOIN users u ON u.id = q.passenger_id
		  JOIN trips t ON t.id = q.trip_id
		  JOIN pickup_points p ON p.id = q.pickup_point_id
		  LEFT JOIN bus_stops b ON b.id = q.dropoff_bus_stop_id
		 WHERE q.trip_id = $1 AND q.status IN ('waiting_driver', 'confirmed', 'boarded')
		 ORDER BY q.id`, tripID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var it driverRequestItem
		if err := rows.Scan(&it.ID, &it.Status, &it.PassengerName, &it.PickupPoint.ID, &it.PickupPoint.Name,
			&it.PickupPoint.Lat, &it.PickupPoint.Lng, &it.PickupPoint.RadiusM, &it.Dropoff.BusStopID, &it.Dropoff.Name,
			&it.Dropoff.Lat, &it.Dropoff.Lng, &it.Relaxed, &it.ResponseDeadlineAt, &it.BoardedAt); err != nil {
			s.internalError(c, err)
			return
		}
		it.Boarded = it.Status == reqBoarded
		if it.Status == reqWaitingDriver {
			v.Pending = append(v.Pending, it)
		} else {
			v.Passengers = append(v.Passengers, it)
		}
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// requestStatusView is what the passenger polls. Once the driver confirms it carries the pickup
// location, the car and its ETA, and the trip with its route (REQ-052); after boarding those
// are gone (DD-27).
type requestStatusView struct {
	requestView
	ReassignedCount int          `json:"reassigned_count"` // cars that declined or timed out (REQ-053)
	PickupPoint     *pickupPoint `json:"pickup_point"`
	Vehicle         *vehicleView `json:"vehicle"`
	ETAS            *int         `json:"eta_s"`
	Trip            *tripView    `json:"trip"`
}

func (s *Server) loadStatusView(ctx context.Context, id int64) (requestStatusView, error) {
	var v requestStatusView
	var err error
	if v.requestView, err = s.loadRequestView(ctx, id, "", ""); err != nil {
		return v, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM request_candidates WHERE request_id = $1 AND outcome IN ('declined', 'timed_out')`, id).
		Scan(&v.ReassignedCount); err != nil {
		return v, err
	}
	if v.Status == reqNoMatch {
		reason, msg := "no_match", "目前沒有可搭的車"
		v.Reason, v.Message = &reason, &msg
	}
	if v.Status != reqConfirmed {
		return v, nil
	}

	var pp pickupPoint
	var veh vehicleView
	err = s.db.QueryRow(ctx, `
		SELECT p.id, p.name, p.lat, p.lng, p.radius_m, COALESCE(h.plate, ''), COALESCE(h.description, '')
		  FROM ride_requests q
		  JOIN pickup_points p ON p.id = q.pickup_point_id
		  JOIN trips t ON t.id = q.trip_id
		  LEFT JOIN vehicles h ON h.user_id = t.driver_id
		 WHERE q.id = $1`, id).Scan(&pp.ID, &pp.Name, &pp.Lat, &pp.Lng, &pp.RadiusM, &veh.Plate, &veh.Description)
	if err != nil {
		return v, err
	}
	v.PickupPoint, v.Vehicle = &pp, &veh
	if eta, err := s.vehicleETA(ctx, *v.TripID); err != nil {
		return v, err
	} else if eta != nil {
		v.ETAS = &eta.DurationS
	}
	if err := s.ensureRoute(ctx, *v.TripID); err != nil {
		return v, err
	}
	trip, err := s.loadTrip(ctx, *v.TripID)
	if err != nil {
		return v, err
	}
	v.Trip = &trip
	return v, nil
}

// getPassengerRequest handles GET /api/passenger/requests/:id.
func (s *Server) getPassengerRequest(c *gin.Context) {
	id, ok := requestIDParam(c)
	if !ok {
		return
	}
	var owner int64
	if err := s.db.QueryRow(c, `SELECT passenger_id FROM ride_requests WHERE id = $1`, id).Scan(&owner); isNoRows(err) || (err == nil && owner != c.GetInt64(ctxUserID)) {
		apiError(c, errRequestNotFound.status, errRequestNotFound.code, errRequestNotFound.msg)
		return
	} else if err != nil {
		s.internalError(c, err)
		return
	}
	v, err := s.loadStatusView(c, id)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// currentPassengerRequest handles GET /api/passenger/requests/current: the caller's request that
// is not over yet (waiting, confirmed or boarded), or {"request": null} (REQ-069).
func (s *Server) currentPassengerRequest(c *gin.Context) {
	var id int64
	err := s.db.QueryRow(c, `
		SELECT id FROM ride_requests
		 WHERE passenger_id = $1 AND status IN ('submitted', 'waiting_driver', 'confirmed', 'boarded')
		 ORDER BY id DESC LIMIT 1`, c.GetInt64(ctxUserID)).Scan(&id)
	if isNoRows(err) {
		c.JSON(http.StatusOK, gin.H{"request": nil})
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	v, err := s.loadStatusView(c, id)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"request": v})
}
