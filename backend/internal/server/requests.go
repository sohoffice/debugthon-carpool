package server

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// Ride request flow, submission half (REQ-034..REQ-036, REQ-047, REQ-048, REQ-022, DD-12,
// DD-25). A request is answered at once: rejected, assigned to the first ranked car with a seat
// held, confirmed (auto-accept), or "no car". Driver response, timeout, reassignment, boarding
// and completion are in request_flow.go.

// Request statuses, as in ride_requests.status.
const (
	reqSubmitted     = "submitted"
	reqRejected      = "rejected"
	reqWaitingDriver = "waiting_driver"
	reqNoMatch       = "no_match"
	reqConfirmed     = "confirmed"
	reqBoarded       = "boarded"
	reqCompleted     = "completed"
)

// rankingBudget is the total time one ranking may spend on travel estimates (DD-09); once spent,
// the remaining estimates are simulated.
const rankingBudget = 2 * time.Second

// requestTransitions is the state diagram of design 4.12, as far as the stored statuses go.
var requestTransitions = map[string][]string{
	reqSubmitted:     {reqRejected, reqWaitingDriver, reqNoMatch},
	reqWaitingDriver: {reqConfirmed, reqWaitingDriver, reqNoMatch}, // waiting -> waiting: declined or timed out, next car
	reqConfirmed:     {reqBoarded, reqCompleted},                   // boarding is optional (DD-27, DD-23)
	reqBoarded:       {reqCompleted},
}

func canTransition(from, to string) bool {
	for _, t := range requestTransitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// transition moves a request from one status to another, refusing pairs the diagram lacks and
// requests that are no longer in the expected status. set holds further assignments (with
// placeholders from $4 on) applied in the same statement.
func transition(ctx context.Context, db DB, id int64, from, to, set string, args ...any) error {
	if !canTransition(from, to) {
		return fmt.Errorf("request %d: transition %s -> %s is not allowed", id, from, to)
	}
	if set != "" {
		set = ", " + set
	}
	tag, err := db.Exec(ctx, `UPDATE ride_requests SET status = $3`+set+` WHERE id = $1 AND status = $2`,
		append([]any{id, from, to}, args...)...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("request %d is not %s: %w", id, from, errStaleRequest)
	}
	return nil
}

// errStaleRequest means the request had already left the expected status: another caller won.
var errStaleRequest = errors.New("request is no longer in the expected status")

// requestLockNamespace is the first key of the advisory locks that serialise submissions.
const requestLockNamespace = 1201

type requestBody struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Location      *struct {
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	} `json:"location"`
	Destination *struct {
		Name string   `json:"name"`
		Lat  *float64 `json:"lat"`
		Lng  *float64 `json:"lng"`
	} `json:"destination"`
	StopIDs    []int64         `json:"stop_ids"`
	TagFilters []tagFilterBody `json:"tag_filters"`
}

// requestView is the immediate answer to a submission (REQ-036).
type requestView struct {
	ID                 int64      `json:"id"`
	Status             string     `json:"status"`
	Reason             *string    `json:"reason"` // set when rejected or unmatched
	Message            *string    `json:"message"`
	Relaxed            bool       `json:"relaxed"` // the car lacks some preferred tag (REQ-047)
	PickupPointID      int64      `json:"pickup_point_id"`
	SubmittedLat       float64    `json:"submitted_lat"`
	SubmittedLng       float64    `json:"submitted_lng"`
	TripID             *int64     `json:"trip_id"`
	DropoffBusStopID   *int64     `json:"dropoff_bus_stop_id"` // null: the trip's destination
	ResponseDeadlineAt *time.Time `json:"response_deadline_at"`
	ConfirmedAt        *time.Time `json:"confirmed_at"`
	BoardedAt          *time.Time `json:"boarded_at"`
	CompletedAt        *time.Time `json:"completed_at"`
	CreatedAt          time.Time  `json:"created_at"`
}

// requestInput is a validated submission.
type requestInput struct {
	PassengerID int64
	Pickup      pickupPoint
	At          latLng // where the passenger was when submitting (DD-25)
	Dest        place
	StopIDs     []int64
	Filters     []tagFilter
}

