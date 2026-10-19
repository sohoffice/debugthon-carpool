package server

import (
	"context"
	"errors"
	"log"

	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// The request flow (T12, T13): submit, assign, answer, time out, board, complete, cancel. No HTTP
// here; requests.go maps it to the API.
//
// Every change to who holds which seat runs in one transaction under assignLockKey, so requests are
// assigned strictly in submission order and the first to submit gets a contested seat
// (REQ-048, DD-12). The seat counters stay correct on their own (seats.go).

const assignLockKey = 0x63617270 // "carp"

// Request statuses as stored (ride_requests.status).
const (
	statusSubmitted     = "submitted"
	statusRejected      = "rejected"
	statusWaitingDriver = "waiting_driver"
	statusNoMatch       = "no_match"
	statusConfirmed     = "confirmed"
	statusBoarded       = "boarded"
	statusCompleted     = "completed"
	statusCancelled     = "cancelled"
)

var (
	errRequestActive   = errors.New("the passenger already has an open request")
	errNotFound        = errors.New("request not found")
	errNotPending      = errors.New("request is not waiting for this driver")
	errNotConfirmed    = errors.New("request is not confirmed")
	errCannotCancel    = errors.New("request can no longer be cancelled")
	errRequestFinished = errors.New("request is already over")
)

func lockAssignments(ctx context.Context, db DB) error {
	_, err := db.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, assignLockKey)
	return err
}

// submission is what "送出請求" sends (REQ-035, DD-25).
type submission struct {
	PassengerID int64
	PickupID    int64
	Destination place
	Stops       []int64
	Filters     []tagFilter
	Location    latLng
}

