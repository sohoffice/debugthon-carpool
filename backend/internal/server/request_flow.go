package server

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// Ride request flow, response half (REQ-049, REQ-050, REQ-067, REQ-068, DD-12, DD-13, DD-23,
// DD-27). Every operation locks the request row first and then moves it with the conditional
// transition(), so two callers racing on one request (a confirm against a timeout, a passenger
// against a driver) resolve to exactly one outcome; the loser sees the winner's result.

// httpErr is returned from a transaction body to answer with a specific API error.
type httpErr struct {
	status int
	code   string
	msg    string
}

func (e *httpErr) Error() string { return e.code }

var (
	errRequestNotFound = &httpErr{http.StatusNotFound, "not_found", "找不到這筆請求"}
	errNotWaiting      = &httpErr{http.StatusConflict, "not_waiting", "請求已不在等待駕駛回應"}
	errInvalidState    = &httpErr{http.StatusConflict, "invalid_state", "請求目前的狀態不能執行這個操作"}
)

// fail answers err as an API error: a httpErr as is, losing a race as 409, anything else as 500.
func (s *Server) fail(c *gin.Context, err error) {
	var he *httpErr
	switch {
	case errors.As(err, &he):
		apiError(c, he.status, he.code, he.msg)
	case errors.Is(err, errStaleRequest):
		apiError(c, errInvalidState.status, errInvalidState.code, errInvalidState.msg)
	default:
		s.internalError(c, err)
	}
}

// lockedRequest is a request row read under FOR UPDATE.
type lockedRequest struct {
	ID          int64
	PassengerID int64
	Status      string
	TripID      *int64
	DriverID    *int64 // of the assigned trip
}

// lockRequest reads and locks a request; a missing one is errRequestNotFound.
func lockRequest(ctx context.Context, db DB, id int64) (lockedRequest, error) {
	q := lockedRequest{ID: id}
	err := db.QueryRow(ctx, `
		SELECT q.passenger_id, q.status, q.trip_id, t.driver_id
		  FROM ride_requests q LEFT JOIN trips t ON t.id = q.trip_id
		 WHERE q.id = $1 FOR UPDATE OF q`, id).Scan(&q.PassengerID, &q.Status, &q.TripID, &q.DriverID)
	if isNoRows(err) {
		return q, errRequestNotFound
	}
	return q, err
}

// currentRank is the candidate the request is assigned to now: the first undecided candidate
// of its trip after the ones already declined or timed out. Candidates skipped for lack of a
// seat keep a null outcome, so the rank cannot be told from the trip alone.
func currentRank(ctx context.Context, db DB, id, tripID int64) (int, error) {
	var rank int
	err := db.QueryRow(ctx, `
		SELECT rank FROM request_candidates
		 WHERE request_id = $1 AND trip_id = $2 AND outcome IS NULL
		   AND rank > COALESCE((SELECT max(rank) FROM request_candidates
		                         WHERE request_id = $1 AND outcome IN ('declined', 'timed_out', 'trip_ended')), 0)
		 ORDER BY rank LIMIT 1`, id, tripID).Scan(&rank)
	return rank, err
}

