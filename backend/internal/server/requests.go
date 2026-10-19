package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// HTTP surface of the request flow (requestflow.go). Shapes follow ui/shared/src/api/types.ts.

type vehicleView struct {
	Plate       string `json:"plate"`
	Description string `json:"description"`
}

type dropoffView struct {
	place
	BusStopID *int64 `json:"bus_stop_id"`
}

type positionView struct {
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	Heading    *float64  `json:"heading"`
	ReportedAt time.Time `json:"reported_at"`
}

type rideView struct {
	Vehicle      vehicleView   `json:"vehicle"`
	EtaS         *int          `json:"eta_s"`
	Dropoff      dropoffView   `json:"dropoff"`
	Route        *routeView    `json:"route"`
	Position     *positionView `json:"position"`
	PassedPickup bool          `json:"passed_pickup"`
	Simulated    bool          `json:"simulated"`
}

type rejectReason struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	DistanceM int    `json:"distance_m"`
}

type alternativeView struct {
	Mode        string  `json:"mode"`
	Via         *string `json:"via"`
	DurationMin int     `json:"duration_min"`
	Simulated   bool    `json:"simulated"`
}

type passengerRequestView struct {
	ID           int64             `json:"id"`
	Status       string            `json:"status"`
	PickupPoint  pickupPoint       `json:"pickup_point"`
	Destination  place             `json:"destination"`
	Reassigned   bool              `json:"reassigned"`
	Relaxed      bool              `json:"relaxed"`
	RejectReason *rejectReason     `json:"reject_reason"`
	Ride         *rideView         `json:"ride"`
	Alternatives []alternativeView `json:"alternatives"`
	CanCancel    bool              `json:"can_cancel"`
	CreatedAt    time.Time         `json:"created_at"`
}

type pendingRequestView struct {
	ID          int64       `json:"id"`
	PickupPoint pickupPoint `json:"pickup_point"`
	Dropoff     place       `json:"dropoff"`
}

type driverPassengerView struct {
	RequestID int64 `json:"request_id"`
	Dropoff   place `json:"dropoff"`
	Boarded   bool  `json:"boarded"`
}

type driverTripView struct {
	tripView
	EndedAt        *time.Time            `json:"ended_at"`
	PendingRequest *pendingRequestView   `json:"pending_request"`
	Passengers     []driverPassengerView `json:"passengers"`
	CompletedCount int                   `json:"completed_count"`
}

// requestError maps the flow's errors to the API's codes; false when err is not one of them.
func requestError(c *gin.Context, err error) bool {
	switch {
	case errors.Is(err, errRequestActive):
		apiError(c, http.StatusConflict, "request_active", "已經有進行中的請求")
	case errors.Is(err, errNotFound):
		apiError(c, http.StatusNotFound, "not_found", "找不到這個請求")
	case errors.Is(err, errNotPending):
		apiError(c, http.StatusConflict, "request_not_pending", "這個請求已經不需要回應")
	case errors.Is(err, errNotConfirmed):
		apiError(c, http.StatusConflict, "request_not_confirmed", "這個請求還沒有確認")
	case errors.Is(err, errCannotCancel):
		apiError(c, http.StatusConflict, "cannot_cancel", "上車後不能取消請求")
	case errors.Is(err, errRequestFinished):
		apiError(c, http.StatusConflict, "request_closed", "這個請求已經結束")
	default:
		return false
	}
	return true
}

func requestIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		apiError(c, http.StatusBadRequest, "bad_request", "請求編號格式錯誤")
		return 0, false
	}
	return id, true
}

// ------------------------------------------------------------------ passenger

type submissionBody struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Destination   *struct {
		Name string   `json:"name"`
		Lat  *float64 `json:"lat"`
		Lng  *float64 `json:"lng"`
	} `json:"destination"`
	AcceptedStopIDs []int64         `json:"accepted_stop_ids"`
	TagFilters      []tagFilterBody `json:"tag_filters"`
	Location        *locationBody   `json:"location"`
}

