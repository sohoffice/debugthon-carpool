package server

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

type activity struct {
	ID        int64     `json:"id"`
	Role      string    `json:"role"`
	TripID    *int64    `json:"trip_id"`
	CreatedAt time.Time `json:"created_at"`
}

// createActivity records that the caller takes part today (DD-25): the
// master record their location reports go to. A driver's activity is linked to
// their active trip, so a driver must have one (409 otherwise); a passenger's is
// linked later, when a request is confirmed. Declaring again starts a new
// activity; the server never tracks when one ends.
func (s *Server) createActivity(c *gin.Context) {
	userID, role := c.GetInt64(ctxUserID), c.GetString(ctxRole)

	var tripID *int64
	if role == roleDriver {
		var id int64
		err := s.db.QueryRow(c, `
			SELECT id FROM trips WHERE driver_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`, userID).Scan(&id)
		if isNoRows(err) {
			apiError(c, http.StatusConflict, "no_active_trip", "駕駛目前沒有進行中的行程")
			return
		}
		if err != nil {
			s.internalError(c, err)
			return
		}
		tripID = &id
	}

	var a activity
	err := s.db.QueryRow(c, `
		INSERT INTO activities (user_id, role, trip_id) VALUES ($1, $2, $3)
		RETURNING id, role, trip_id, created_at`, userID, role, tripID).Scan(&a.ID, &a.Role, &a.TripID, &a.CreatedAt)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusCreated, a)
}

type locationBody struct {
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
}

type locationReport struct {
	ID         int64     `json:"id"`
	ActivityID int64     `json:"activity_id"`
	TripID     *int64    `json:"trip_id"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	ReportedAt time.Time `json:"reported_at"`
	// Only set on a driver's report that belongs to a trip: whether the trip has
	// passed its pickup point, and whether the trip is over (DD-30).
	PassedPickup *bool `json:"passed_pickup,omitempty"`
	TripEnded    *bool `json:"trip_ended,omitempty"`
}

// reportLocation is the single position API for drivers and passengers (DD-08).
// Every accepted report is stored as sent and never discarded (DD-06), under the
// caller's latest activity; with none the report is refused (409). A driver's
// report may flip passed_pickup on the activity's trip, which never flips back,
// and after that may end the trip on arrival at its destination (DD-30).
func (s *Server) reportLocation(c *gin.Context) {
	var body locationBody
	if err := c.ShouldBindJSON(&body); err != nil || body.Lat == nil || body.Lng == nil ||
		*body.Lat < -90 || *body.Lat > 90 || *body.Lng < -180 || *body.Lng > 180 {
		apiError(c, http.StatusBadRequest, "invalid_location", "需要有效的 lat（-90～90）與 lng（-180～180）")
		return
	}

	var act activity
	err := s.db.QueryRow(c, `
		SELECT id, role, trip_id, created_at FROM activities WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
		c.GetInt64(ctxUserID)).Scan(&act.ID, &act.Role, &act.TripID, &act.CreatedAt)
	if isNoRows(err) {
		apiError(c, http.StatusConflict, "no_activity", "請先表示今天要參與，再回報位置")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}

	r := locationReport{ActivityID: act.ID, TripID: act.TripID}
	err = s.db.QueryRow(c, `
		INSERT INTO location_reports (activity_id, lat, lng) VALUES ($1, $2, $3)
		RETURNING id, lat, lng, reported_at`, act.ID, *body.Lat, *body.Lng).Scan(&r.ID, &r.Lat, &r.Lng, &r.ReportedAt)
	if err != nil {
		s.internalError(c, err)
		return
	}

	if act.Role == roleDriver && act.TripID != nil {
		passed, err := s.updatePassedPickup(c, *act.TripID)
		if err != nil {
			s.internalError(c, err)
			return
		}
		r.PassedPickup = &passed
		ended, err := s.checkArrival(c, *act.TripID, latLng{r.Lat, r.Lng})
		if err != nil {
			s.internalError(c, err)
			return
		}
		r.TripEnded = &ended
	}
	c.JSON(http.StatusCreated, r)
}

// updatePassedPickup re-evaluates the driver's report history on the trip and
// latches passed_pickup once the vehicle has entered and left the pickup range.
// It returns the trip's resulting flag; once set it is never cleared.
func (s *Server) updatePassedPickup(c *gin.Context, tripID int64) (bool, error) {
	var passed bool
	var pickup latLng
	var radiusM float64
	err := s.db.QueryRow(c, `
		SELECT t.passed_pickup, p.lat, p.lng, p.radius_m
		  FROM trips t JOIN pickup_points p ON p.id = t.pickup_point_id
		 WHERE t.id = $1`, tripID).Scan(&passed, &pickup.Lat, &pickup.Lng, &radiusM)
	if err != nil || passed {
		return passed, err
	}

	rows, err := s.db.Query(c, `
		SELECT r.lat, r.lng FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.trip_id = $1 AND a.role = 'driver' ORDER BY r.id`, tripID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	var points []latLng
	for rows.Next() {
		var p latLng
		if err := rows.Scan(&p.Lat, &p.Lng); err != nil {
			return false, err
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	rows.Close()

	marginM, err := settings.New(s.db).Get(c, "pass_margin")
	if err != nil {
		return false, err
	}
	if !passedPickup(pickup, radiusM, marginM, points) {
		return false, nil
	}
	_, err = s.db.Exec(c, `
		UPDATE trips SET passed_pickup = true, passed_pickup_at = now()
		 WHERE id = $1 AND NOT passed_pickup`, tripID)
	return err == nil, err
}

// listMyLocationReports returns every report the caller has sent, oldest first.
func (s *Server) listMyLocationReports(c *gin.Context) {
	rows, err := s.db.Query(c, `
		SELECT r.id, r.activity_id, a.trip_id, r.lat, r.lng, r.reported_at
		  FROM location_reports r JOIN activities a ON a.id = r.activity_id
		 WHERE a.user_id = $1 ORDER BY r.id`, c.GetInt64(ctxUserID))
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	out := []locationReport{}
	for rows.Next() {
		var r locationReport
		if err := rows.Scan(&r.ID, &r.ActivityID, &r.TripID, &r.Lat, &r.Lng, &r.ReportedAt); err != nil {
			s.internalError(c, err)
			return
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