// reassign gives up the current assignment of a waiting request (outcome is declined,
// timed_out or trip_ended) and moves it to the next candidate whose seat can be held, or to no_match when
// none is left (REQ-050, DD-12). The new assignment waits for the driver like the first one (DD-13,
// DD-33).
// s.db must be the transaction that holds the request lock.
func (s *Server) reassign(ctx context.Context, q lockedRequest, outcome string) error {
	rank, err := currentRank(ctx, s.db, q.ID, *q.TripID)
	if err != nil {
		return err
	}
	if _, err := releaseHold(ctx, s.db, *q.TripID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `UPDATE request_candidates SET outcome = $3 WHERE request_id = $1 AND rank = $2`,
		q.ID, rank, outcome); err != nil {
		return err
	}
	timeout, err := settings.New(s.db).Get(ctx, "driver_confirm_timeout")
	if err != nil {
		return err
	}

	type next struct {
		tripID   int64
		stopID   *int64
		driverID int64
	}
	rows, err := s.db.Query(ctx, `
		SELECT c.trip_id, c.dropoff_bus_stop_id, t.driver_id
		  FROM request_candidates c JOIN trips t ON t.id = c.trip_id
		 WHERE c.request_id = $1 AND c.rank > $2 AND t.status = 'active' AND NOT t.passed_pickup
		 ORDER BY c.rank`, q.ID, rank)
	if err != nil {
		return err
	}
	var rest []next
	for rows.Next() {
		var n next
		if err := rows.Scan(&n.tripID, &n.stopID, &n.driverID); err != nil {
			rows.Close()
			return err
		}
		rest = append(rest, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, n := range rest {
		held, err := holdSeat(ctx, s.db, n.tripID)
		if err != nil {
			return err
		}
		if !held {
			continue // full or ended meanwhile; its outcome stays empty
		}
		relaxed, err := s.relaxedForDriver(ctx, q.ID, n.driverID)
		if err != nil {
			return err
		}
		if err := transition(ctx, s.db, q.ID, reqWaitingDriver, reqWaitingDriver,
			`trip_id = $4, dropoff_bus_stop_id = $5, relaxed = $6, response_deadline_at = now() + make_interval(secs => $7)`,
			n.tripID, n.stopID, relaxed, timeout); err != nil {
			return err
		}
		return nil
	}
	return transition(ctx, s.db, q.ID, reqWaitingDriver, reqNoMatch,
		`trip_id = NULL, dropoff_bus_stop_id = NULL, relaxed = false, response_deadline_at = NULL`)
}

// relaxedForDriver reports whether the driver lacks a tag the request prefers (REQ-047).
func (s *Server) relaxedForDriver(ctx context.Context, requestID, driverID int64) (bool, error) {
	rows, err := s.db.Query(ctx, `SELECT tag_id, intent FROM request_tag_filters WHERE request_id = $1`, requestID)
	if err != nil {
		return false, err
	}
	var filters []tagFilter
	for rows.Next() {
		var f tagFilter
		if err := rows.Scan(&f.TagID, &f.Intent); err != nil {
			rows.Close()
			return false, err
		}
		filters = append(filters, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}
	tags, err := s.userTagIDs(ctx, driverID)
	if err != nil {
		return false, err
	}
	return relaxedFor(filters, tags), nil
}

// txServer returns a copy of s whose reads and writes go through the transaction db.
func (s *Server) txServer(db DB) *Server {
	ts := *s
	ts.db = db
	return &ts
}

// SweepTimeouts reassigns every waiting request whose response deadline has passed and
// returns how many it moved (DD-13). The deadline in the database is the only timer, so a
// restarted backend picks overdue requests up on its first sweep. Each request is handled in
// its own transaction; one that another transaction holds is left for the next sweep.
func SweepTimeouts(ctx context.Context, db DB) (int, error) {
	s := &Server{db: db}
	rows, err := db.Query(ctx, `
		SELECT id FROM ride_requests
		 WHERE status = 'waiting_driver' AND response_deadline_at <= now() ORDER BY response_deadline_at`)
	if err != nil {
		return 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	moved := 0
	for _, id := range ids {
		done := false
		err := s.inTx(ctx, func(tx DB) error {
			// Re-check under the lock: the driver may have answered since the scan above.
			var locked int64
			err := tx.QueryRow(ctx, `
				SELECT id FROM ride_requests
				 WHERE id = $1 AND status = 'waiting_driver' AND response_deadline_at <= now()
				   FOR UPDATE SKIP LOCKED`, id).Scan(&locked)
			if isNoRows(err) {
				return nil
			}
			if err != nil {
				return err
			}
			q, err := lockRequest(ctx, tx, id)
			if err != nil {
				return err
			}
			done = true
			return s.txServer(tx).reassign(ctx, q, "timed_out")
		})
		if err != nil {
			log.Printf("timeout sweep: request %d: %v", id, err)
			continue
		}
		if done {
			moved++
		}
	}
	return moved, nil
}

// RunTimeoutSweeper sweeps every interval until ctx ends, starting at once so requests that
// went overdue while the backend was down are handled on startup.
func RunTimeoutSweeper(ctx context.Context, db DB, interval time.Duration) {
	for {
		if _, err := SweepTimeouts(ctx, db); err != nil && ctx.Err() == nil {
			log.Printf("timeout sweep: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func requestIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		apiError(c, http.StatusNotFound, "not_found", "找不到這筆請求")
		return 0, false
	}
	return id, true
}

// owns reports whether the caller is a party of the request in the given role: the passenger
// who sent it, or the driver of the trip it is assigned to.
func owns(c *gin.Context, q lockedRequest) bool {
	uid := c.GetInt64(ctxUserID)
	if c.GetString(ctxRole) == roleDriver {
		return q.DriverID != nil && *q.DriverID == uid
	}
	return q.PassengerID == uid
}

// respondRequest handles POST /api/driver/requests/:id/accept and /decline (REQ-049).
func (s *Server) respondRequest(accept bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requestIDParam(c)
		if !ok {
			return
		}
		var view requestView
		err := s.inTx(c, func(tx DB) error {
			q, err := lockRequest(c, tx, id)
			if err != nil {
				return err
			}
			if !owns(c, q) {
				return errRequestNotFound
			}
			if q.Status != reqWaitingDriver {
				return errNotWaiting
			}
			ts := s.txServer(tx)
			if accept {
				rank, err := currentRank(c, tx, id, *q.TripID)
				if err != nil {
					return err
				}
				if err := confirmRequest(c, tx, id, *q.TripID, q.PassengerID, rank); err != nil {
					return err
				}
			} else if err := ts.reassign(c, q, "declined"); err != nil {
				return err
			}
			view, err = ts.loadRequestView(c, id, "", "")
			return err
		})
		if err != nil {
			s.fail(c, err)
			return
		}
		c.JSON(http.StatusOK, view)
	}
}

// boardRequest handles POST …/requests/:id/board for the passenger and the driver (DD-27).
// Whoever comes second finds the request already boarded and gets the same answer.
func (s *Server) boardRequest(c *gin.Context) {
	s.finishRequest(c, func(ts *Server, q lockedRequest) error {
		switch q.Status {
		case reqBoarded:
			return nil
		case reqConfirmed:
			return transition(c, ts.db, q.ID, reqConfirmed, reqBoarded, `boarded_at = now()`)
		}
		return errInvalidState
	})
}

// completeRequest handles POST …/requests/:id/complete for the passenger and the driver
// (REQ-067, DD-23), from confirmed as well as boarded.
func (s *Server) completeRequest(c *gin.Context) {
	s.finishRequest(c, func(ts *Server, q lockedRequest) error {
		switch q.Status {
		case reqCompleted:
			return nil
		case reqConfirmed, reqBoarded:
			return ts.complete(c, q)
		}
		return errInvalidState
	})
}

// finishRequest runs op on a locked request the caller is a party of, then answers with it.
func (s *Server) finishRequest(c *gin.Context, op func(ts *Server, q lockedRequest) error) {
	id, ok := requestIDParam(c)
	if !ok {
		return
	}
	var view requestView
	err := s.inTx(c, func(tx DB) error {
		q, err := lockRequest(c, tx, id)
		if err != nil {
			return err
		}
		if !owns(c, q) {
			return errRequestNotFound
		}
		ts := s.txServer(tx)
		if err := op(ts, q); err != nil {
			return err
		}
		view, err = ts.loadRequestView(c, id, "", "")
		return err
	})
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

// complete ends a ride: the seat is given back, the service record is written (REQ-055) and the
// driver earns the ride's points (REQ-072).
// s.db must be the transaction that holds the request lock.
func (s *Server) complete(ctx context.Context, q lockedRequest) error {
	if err := transition(ctx, s.db, q.ID, q.Status, reqCompleted, `completed_at = now()`); err != nil {
		return err
	}
	if ok, err := releaseConfirmed(ctx, s.db, *q.TripID); err != nil || !ok {
		if err == nil {
			err = errors.New("trip lost the confirmed seat of a completing request")
		}
		return err
	}
	var recordID, driverID int64
	err := s.db.QueryRow(ctx, `
		INSERT INTO service_records (request_id, trip_id, driver_id, passenger_id, pickup_point_id, dropoff_bus_stop_id,
		                             dropoff_name, dropoff_lat, dropoff_lng, picked_up_at, completed_at)
		SELECT q.id, q.trip_id, t.driver_id, q.passenger_id, q.pickup_point_id, q.dropoff_bus_stop_id,
		       COALESCE(b.name, t.destination_name), COALESCE(b.lat, t.destination_lat), COALESCE(b.lng, t.destination_lng),
		       q.boarded_at, q.completed_at
		  FROM ride_requests q JOIN trips t ON t.id = q.trip_id LEFT JOIN bus_stops b ON b.id = q.dropoff_bus_stop_id
		 WHERE q.id = $1
		RETURNING id, driver_id`, q.ID).Scan(&recordID, &driverID)
	if err != nil {
		return err
	}
	// REQ-006, REQ-007, DD-19: the finished ride feeds the usual data, in the same transaction.
	if err := recomputeUsualData(ctx, s.db, driverID, q.PassengerID); err != nil {
		return err
	}
	// REQ-072, DD-34: the driver is credited for this ride in the same transaction too.
	return creditRide(ctx, s.db, driverID, recordID)
}