// submitRequest handles POST /api/passenger/requests.
func (s *Server) submitRequest(c *gin.Context) {
	userID := c.GetInt64(ctxUserID)
	var body requestBody
	if err := c.ShouldBindJSON(&body); err != nil || body.PickupPointID == nil {
		apiError(c, http.StatusBadRequest, "invalid_request", "需要 pickup_point_id")
		return
	}
	in := requestInput{PassengerID: userID}
	if body.Location == nil || body.Location.Lat == nil || body.Location.Lng == nil ||
		*body.Location.Lat < -90 || *body.Location.Lat > 90 || *body.Location.Lng < -180 || *body.Location.Lng > 180 {
		apiError(c, http.StatusBadRequest, "invalid_location", "需要乘客目前的位置 location（lat -90～90、lng -180～180）")
		return
	}
	in.At = latLng{*body.Location.Lat, *body.Location.Lng}

	err := s.db.QueryRow(c, `SELECT id, name, lat, lng, radius_m FROM pickup_points WHERE id = $1`, *body.PickupPointID).
		Scan(&in.Pickup.ID, &in.Pickup.Name, &in.Pickup.Lat, &in.Pickup.Lng, &in.Pickup.RadiusM)
	if isNoRows(err) {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}

	// Habitual data fills whatever the body leaves out (REQ-025).
	var destName *string
	var destLat, destLng *float64
	err = s.db.QueryRow(c, `
		SELECT usual_destination_name, usual_destination_lat, usual_destination_lng
		  FROM passenger_profiles WHERE user_id = $1`, userID).Scan(&destName, &destLat, &destLng)
	if err != nil && !isNoRows(err) {
		s.internalError(c, err)
		return
	}
	dest := usualPlace(destName, destLat, destLng)
	if d := body.Destination; d != nil {
		if d.Lat == nil || d.Lng == nil || *d.Lat < -90 || *d.Lat > 90 || *d.Lng < -180 || *d.Lng > 180 {
			apiError(c, http.StatusBadRequest, "invalid_request", "destination 需要有效的 lat 與 lng")
			return
		}
		dest = &place{Name: d.Name, Lat: *d.Lat, Lng: *d.Lng}
	}
	if dest == nil {
		apiError(c, http.StatusBadRequest, "destination_required", "需要最終目的地")
		return
	}
	in.Dest = *dest

	in.StopIDs = dedupe(body.StopIDs)
	if len(in.StopIDs) == 0 {
		if in.StopIDs, err = s.habitualStopIDs(c, userID); err != nil {
			s.internalError(c, err)
			return
		}
	} else {
		var n int
		if err := s.db.QueryRow(c, `SELECT count(*) FROM bus_stops WHERE id = ANY($1)`, in.StopIDs).Scan(&n); err != nil {
			s.internalError(c, err)
			return
		}
		if n != len(in.StopIDs) {
			apiError(c, http.StatusBadRequest, "invalid_stop", "公車站不在清單中")
			return
		}
	}
	if len(in.StopIDs) == 0 {
		apiError(c, http.StatusBadRequest, "stops_required", "需要至少一個可接受的下車公車站")
		return
	}

	if !validTagFilters(body.TagFilters) {
		apiError(c, http.StatusBadRequest, "invalid_request", "標籤篩選的意圖需為 required 或 preferred，且同一標籤只能出現一次")
		return
	}
	if len(body.TagFilters) > 0 {
		if ok, err := s.tagsExist(c, s.db, body.TagFilters); err != nil {
			s.internalError(c, err)
			return
		} else if !ok {
			apiError(c, http.StatusBadRequest, "invalid_tag", "標籤不在清單中")
			return
		}
	}
	// REQ-001, DD-32: the final destination, including the prefilled usual one, must be in the park.
	if !s.park.Contains(in.Dest.Lat, in.Dest.Lng) {
		apiError(c, http.StatusBadRequest, "destination_outside_park", "最終目的地必須在內湖科學園區內")
		return
	}
	for _, f := range body.TagFilters {
		in.Filters = append(in.Filters, tagFilter{TagID: f.TagID, Intent: f.Intent})
	}

	var view requestView
	err = s.inTx(c, func(tx DB) (err error) {
		view, err = s.placeRequest(c, tx, in)
		return err
	})
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusCreated, view)
}