// submitRequest decides at once: rejected when the passenger is too far from the pickup point
// (REQ-034), no_match when no car passes screening (REQ-036), else assigned to the best ranked car,
// which confirms right away when it auto-accepts (REQ-022).
func (s *Server) submitRequest(ctx context.Context, sub submission) (int64, error) {
	var id int64
	err := s.inTx(ctx, func(db DB) error {
		if err := lockAssignments(ctx, db); err != nil {
			return err
		}
		err := db.QueryRow(ctx, `
			INSERT INTO ride_requests (passenger_id, pickup_point_id, destination_name, destination_lat, destination_lng,
			                           submitted_lat, submitted_lng)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			sub.PassengerID, sub.PickupID, sub.Destination.Name, sub.Destination.Lat, sub.Destination.Lng,
			sub.Location.Lat, sub.Location.Lng).Scan(&id)
		if isUniqueViolation(err) {
			return errRequestActive
		}
		if err != nil {
			return err
		}
		for _, f := range sub.Filters {
			if _, err := db.Exec(ctx, `INSERT INTO request_tag_filters (request_id, tag_id, intent) VALUES ($1, $2, $3)`, id, f.TagID, f.Intent); err != nil {
				return err
			}
		}
		for _, stop := range sub.Stops {
			if _, err := db.Exec(ctx, `INSERT INTO request_accepted_stops (request_id, bus_stop_id) VALUES ($1, $2)`, id, stop); err != nil {
				return err
			}
		}

		var pickup latLng
		if err := db.QueryRow(ctx, `SELECT lat, lng FROM pickup_points WHERE id = $1`, sub.PickupID).Scan(&pickup.Lat, &pickup.Lng); err != nil {
			return err
		}
		limit, err := settings.New(db).Get(ctx, "submit_distance")
		if err != nil {
			return err
		}
		// The distance is checked against the position sent with the request (DD-25).
		if distanceM(pickup, sub.Location) > limit {
			_, err := db.Exec(ctx, `UPDATE ride_requests SET status = 'rejected' WHERE id = $1`, id)
			return err
		}

		ranked, err := s.rankFor(ctx, db, sub, pickup)
		if err != nil {
			return err
		}
		for i, r := range ranked {
			if _, err := db.Exec(ctx, `INSERT INTO request_candidates (request_id, rank, trip_id, dropoff_bus_stop_id) VALUES ($1, $2, $3, $4)`,
				id, i, r.TripID, r.DropOff.StopID); err != nil {
				return err
			}
		}
		return s.assignFrom(ctx, db, id, 0)
	})
	return id, err
}

// rankFor screens and ranks the cars at the pickup point for the submission (DD-10, DD-11).
func (s *Server) rankFor(ctx context.Context, db DB, sub submission, pickup latLng) ([]rankedTrip, error) {
	params, err := loadMatchParams(ctx, db)
	if err != nil {
		return nil, err
	}
	mine, err := userTags(ctx, db, sub.PassengerID)
	if err != nil {
		return nil, err
	}
	cands, err := s.loadCandidates(ctx, db, sub.PickupID)
	if err != nil {
		return nil, err
	}
	stops, err := stopPositions(ctx, db)
	if err != nil {
		return nil, err
	}
	trips := make([]matchTrip, len(cands))
	for i, c := range cands {
		trips[i] = c.Trip
	}
	req := matchRequest{PickupPointID: sub.PickupID, Destination: latLng{sub.Destination.Lat, sub.Destination.Lng},
		AcceptedStops: sub.Stops, Filters: sub.Filters, Tags: mine}
	ranked, failed := rankRequest(ctx, s.routes, s.walks, params, req, pickup, stops, trips)
	for _, f := range failed {
		// A car that could not be priced is left out, as rankRequest documents.
		log.Printf("ranking: trip %d left out: %v", f.TripID, f.Err)
	}
	return ranked, nil
}

type candidateRow struct {
	Rank   int
	TripID int64
	StopID *int64
}

// assignFrom gives the request to the first candidate from fromRank on that still has a seat and
// has not passed the pickup point, holding the seat (DD-12). With auto-accept it confirms at once;
// otherwise the driver has the confirm timeout to answer (DD-13). With none left it is no_match.
func (s *Server) assignFrom(ctx context.Context, db DB, requestID int64, fromRank int) error {
	rows, err := db.Query(ctx, `
		SELECT rank, trip_id, dropoff_bus_stop_id FROM request_candidates
		 WHERE request_id = $1 AND rank >= $2 AND outcome IS NULL ORDER BY rank`, requestID, fromRank)
	if err != nil {
		return err
	}
	var cands []candidateRow
	for rows.Next() {
		var c candidateRow
		if err := rows.Scan(&c.Rank, &c.TripID, &c.StopID); err != nil {
			rows.Close()
			return err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, cand := range cands {
		var autoAccept, passed bool
		var driverID int64
		err := db.QueryRow(ctx, `SELECT auto_accept, passed_pickup, driver_id FROM trips WHERE id = $1 AND status = 'active'`, cand.TripID).
			Scan(&autoAccept, &passed, &driverID)
		if isNoRows(err) || passed {
			continue
		}
		if err != nil {
			return err
		}
		held, err := holdSeat(ctx, db, cand.TripID)
		if err != nil {
			return err
		}
		if !held {
			continue
		}
		relaxed, err := s.isRelaxed(ctx, db, requestID, driverID)
		if err != nil {
			return err
		}
		if autoAccept {
			if _, err := confirmSeat(ctx, db, cand.TripID); err != nil {
				return err
			}
			_, err = db.Exec(ctx, `
				UPDATE ride_requests SET status = 'confirmed', trip_id = $2, dropoff_bus_stop_id = $3, relaxed = $4,
				       confirmed_at = now(), response_deadline_at = NULL WHERE id = $1`, requestID, cand.TripID, cand.StopID, relaxed)
			if err != nil {
				return err
			}
			if _, err := db.Exec(ctx, `UPDATE request_candidates SET outcome = 'accepted' WHERE request_id = $1 AND rank = $2`, requestID, cand.Rank); err != nil {
				return err
			}
			return linkPassengerActivity(ctx, db, requestID, cand.TripID)
		}
		timeout, err := settings.New(db).Get(ctx, "driver_confirm_timeout")
		if err != nil {
			return err
		}
		_, err = db.Exec(ctx, `
			UPDATE ride_requests SET status = 'waiting_driver', trip_id = $2, dropoff_bus_stop_id = $3, relaxed = $4,
			       response_deadline_at = now() + make_interval(secs => $5) WHERE id = $1`,
			requestID, cand.TripID, cand.StopID, relaxed, timeout)
		return err
	}
	_, err = db.Exec(ctx, `
		UPDATE ride_requests SET status = 'no_match', trip_id = NULL, dropoff_bus_stop_id = NULL, response_deadline_at = NULL
		 WHERE id = $1`, requestID)
	return err
}

// isRelaxed: the car lacks one of the request's preferred tags (REQ-047).
func (s *Server) isRelaxed(ctx context.Context, db DB, requestID, driverID int64) (bool, error) {
	filters, err := tripFilters(ctx, db, `SELECT tag_id, intent FROM request_tag_filters WHERE request_id = $1`, requestID)
	if err != nil {
		return false, err
	}
	tags, err := userTags(ctx, db, driverID)
	if err != nil {
		return false, err
	}
	return relaxedFor(matchRequest{Filters: filters}, matchTrip{Tags: tags}), nil
}

// linkPassengerActivity joins the passenger's latest activity to the trip once confirmed (DD-25).
func linkPassengerActivity(ctx context.Context, db DB, requestID, tripID int64) error {
	_, err := db.Exec(ctx, `
		UPDATE activities SET trip_id = $2
		 WHERE id = (SELECT a.id FROM activities a JOIN ride_requests r ON r.passenger_id = a.user_id
		              WHERE r.id = $1 ORDER BY a.id DESC LIMIT 1)
		   AND role = 'passenger'`, requestID, tripID)
	return err
}

// reassign releases the held seat, records why the car dropped out (outcome may be "") and moves
// the request to the next candidate (REQ-050).
func (s *Server) reassign(ctx context.Context, db DB, requestID int64, outcome string) error {
	var tripID int64
	var rank int
	err := db.QueryRow(ctx, `
		SELECT r.trip_id, c.rank FROM ride_requests r
		  JOIN request_candidates c ON c.request_id = r.id AND c.trip_id = r.trip_id
		 WHERE r.id = $1`, requestID).Scan(&tripID, &rank)
	if err != nil {
		return err
	}
	if _, err := releaseHold(ctx, db, tripID); err != nil {
		return err
	}
	if outcome != "" {
		if _, err := db.Exec(ctx, `UPDATE request_candidates SET outcome = $3 WHERE request_id = $1 AND rank = $2`, requestID, rank, outcome); err != nil {
			return err
		}
	}
	return s.assignFrom(ctx, db, requestID, rank+1)
}

// driverRequest locks the request for its assigned driver; errNotFound when it is someone else's.
func driverRequest(ctx context.Context, db DB, requestID, driverID int64) (status string, tripID int64, err error) {
	err = db.QueryRow(ctx, `
		SELECT r.status, r.trip_id FROM ride_requests r JOIN trips t ON t.id = r.trip_id
		 WHERE r.id = $1 AND t.driver_id = $2 FOR UPDATE OF r`, requestID, driverID).Scan(&status, &tripID)
	if isNoRows(err) {
		return "", 0, errNotFound
	}
	return status, tripID, err
}

// answerRequest is the driver's confirm or decline (REQ-049): confirm turns the held seat into a
// taken one and links the passenger's activity; decline moves on to the next car.
func (s *Server) answerRequest(ctx context.Context, requestID, driverID int64, accept bool) error {
	return s.inTx(ctx, func(db DB) error {
		if err := lockAssignments(ctx, db); err != nil {
			return err
		}
		status, tripID, err := driverRequest(ctx, db, requestID, driverID)
		if err != nil {
			return err
		}
		if status != statusWaitingDriver {
			return errNotPending
		}
		if !accept {
			return s.reassign(ctx, db, requestID, "declined")
		}
		if _, err := confirmSeat(ctx, db, tripID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `
			UPDATE ride_requests SET status = 'confirmed', confirmed_at = now(), response_deadline_at = NULL WHERE id = $1`, requestID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `UPDATE request_candidates SET outcome = 'accepted' WHERE request_id = $1 AND trip_id = $2`, requestID, tripID); err != nil {
			return err
		}
		return linkPassengerActivity(ctx, db, requestID, tripID)
	})
}

// expireRequests moves every request whose driver did not answer in time to the next car (DD-13).
// Deadlines live in the database, so a restart picks up where it left off.
func (s *Server) expireRequests(ctx context.Context) error {
	return s.inTx(ctx, func(db DB) error {
		if err := lockAssignments(ctx, db); err != nil {
			return err
		}
		ids, err := int64s(ctx, db, `
			SELECT id FROM ride_requests WHERE status = 'waiting_driver' AND response_deadline_at <= now() ORDER BY id`)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := s.reassign(ctx, db, id, "timed_out"); err != nil {
				return err
			}
		}
		return nil
	})
}

// boardRequest marks the passenger on board (DD-27). Either side may; the second is a no-op.
// Seats do not change: the seat stays taken until the ride ends.
func boardRequest(ctx context.Context, db DB, requestID int64) error {
	tag, err := db.Exec(ctx, `UPDATE ride_requests SET status = 'boarded', boarded_at = now() WHERE id = $1 AND status = 'confirmed'`, requestID)
	if err != nil || tag.RowsAffected() == 1 {
		return err
	}
	var status string
	if err := db.QueryRow(ctx, `SELECT status FROM ride_requests WHERE id = $1`, requestID).Scan(&status); err != nil {
		return err
	}
	if status == statusBoarded || status == statusCompleted {
		return nil
	}
	return errNotConfirmed
}

// completeRequest ends the ride, boarded or not (DD-23, DD-27). Either side may; only the first
// completes: it frees the seat, writes the service record (REQ-055) and updates both sides'
// habitual data from it (DD-19).
func completeRequest(ctx context.Context, db DB, requestID int64) error {
	var tripID int64
	err := db.QueryRow(ctx, `
		UPDATE ride_requests SET status = 'completed', completed_at = now()
		 WHERE id = $1 AND status IN ('confirmed', 'boarded') RETURNING trip_id`, requestID).Scan(&tripID)
	if isNoRows(err) {
		var status string
		if err := db.QueryRow(ctx, `SELECT status FROM ride_requests WHERE id = $1`, requestID).Scan(&status); err != nil {
			return err
		}
		if status == statusCompleted {
			return nil
		}
		return errNotConfirmed
	}
	if err != nil {
		return err
	}
	if _, err := releaseConfirmed(ctx, db, tripID); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO service_records (request_id, trip_id, driver_id, passenger_id, pickup_point_id, dropoff_bus_stop_id,
		                             dropoff_name, dropoff_lat, dropoff_lng, picked_up_at, completed_at)
		SELECT r.id, t.id, t.driver_id, r.passenger_id, r.pickup_point_id, r.dropoff_bus_stop_id,
		       COALESCE(b.name, t.destination_name), COALESCE(b.lat, t.destination_lat), COALESCE(b.lng, t.destination_lng),
		       r.boarded_at, r.completed_at
		  FROM ride_requests r JOIN trips t ON t.id = r.trip_id LEFT JOIN bus_stops b ON b.id = r.dropoff_bus_stop_id
		 WHERE r.id = $1`, requestID); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO driver_profiles (user_id, usual_pickup_point_id, usual_destination_name, usual_destination_lat, usual_destination_lng, capacity)
		SELECT driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity FROM trips WHERE id = $1
		ON CONFLICT (user_id) DO UPDATE SET usual_pickup_point_id = EXCLUDED.usual_pickup_point_id,
		       usual_destination_name = EXCLUDED.usual_destination_name, usual_destination_lat = EXCLUDED.usual_destination_lat,
		       usual_destination_lng = EXCLUDED.usual_destination_lng, capacity = EXCLUDED.capacity`, tripID); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng)
		SELECT passenger_id, destination_name, destination_lat, destination_lng FROM ride_requests WHERE id = $1
		ON CONFLICT (user_id) DO UPDATE SET usual_destination_name = EXCLUDED.usual_destination_name,
		       usual_destination_lat = EXCLUDED.usual_destination_lat, usual_destination_lng = EXCLUDED.usual_destination_lng`, requestID); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
		DELETE FROM passenger_accepted_stops WHERE user_id = (SELECT passenger_id FROM ride_requests WHERE id = $1)`, requestID); err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO passenger_accepted_stops (user_id, bus_stop_id)
		SELECT r.passenger_id, s.bus_stop_id FROM ride_requests r JOIN request_accepted_stops s ON s.request_id = r.id
		 WHERE r.id = $1`, requestID)
	return err
}

