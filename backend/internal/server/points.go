package server

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

// Driver points (REQ-071..REQ-075, DD-34). Only the driver API reads them; no passenger response
// selects from driver_profiles or driver_point_ledger (REQ-075).

const (
	defaultPointsLimit = 5 // the drawer shows the latest 5 (DD-35)
	maxPointsLimit     = 50
)

// creditRide gives the driver points_per_ride for the ride behind serviceRecordID (REQ-072, DD-34).
// db must be the transaction that writes the service record, so the balance and the ledger change
// together. A driver without a driver_profiles row gets one here. The unique service_record_id
// keeps one ride from being credited twice.
func creditRide(ctx context.Context, db DB, driverID, serviceRecordID int64) error {
	perRide, err := settings.New(db).Get(ctx, "points_per_ride")
	if err != nil {
		return err
	}
	delta := int(perRide)
	if _, err := db.Exec(ctx, `
		INSERT INTO driver_point_ledger (driver_id, delta, reason, service_record_id) VALUES ($1, $2, 'ride', $3)`,
		driverID, delta, serviceRecordID); err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO driver_profiles (user_id, point_balance) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET point_balance = driver_profiles.point_balance + $2`,
		driverID, delta)
	return err
}

type pointEntry struct {
	Delta           int       `json:"delta"`
	Reason          string    `json:"reason"`
	ServiceRecordID *int64    `json:"service_record_id"`
	CreatedAt       time.Time `json:"created_at"`
}

// getDriverPoints returns the caller's latest ledger rows, newest first (REQ-074, DD-35).
// The optional limit defaults to 5.
func (s *Server) getDriverPoints(c *gin.Context) {
	limit := defaultPointsLimit
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxPointsLimit {
			apiError(c, http.StatusBadRequest, "invalid_request", "limit 須為 1 到 50 的整數")
			return
		}
		limit = n
	}
	rows, err := s.db.Query(c, `
		SELECT delta, reason, service_record_id, created_at FROM driver_point_ledger
		 WHERE driver_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, c.GetInt64(ctxUserID), limit)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	entries := []pointEntry{}
	for rows.Next() {
		var e pointEntry
		if err := rows.Scan(&e.Delta, &e.Reason, &e.ServiceRecordID, &e.CreatedAt); err != nil {
			s.internalError(c, err)
			return
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"points": entries})
}