// postRequest is "送出請求" (REQ-035, REQ-036): the answer is already decided.
func (s *Server) postRequest(c *gin.Context) {
	var body submissionBody
	if err := c.ShouldBindJSON(&body); err != nil || body.PickupPointID == nil || body.Destination == nil ||
		body.Destination.Name == "" || body.Destination.Lat == nil || body.Destination.Lng == nil || !validTagFilters(body.TagFilters) {
		apiError(c, http.StatusBadRequest, "invalid_request",
			"需要 pickup_point_id、destination（name、lat、lng）、accepted_stop_ids、location，tag_filters 的 intent 為 required 或 preferred 且不可重複")
		return
	}
	if body.Location == nil || body.Location.Lat == nil || body.Location.Lng == nil ||
		math.Abs(*body.Location.Lat) > 90 || math.Abs(*body.Location.Lng) > 180 {
		apiError(c, http.StatusBadRequest, "invalid_location", "需要有效的 location（lat -90～90、lng -180～180）")
		return
	}
	if len(body.AcceptedStopIDs) == 0 {
		apiError(c, http.StatusBadRequest, "no_accepted_stops", "至少選一個可以下車的公車站")
		return
	}
	dest := place{Name: body.Destination.Name, Lat: *body.Destination.Lat, Lng: *body.Destination.Lng}
	if !s.park.Contains(dest.Lat, dest.Lng) {
		apiError(c, http.StatusBadRequest, "destination_outside_park", "目的地必須在內湖科學園區內")
		return
	}
	var pickupOK bool
	var stopCount int
	if err := s.db.QueryRow(c, `SELECT EXISTS (SELECT 1 FROM pickup_points WHERE id = $1), (SELECT count(*) FROM bus_stops WHERE id = ANY($2))`,
		*body.PickupPointID, body.AcceptedStopIDs).Scan(&pickupOK, &stopCount); err != nil {
		s.internalError(c, err)
		return
	}
	if !pickupOK {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return
	}
	if stopCount != len(uniqueIDs(body.AcceptedStopIDs)) {
		apiError(c, http.StatusBadRequest, "unknown_bus_stop", "公車站不在清單中")
		return
	}
	if ok, err := s.tagsExist(c, s.db, body.TagFilters); err != nil {
		s.internalError(c, err)
		return
	} else if !ok {
		apiError(c, http.StatusBadRequest, "invalid_tag", "標籤不在清單中")
		return
	}

	filters := make([]tagFilter, len(body.TagFilters))
	for i, f := range body.TagFilters {
		filters[i] = tagFilter{TagID: f.TagID, Intent: f.Intent}
	}
	id, err := s.submitRequest(c, submission{
		PassengerID: c.GetInt64(ctxUserID), PickupID: *body.PickupPointID, Destination: dest,
		Stops: uniqueIDs(body.AcceptedStopIDs), Filters: filters, Location: latLng{*body.Location.Lat, *body.Location.Lng},
	})
	if requestError(c, err) {
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	s.respondRequest(c, http.StatusCreated, id)
}

// lockedThen runs fn under the assignment lock, so "first one wins" holds between both sides.
func lockedThen(ctx context.Context, db DB, fn func() error) error {
	if err := lockAssignments(ctx, db); err != nil {
		return err
	}
	return fn()
}

func uniqueIDs(ids []int64) []int64 {
	seen := map[int64]bool{}
	var out []int64
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// getMyRequest is the passenger's poll (REQ-053): the latest request, or null.
func (s *Server) getMyRequest(c *gin.Context) {
	if err := s.expireRequests(c); err != nil {
		s.internalError(c, err)
		return
	}
	var id int64
	err := s.db.QueryRow(c, `SELECT id FROM ride_requests WHERE passenger_id = $1 ORDER BY id DESC LIMIT 1`, c.GetInt64(ctxUserID)).Scan(&id)
	if isNoRows(err) {
		c.JSON(http.StatusOK, gin.H{"request": nil})
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	s.respondRequest(c, http.StatusOK, id)
}

// passengerAction is cancel, board or complete on the caller's own request.
func (s *Server) passengerAction(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requestIDParam(c)
		if !ok {
			return
		}
		var owner int64
		err := s.db.QueryRow(c, `SELECT passenger_id FROM ride_requests WHERE id = $1`, id).Scan(&owner)
		if isNoRows(err) || (err == nil && owner != c.GetInt64(ctxUserID)) {
			apiError(c, http.StatusNotFound, "not_found", "找不到這個請求")
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		switch action {
		case "cancel":
			err = s.cancelRequest(c, id)
		case "board":
			err = s.inTx(c, func(db DB) error { return lockedThen(c, db, func() error { return boardRequest(c, db, id) }) })
		case "complete":
			err = s.inTx(c, func(db DB) error { return lockedThen(c, db, func() error { return completeRequest(c, db, id) }) })
		}
		if requestError(c, err) {
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		s.respondRequest(c, http.StatusOK, id)
	}
}

func (s *Server) respondRequest(c *gin.Context, status int, id int64) {
	v, err := s.loadPassengerRequest(c, id)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(status, gin.H{"request": v})
}

// loadPassengerRequest builds what the passenger sees about a request.
func (s *Server) loadPassengerRequest(ctx context.Context, id int64) (passengerRequestView, error) {
	var v passengerRequestView
	var tripID, stopID *int64
	var submitted latLng
	err := s.db.QueryRow(ctx, `
		SELECT r.id, r.status, p.id, p.name, p.lat, p.lng, p.radius_m, r.destination_name, r.destination_lat, r.destination_lng,
		       r.relaxed, r.trip_id, r.dropoff_bus_stop_id, COALESCE(r.submitted_lat, 0), COALESCE(r.submitted_lng, 0), r.created_at,
		       EXISTS (SELECT 1 FROM request_candidates c WHERE c.request_id = r.id AND c.outcome IN ('declined', 'timed_out'))
		  FROM ride_requests r JOIN pickup_points p ON p.id = r.pickup_point_id WHERE r.id = $1`, id).
		Scan(&v.ID, &v.Status, &v.PickupPoint.ID, &v.PickupPoint.Name, &v.PickupPoint.Lat, &v.PickupPoint.Lng, &v.PickupPoint.RadiusM,
			&v.Destination.Name, &v.Destination.Lat, &v.Destination.Lng, &v.Relaxed, &tripID, &stopID,
			&submitted.Lat, &submitted.Lng, &v.CreatedAt, &v.Reassigned)
	if err != nil {
		return v, err
	}
	v.Alternatives = []alternativeView{}
	pickup := latLng{v.PickupPoint.Lat, v.PickupPoint.Lng}

	switch v.Status {
	case statusRejected:
		limit, err := settings.New(s.db).Get(ctx, "submit_distance")
		if err != nil {
			return v, err
		}
		d := int(math.Round(distanceM(pickup, submitted)))
		v.RejectReason = &rejectReason{Code: "too_far", DistanceM: d,
			Message: fmt.Sprintf("你離%s約 %d 公尺，走到 %d 公尺內再送出。", v.PickupPoint.Name, d, int(limit))}
	case statusNoMatch:
		// Walking is always possible (REQ-051); bus alternatives need route data the backend does not have yet.
		walk, err := s.walks.Walk(ctx, pickup, latLng{v.Destination.Lat, v.Destination.Lng})
		if err != nil {
			return v, err
		}
		v.Alternatives = append(v.Alternatives, alternativeView{Mode: "walk", DurationMin: int(math.Ceil(float64(walk.DurationS) / 60)), Simulated: walk.Simulated})
	}

	if tripID != nil && (v.Status == statusConfirmed || v.Status == statusBoarded || v.Status == statusCompleted) {
		ride, err := s.loadRide(ctx, *tripID, stopID, v.Status)
		if err != nil {
			return v, err
		}
		v.Ride = ride
		v.CanCancel = v.Status == statusConfirmed && !ride.PassedPickup
	}
	if v.Status == statusWaitingDriver {
		v.CanCancel = true
	}
	return v, nil
}

// loadRide is the assigned car as the passenger sees it (REQ-052): the car, the ETA and position
// while it approaches, where to get off and the route. After boarding: no ETA or position (REQ-068).
func (s *Server) loadRide(ctx context.Context, tripID int64, stopID *int64, status string) (*rideView, error) {
	if err := s.ensureRoute(ctx, tripID); err != nil {
		return nil, err
	}
	trip, err := s.loadTrip(ctx, tripID)
	if err != nil {
		return nil, err
	}
	var simulated bool
	ride := &rideView{Route: trip.Route, PassedPickup: trip.PassedPickup}
	err = s.db.QueryRow(ctx, `
		SELECT COALESCE(v.plate, '—'), COALESCE(v.description, ''), t.simulated
		  FROM trips t LEFT JOIN vehicles v ON v.user_id = t.driver_id WHERE t.id = $1`, tripID).
		Scan(&ride.Vehicle.Plate, &ride.Vehicle.Description, &simulated)
	if err != nil {
		return nil, err
	}
	ride.Simulated = simulated || (trip.Route != nil && trip.Route.Simulated)

	ride.Dropoff = dropoffView{place: trip.Destination, BusStopID: stopID}
	if stopID != nil {
		if err := s.db.QueryRow(ctx, `SELECT name, lat, lng FROM bus_stops WHERE id = $1`, *stopID).
			Scan(&ride.Dropoff.Name, &ride.Dropoff.Lat, &ride.Dropoff.Lng); err != nil {
			return nil, err
		}
	}

	if status != statusConfirmed {
		return ride, nil
	}
	if !trip.PassedPickup {
		eta, err := s.vehicleETA(ctx, tripID)
		if err != nil {
			return nil, err
		}
		if eta != nil {
			ride.EtaS = &eta.DurationS
			ride.Simulated = ride.Simulated || eta.Simulated
		}
	}
	ride.Position, err = s.carPosition(ctx, tripID)
	return ride, err
}

// carPosition is the driver's latest report on the trip with the heading taken from the one
// before it; a move under 5 m gives no heading, so noise cannot spin the car (UD-15).
func (s *Server) carPosition(ctx context.Context, tripID int64) (*positionView, error) {
	rows, err := s.db.Query(ctx, `
		SELECT r.lat, r.lng, r.reported_at FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.trip_id = $1 AND a.role = 'driver' ORDER BY r.id DESC LIMIT 2`, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pts []positionView
	for rows.Next() {
		var p positionView
		if err := rows.Scan(&p.Lat, &p.Lng, &p.ReportedAt); err != nil {
			return nil, err
		}
		pts = append(pts, p)
	}
	if err := rows.Err(); err != nil || len(pts) == 0 {
		return nil, err
	}
	latest := pts[0]
	if len(pts) == 2 {
		from, to := latLng{pts[1].Lat, pts[1].Lng}, latLng{latest.Lat, latest.Lng}
		if distanceM(from, to) >= 5 {
			h := math.Round(bearingDeg(from, to))
			latest.Heading = &h
		}
	}
	return &latest, nil
}

// bearingDeg is the direction from a to b, degrees clockwise from north.
func bearingDeg(a, b latLng) float64 {
	rad := math.Pi / 180
	y := math.Sin((b.Lng-a.Lng)*rad) * math.Cos(b.Lat*rad)
	x := math.Cos(a.Lat*rad)*math.Sin(b.Lat*rad) - math.Sin(a.Lat*rad)*math.Cos(b.Lat*rad)*math.Cos((b.Lng-a.Lng)*rad)
	return math.Mod(math.Atan2(y, x)/rad+360, 360)
}

// ------------------------------------------------------------------ driver

// getDriverTrip is the driver's poll (DD-04): the running trip, else the latest one, with the
// request waiting for an answer, the confirmed passengers and how many rides it finished.
func (s *Server) getDriverTrip(c *gin.Context) {
	if err := s.expireRequests(c); err != nil {
		s.internalError(c, err)
		return
	}
	s.respondDriverTrip(c)
}

func (s *Server) respondDriverTrip(c *gin.Context) {
	var id int64
	err := s.db.QueryRow(c, `
		SELECT id FROM trips WHERE driver_id = $1 ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, c.GetInt64(ctxUserID)).Scan(&id)
	if isNoRows(err) {
		c.JSON(http.StatusOK, gin.H{"trip": nil})
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	v, err := s.loadDriverTrip(c, id)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trip": v})
}

func (s *Server) loadDriverTrip(ctx context.Context, id int64) (driverTripView, error) {
	var v driverTripView
	if err := s.ensureRoute(ctx, id); err != nil {
		return v, err
	}
	trip, err := s.loadTrip(ctx, id)
	if err != nil {
		return v, err
	}
	v.tripView = trip
	v.Passengers = []driverPassengerView{}
	if err := s.db.QueryRow(ctx, `
		SELECT t.ended_at, (SELECT count(*) FROM service_records r WHERE r.trip_id = t.id) FROM trips t WHERE t.id = $1`, id).
		Scan(&v.EndedAt, &v.CompletedCount); err != nil {
		return v, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.id, r.status, COALESCE(b.name, t.destination_name), COALESCE(b.lat, t.destination_lat), COALESCE(b.lng, t.destination_lng)
		  FROM ride_requests r JOIN trips t ON t.id = r.trip_id LEFT JOIN bus_stops b ON b.id = r.dropoff_bus_stop_id
		 WHERE r.trip_id = $1 AND r.status IN ('waiting_driver', 'confirmed', 'boarded') ORDER BY r.id`, id)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var reqID int64
		var status string
		var drop place
		if err := rows.Scan(&reqID, &status, &drop.Name, &drop.Lat, &drop.Lng); err != nil {
			return v, err
		}
		if status == statusWaitingDriver {
			if v.PendingRequest == nil {
				v.PendingRequest = &pendingRequestView{ID: reqID, PickupPoint: trip.PickupPoint, Dropoff: drop}
			}
			continue
		}
		v.Passengers = append(v.Passengers, driverPassengerView{RequestID: reqID, Dropoff: drop, Boarded: status == statusBoarded})
	}
	return v, rows.Err()
}

// driverAction is accept, decline, board or complete on a request assigned to the caller's trip.
func (s *Server) driverAction(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requestIDParam(c)
		if !ok {
			return
		}
		driverID := c.GetInt64(ctxUserID)
		var err error
		switch action {
		case "accept", "decline":
			err = s.answerRequest(c, id, driverID, action == "accept")
		case "board", "complete":
			err = s.inTx(c, func(db DB) error {
				if err := lockAssignments(c, db); err != nil {
					return err
				}
				if _, _, err := driverRequest(c, db, id, driverID); err != nil {
					return err
				}
				if action == "board" {
					return boardRequest(c, db, id)
				}
				return completeRequest(c, db, id)
			})
		}
		if requestError(c, err) {
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		s.respondDriverTrip(c)
	}
}