// cancelRequest is the passenger's cancel before boarding (UD-17): the seat goes back. After
// boarding or once the car passed the pickup point it is errCannotCancel.
func (s *Server) cancelRequest(ctx context.Context, requestID int64) error {
	return s.inTx(ctx, func(db DB) error {
		if err := lockAssignments(ctx, db); err != nil {
			return err
		}
		var status string
		var tripID *int64
		var passed bool
		err := db.QueryRow(ctx, `
			SELECT r.status, r.trip_id, COALESCE(t.passed_pickup, false)
			  FROM ride_requests r LEFT JOIN trips t ON t.id = r.trip_id WHERE r.id = $1 FOR UPDATE OF r`, requestID).
			Scan(&status, &tripID, &passed)
		if err != nil {
			return err
		}
		switch {
		case status == statusWaitingDriver:
			if _, err := releaseHold(ctx, db, *tripID); err != nil {
				return err
			}
		case status == statusConfirmed && !passed:
			if _, err := releaseConfirmed(ctx, db, *tripID); err != nil {
				return err
			}
		case status == statusConfirmed || status == statusBoarded:
			return errCannotCancel
		default:
			return errRequestFinished
		}
		_, err = db.Exec(ctx, `UPDATE ride_requests SET status = 'cancelled', cancelled_at = now(), response_deadline_at = NULL WHERE id = $1`, requestID)
		return err
	})
}

// endTrip finishes a trip that reached its destination (docs/ui-design.md UD-16): rides still on
// board are completed, and a request still waiting for this driver moves to the next car.
func (s *Server) endTrip(ctx context.Context, tripID int64) error {
	return s.inTx(ctx, func(db DB) error {
		if err := lockAssignments(ctx, db); err != nil {
			return err
		}
		tag, err := db.Exec(ctx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1 AND status = 'active'`, tripID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		riding, err := int64s(ctx, db, `SELECT id FROM ride_requests WHERE trip_id = $1 AND status IN ('confirmed', 'boarded') ORDER BY id`, tripID)
		if err != nil {
			return err
		}
		for _, id := range riding {
			if err := completeRequest(ctx, db, id); err != nil {
				return err
			}
		}
		waiting, err := int64s(ctx, db, `SELECT id FROM ride_requests WHERE trip_id = $1 AND status = 'waiting_driver' ORDER BY id`, tripID)
		if err != nil {
			return err
		}
		for _, id := range waiting {
			if err := s.reassign(ctx, db, id, ""); err != nil {
				return err
			}
		}
		return nil
	})
}
