package server

import (
	"context"
	"fmt"

	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// checkArrival ends the trip when a driver report, made after the car passed its pickup point,
// lies within the arrival radius of the trip's destination (REQ-070, DD-30). The radius is read
// on every report (DD-20). It reports whether the trip is over after this report.
func (s *Server) checkArrival(ctx context.Context, tripID int64, at latLng) (bool, error) {
	var status string
	var passed bool
	var dest latLng
	if err := s.db.QueryRow(ctx, `
		SELECT status, passed_pickup, destination_lat, destination_lng FROM trips WHERE id = $1`, tripID).
		Scan(&status, &passed, &dest.Lat, &dest.Lng); err != nil {
		return false, err
	}
	if status != "active" {
		return status == "completed", nil
	}
	if !passed {
		return false, nil
	}
	radiusM, err := settings.New(s.db).Get(ctx, "arrival_radius")
	if err != nil {
		return false, err
	}
	if distanceM(dest, at) > radiusM {
		return false, nil
	}
	return true, s.endTrip(ctx, tripID)
}

// endTrip completes an active trip and, in the same transaction, settles its requests (DD-30):
// rides still confirmed or boarded are completed with their service records and usual data
// (REQ-067, DD-23), and requests still waiting for this driver move to the next car (REQ-050).
// Ending a trip that is no longer active does nothing, so two arriving reports end it once.
func (s *Server) endTrip(ctx context.Context, tripID int64) error {
	return s.inTx(ctx, func(tx DB) error {
		// The request flow locks a request before its trip's seats; lock in the same order.
		if _, err := lockOpenRequests(ctx, tx, tripID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1 AND status = 'active'`, tripID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		// Read again: a request may have been assigned while this transaction waited for the trip.
		ids, err := lockOpenRequests(ctx, tx, tripID)
		if err != nil {
			return err
		}
		ts := s.txServer(tx)
		for _, id := range ids {
			q, err := lockRequest(ctx, tx, id)
			if err != nil {
				return err
			}
			switch q.Status {
			case reqConfirmed, reqBoarded:
				err = ts.complete(ctx, q)
			case reqWaitingDriver:
				err = ts.reassign(ctx, q, "trip_ended")
			}
			if err != nil {
				return fmt.Errorf("end trip %d: request %d: %w", tripID, id, err)
			}
		}
		return nil
	})
}

// lockOpenRequests locks the trip's requests that are not finished, in id order.
func lockOpenRequests(ctx context.Context, db DB, tripID int64) ([]int64, error) {
	rows, err := db.Query(ctx, `
		SELECT id FROM ride_requests
		 WHERE trip_id = $1 AND status IN ('waiting_driver', 'confirmed', 'boarded')
		 ORDER BY id FOR UPDATE`, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