func dedupe(ids []int64) []int64 {
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

// placeRequest runs the whole submission on db, which must be a transaction: the request, its
// candidates, the seat hold and the status changes commit together (DD-12).
func (s *Server) placeRequest(ctx context.Context, db DB, in requestInput) (requestView, error) {
	ts := *s // reads and writes below go through the caller's transaction
	ts.db = db

	// REQ-048, DD-12: submissions for one pickup point (the whole contention scope, since a trip
	// has one) queue up before the request id is taken, so id order is hold order even when
	// ranking is slow. The lock is released when the transaction ends.
	if _, err := db.Exec(ctx, `SELECT pg_advisory_xact_lock($1, $2)`, requestLockNamespace, int32(in.Pickup.ID)); err != nil {
		return requestView{}, err
	}

	var id int64
	err := db.QueryRow(ctx, `
		INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng,
		                           submitted_lat, submitted_lng)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		in.PassengerID, in.Pickup.ID, in.Dest.Name, in.Dest.Lat, in.Dest.Lng, in.At.Lat, in.At.Lng).Scan(&id)
	if err != nil {
		return requestView{}, err
	}
	for _, f := range in.Filters {
		if _, err := db.Exec(ctx, `INSERT INTO request_tag_filters (request_id, tag_id, intent) VALUES ($1, $2, $3)`,
			id, f.TagID, f.Intent); err != nil {
			return requestView{}, err
		}
	}

	// REQ-034: too far from the pickup point to ask for a car.
	limit, err := settings.New(db).Get(ctx, "submit_distance")
	if err != nil {
		return requestView{}, err
	}
	pickup := latLng{in.Pickup.Lat, in.Pickup.Lng}
	if d := distanceM(pickup, in.At); d > limit {
		msg := fmt.Sprintf("你離上車點「%s」約 %.0f 公尺，超過送出請求距離 %.0f 公尺", in.Pickup.Name, d, limit)
		if err := transition(ctx, db, id, reqSubmitted, reqRejected, ""); err != nil {
			return requestView{}, err
		}
		return ts.loadRequestView(ctx, id, "too_far", msg)
	}

	ranked, trips, err := ts.rankForRequest(ctx, in)
	if err != nil {
		return requestView{}, err
	}
	for i, r := range ranked {
		if _, err := db.Exec(ctx, `
			INSERT INTO request_candidates (request_id, rank, trip_id, dropoff_bus_stop_id) VALUES ($1, $2, $3, $4)`,
			id, i+1, r.TripID, r.DropOff.StopID); err != nil {
			return requestView{}, err
		}
	}

	// REQ-048, DD-12: the first car whose seat can still be held wins; a car filled by an
	// earlier request in the meantime is skipped, its candidate outcome left empty.
	for i, r := range ranked {
		held, err := holdSeat(ctx, db, r.TripID)
		if err != nil {
			return requestView{}, err
		}
		if !held {
			continue
		}
		return ts.assign(ctx, id, i+1, r, relaxedFor(in.Filters, tripByID(trips, r.TripID).Tags))
	}
	if err := transition(ctx, db, id, reqSubmitted, reqNoMatch, ""); err != nil {
		return requestView{}, err
	}
	return ts.loadRequestView(ctx, id, "no_match", "目前沒有可搭的車")
}

// assign records the held seat on the request and, when the trip auto-accepts, confirms it at
// once (REQ-022).
func (s *Server) assign(ctx context.Context, id int64, rank int, r rankedTrip, relaxed bool) (requestView, error) {
	timeout, err := settings.New(s.db).Get(ctx, "driver_confirm_timeout")
	if err != nil {
		return requestView{}, err
	}
	err = transition(ctx, s.db, id, reqSubmitted, reqWaitingDriver,
		`trip_id = $4, dropoff_bus_stop_id = $5, relaxed = $6, response_deadline_at = now() + make_interval(secs => $7)`,
		r.TripID, r.DropOff.StopID, relaxed, timeout)
	if err != nil {
		return requestView{}, err
	}

	var auto bool
	var passengerID int64
	if err := s.db.QueryRow(ctx, `SELECT t.auto_accept, q.passenger_id FROM trips t, ride_requests q
		 WHERE t.id = $1 AND q.id = $2`, r.TripID, id).Scan(&auto, &passengerID); err != nil {
		return requestView{}, err
	}
	if !auto {
		return s.loadRequestView(ctx, id, "", "")
	}

	if err := confirmRequest(ctx, s.db, id, r.TripID, passengerID, rank); err != nil {
		return requestView{}, err
	}
	return s.loadRequestView(ctx, id, "", "")
}

// confirmRequest turns the held seat of a waiting request into a confirmed one and links the
// passenger's latest activity to the trip (REQ-022, REQ-049, DD-25). It runs in the caller's
// transaction: on any error the caller rolls back, so the status and the seat never diverge.
func confirmRequest(ctx context.Context, db DB, id, tripID, passengerID int64, rank int) error {
	if err := transition(ctx, db, id, reqWaitingDriver, reqConfirmed, `confirmed_at = now(), response_deadline_at = NULL`); err != nil {
		return err
	}
	if ok, err := confirmSeat(ctx, db, tripID); err != nil || !ok {
		if err == nil {
			err = fmt.Errorf("trip %d lost the seat held for request %d", tripID, id)
		}
		return err
	}
	if _, err := db.Exec(ctx, `UPDATE request_candidates SET outcome = 'accepted' WHERE request_id = $1 AND rank = $2`, id, rank); err != nil {
		return err
	}
	// DD-25: the passenger's latest activity now belongs to this trip. Only a passenger activity
	// not yet linked qualifies: a driver activity (an account with both roles) or an activity of
	// an earlier ride must keep its trip.
	_, err := db.Exec(ctx, `
		UPDATE activities SET trip_id = $2
		 WHERE id = (SELECT id FROM activities WHERE user_id = $1 ORDER BY id DESC LIMIT 1)
		   AND role = 'passenger' AND trip_id IS NULL`, passengerID, tripID)
	return err
}

// rankForRequest screens and ranks the cars at the pickup point with the matching engine
// (DD-10, DD-11). It also returns the trips as screened, for their tags.
func (s *Server) rankForRequest(ctx context.Context, in requestInput) ([]rankedTrip, []matchTrip, error) {
	// DD-09: one budget for all the travel estimates of this ranking (the cars' ETAs and the ride
	// and walk times). Only estimate calls get estimateCtx; ctx, which the caller's transaction
	// uses for every database call, must not expire with the budget.
	estimateCtx, cancel := context.WithTimeout(ctx, cmp.Or(s.rankBudget, rankingBudget))
	defer cancel()
	params, err := loadMatchParams(ctx, s.db)
	if err != nil {
		return nil, nil, err
	}
	myTags, err := s.userTagIDs(ctx, in.PassengerID)
	if err != nil {
		return nil, nil, err
	}
	trips, err := s.loadMatchTrips(ctx, estimateCtx, in.Pickup.ID)
	if err != nil {
		return nil, nil, err
	}

	need := map[int64]bool{}
	for _, id := range in.StopIDs {
		need[id] = true
	}
	for _, t := range trips {
		for _, id := range t.RouteStops {
			need[id] = true
		}
	}
	stops := map[int64]latLng{}
	rows, err := s.db.Query(ctx, `SELECT id, lat, lng FROM bus_stops`)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id int64
		var p latLng
		if err := rows.Scan(&id, &p.Lat, &p.Lng); err != nil {
			rows.Close()
			return nil, nil, err
		}
		if need[id] {
			stops[id] = p
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	req := matchRequest{PickupPointID: in.Pickup.ID, Destination: latLng{in.Dest.Lat, in.Dest.Lng},
		AcceptedStops: in.StopIDs, Filters: in.Filters, Tags: myTags}
	ranked, failed := rankRequest(estimateCtx, s.drives, s.walks, params, req, latLng{in.Pickup.Lat, in.Pickup.Lng}, stops, trips)
	for _, f := range failed {
		log.Printf("request: trip %d left out: %v", f.TripID, f.Err)
	}
	return ranked, trips, nil
}

func tripByID(trips []matchTrip, id int64) matchTrip {
	for _, t := range trips {
		if t.ID == id {
			return t
		}
	}
	return matchTrip{}
}

// relaxedFor reports whether the car lacks any of the passenger's preferred tags (REQ-047).
func relaxedFor(filters []tagFilter, carTags []int64) bool {
	have := make(map[int64]bool, len(carTags))
	for _, id := range carTags {
		have[id] = true
	}
	for _, f := range filters {
		if f.Intent == "preferred" && !have[f.TagID] {
			return true
		}
	}
	return false
}

func (s *Server) loadRequestView(ctx context.Context, id int64, reason, message string) (requestView, error) {
	var v requestView
	err := s.db.QueryRow(ctx, `
		SELECT id, status, relaxed, pickup_point_id, submitted_lat, submitted_lng, trip_id, dropoff_bus_stop_id,
		       response_deadline_at, confirmed_at, boarded_at, completed_at, created_at
		  FROM ride_requests WHERE id = $1`, id).Scan(&v.ID, &v.Status, &v.Relaxed, &v.PickupPointID,
		&v.SubmittedLat, &v.SubmittedLng, &v.TripID, &v.DropoffBusStopID, &v.ResponseDeadlineAt, &v.ConfirmedAt,
		&v.BoardedAt, &v.CompletedAt, &v.CreatedAt)
	if reason != "" {
		v.Reason, v.Message = &reason, &message
	}
	return v, err
}
