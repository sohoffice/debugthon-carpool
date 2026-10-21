package server

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

// busStopOffsetM is how far from the route a bus stop may be and still count as along it.
const busStopOffsetM = 50

type tagFilterBody struct {
	TagID  int64  `json:"tag_id"`
	Intent string `json:"intent"`
}

type tagFilterView struct {
	TagID  int64  `json:"tag_id"`
	Name   string `json:"name,omitempty"`
	Intent string `json:"intent"`
}

type routeView struct {
	Polyline  string    `json:"polyline"`
	DistanceM int       `json:"distance_m"`
	DurationS int       `json:"duration_s"`
	Simulated bool      `json:"simulated"`
	BusStops  []busStop `json:"bus_stops"`
}

type tripView struct {
	ID             int64           `json:"id"`
	DriverID       int64           `json:"driver_id"`
	Status         string          `json:"status"`
	PickupPoint    pickupPoint     `json:"pickup_point"`
	Destination    place           `json:"destination"`
	Capacity       int             `json:"capacity"`
	SeatsHeld      int             `json:"seats_held"`
	SeatsConfirmed int             `json:"seats_confirmed"`
	SeatsAvailable int             `json:"seats_available"`
	AutoAccept     bool            `json:"auto_accept"`
	SettingsLocked bool            `json:"settings_locked"`
	PassedPickup   bool            `json:"passed_pickup"`
	TagFilters     []tagFilterView `json:"tag_filters"`
	Route          *routeView      `json:"route"`
	StartedAt      *time.Time      `json:"started_at"`
	EndedAt        *time.Time      `json:"ended_at"`
	// Rides completed on this trip, so far or in all once it ended (the driver UI's trip-ended screen).
	CompletedRides int `json:"completed_rides"`
}

// departBody is the departure confirmation (REQ-015): destination, capacity, pickup point,
// tag filters with intent, and auto-accept.
type departBody struct {
	PickupPointID *int64 `json:"pickup_point_id"`
	Destination   *struct {
		Name string   `json:"name"`
		Lat  *float64 `json:"lat"`
		Lng  *float64 `json:"lng"`
	} `json:"destination"`
	Capacity   *int            `json:"capacity"`
	AutoAccept bool            `json:"auto_accept"`
	TagFilters []tagFilterBody `json:"tag_filters"`
	// PreviewID is the route preview to depart with (DD-21); without it the route is planned now.
	PreviewID *int64 `json:"preview_id"`
}

func validTagFilters(filters []tagFilterBody) bool {
	seen := map[int64]bool{}
	for _, f := range filters {
		if (f.Intent != "required" && f.Intent != "preferred") || seen[f.TagID] {
			return false
		}
		seen[f.TagID] = true
	}
	return true
}

// tagsExist reports whether every filter names a tag from the predefined list (DD-05).
func (s *Server) tagsExist(ctx context.Context, db DB, filters []tagFilterBody) (bool, error) {
	ids := make([]int64, len(filters))
	for i, f := range filters {
		ids[i] = f.TagID
	}
	var n int
	err := db.QueryRow(ctx, `SELECT count(*) FROM tags WHERE id = ANY($1)`, ids).Scan(&n)
	return n == len(filters), err
}

func (s *Server) inTx(ctx context.Context, fn func(DB) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// depart starts the driver's trip (REQ-015). Departing is also the driver declaring they take
// part today, so the trip, its route, its locked settings and the driver's activity are created
// together (DD-07, DD-21, DD-25).
func (s *Server) depart(c *gin.Context) {
	var body departBody
	if err := c.ShouldBindJSON(&body); err != nil || body.PickupPointID == nil || body.Destination == nil ||
		body.Destination.Name == "" || body.Destination.Lat == nil || body.Destination.Lng == nil ||
		*body.Destination.Lat < -90 || *body.Destination.Lat > 90 || *body.Destination.Lng < -180 || *body.Destination.Lng > 180 ||
		body.Capacity == nil || *body.Capacity < 1 || !validTagFilters(body.TagFilters) {
		apiError(c, http.StatusBadRequest, "invalid_request",
			"需要 pickup_point_id、destination（name、lat、lng）、大於 0 的 capacity，tag_filters 的 intent 為 required 或 preferred 且不可重複")
		return
	}
	driverID := c.GetInt64(ctxUserID)
	dest := latLng{*body.Destination.Lat, *body.Destination.Lng}

	pickup, ok := s.checkRoutePoints(c, *body.PickupPointID, dest)
	if !ok {
		return
	}
	if ok, err := s.tagsExist(c, s.db, body.TagFilters); err != nil {
		s.internalError(c, err)
		return
	} else if !ok {
		apiError(c, http.StatusBadRequest, "invalid_tag", "標籤不在清單中")
		return
	}

	var active bool
	if err := s.db.QueryRow(c, `SELECT EXISTS (SELECT 1 FROM trips WHERE driver_id = $1 AND status = 'active')`, driverID).Scan(&active); err != nil {
		s.internalError(c, err)
		return
	}
	if active {
		apiError(c, http.StatusConflict, "already_active", "駕駛已有進行中的行程")
		return
	}

	// Without a preview the route is planned before the transaction, which would otherwise hold
	// a connection while waiting for the route provider.
	var plan plannedRoute
	if body.PreviewID == nil {
		route, stopIDs, err := s.planRoute(c, pickup, dest)
		if err != nil {
			s.internalError(c, err)
			return
		}
		plan = plannedRoute{route, stopIDs}
	}

	var tripID int64
	err := s.inTx(c, func(db DB) error {
		if body.PreviewID != nil {
			var err error
			if plan, err = usePreview(c, db, *body.PreviewID, driverID, *body.PickupPointID, dest); err != nil {
				return err
			}
		}
		route, stopIDs := plan.route, plan.stopIDs
		if err := db.QueryRow(c, `
			INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
			                   capacity, auto_accept, status, settings_locked, started_at,
			                   route_polyline, route_distance_m, route_duration_s, route_simulated)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', true, now(), $8, $9, $10, $11)
			RETURNING id`,
			driverID, *body.PickupPointID, body.Destination.Name, dest.Lat, dest.Lng, *body.Capacity, body.AutoAccept,
			route.Polyline, route.DistanceM, route.DurationS, route.Simulated).Scan(&tripID); err != nil {
			return err
		}
		if err := storeStops(c, db, tripID, stopIDs); err != nil {
			return err
		}
		if err := storeTagFilters(c, db, tripID, body.TagFilters); err != nil {
			return err
		}
		_, err := db.Exec(c, `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2)`, driverID, tripID)
		return err
	})
	if errors.Is(err, errInvalidPreview) {
		apiError(c, http.StatusBadRequest, "invalid_route_preview", "路線預覽不存在、已使用，或與出發的上車點、目的地不符，請重新預覽")
		return
	}
	if isUniqueViolation(err) {
		apiError(c, http.StatusConflict, "already_active", "駕駛已有進行中的行程")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	s.respondTrip(c, http.StatusCreated, tripID)
}

func storeStops(ctx context.Context, db DB, tripID int64, stopIDs []int64) error {
	for i, id := range stopIDs {
		if _, err := db.Exec(ctx, `INSERT INTO trip_route_stops (trip_id, seq, bus_stop_id) VALUES ($1, $2, $3)`,
			tripID, i+1, id); err != nil {
			return err
		}
	}
	return nil
}

func storeTagFilters(ctx context.Context, db DB, tripID int64, filters []tagFilterBody) error {
	for _, f := range filters {
		if _, err := db.Exec(ctx, `INSERT INTO trip_tag_filters (trip_id, tag_id, intent) VALUES ($1, $2, $3)`,
			tripID, f.TagID, f.Intent); err != nil {
			return err
		}
	}
	return nil
}

// planRoute asks the provider for the pickup -> destination route and finds the bus stops along it.
func (s *Server) planRoute(ctx context.Context, from, to latLng) (Route, []int64, error) {
	route, err := s.routes.Route(ctx, from, to)
	if err != nil {
		return Route{}, nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT id, lat, lng FROM bus_stops`)
	if err != nil {
		return Route{}, nil, err
	}
	defer rows.Close()
	var stops []stopPos
	for rows.Next() {
		var sp stopPos
		if err := rows.Scan(&sp.ID, &sp.Pos.Lat, &sp.Pos.Lng); err != nil {
			return Route{}, nil, err
		}
		stops = append(stops, sp)
	}
	return route, stopsAlong(route.Points, stops, busStopOffsetM), rows.Err()
}

// ensureRoute builds and stores the route of a trip that has none, such as a simulated trip
// created with SQL (DD-21). It returns pgx.ErrNoRows for an unknown trip.
func (s *Server) ensureRoute(ctx context.Context, tripID int64) error {
	var pickup, dest latLng
	var has bool
	err := s.db.QueryRow(ctx, `
		SELECT p.lat, p.lng, t.destination_lat, t.destination_lng, t.route_polyline IS NOT NULL
		  FROM trips t JOIN pickup_points p ON p.id = t.pickup_point_id WHERE t.id = $1`, tripID).
		Scan(&pickup.Lat, &pickup.Lng, &dest.Lat, &dest.Lng, &has)
	if err != nil || has {
		return err
	}
	route, stopIDs, err := s.planRoute(ctx, pickup, dest)
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(db DB) error {
		// Two first uses may race; only the one that finds the route still empty stores stops.
		tag, err := db.Exec(ctx, `
			UPDATE trips SET route_polyline = $2, route_distance_m = $3, route_duration_s = $4, route_simulated = $5
			 WHERE id = $1 AND route_polyline IS NULL`,
			tripID, route.Polyline, route.DistanceM, route.DurationS, route.Simulated)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return storeStops(ctx, db, tripID, stopIDs)
	})
}

// loadTrip assembles the trip with its tag filters, route and the bus stops along it.
func (s *Server) loadTrip(ctx context.Context, tripID int64) (tripView, error) {
	var v tripView
	var polyline *string
	var distance, duration *int
	var simulated *bool
	err := s.db.QueryRow(ctx, `
		SELECT t.id, t.driver_id, t.status, p.id, p.name, p.lat, p.lng, p.radius_m,
		       t.destination_name, t.destination_lat, t.destination_lng,
		       t.capacity, t.seats_held, t.seats_confirmed, t.auto_accept, t.settings_locked, t.passed_pickup,
		       t.route_polyline, t.route_distance_m, t.route_duration_s, t.route_simulated, t.started_at, t.ended_at,
		       (SELECT count(*) FROM service_records s WHERE s.trip_id = t.id)
		  FROM trips t JOIN pickup_points p ON p.id = t.pickup_point_id WHERE t.id = $1`, tripID).
		Scan(&v.ID, &v.DriverID, &v.Status, &v.PickupPoint.ID, &v.PickupPoint.Name, &v.PickupPoint.Lat, &v.PickupPoint.Lng,
			&v.PickupPoint.RadiusM, &v.Destination.Name, &v.Destination.Lat, &v.Destination.Lng,
			&v.Capacity, &v.SeatsHeld, &v.SeatsConfirmed, &v.AutoAccept, &v.SettingsLocked, &v.PassedPickup,
			&polyline, &distance, &duration, &simulated, &v.StartedAt, &v.EndedAt, &v.CompletedRides)
	if err != nil {
		return v, err
	}
	v.SeatsAvailable = v.Capacity - v.SeatsHeld - v.SeatsConfirmed

	v.TagFilters = []tagFilterView{}
	rows, err := s.db.Query(ctx, `
		SELECT f.tag_id, g.name, f.intent FROM trip_tag_filters f JOIN tags g ON g.id = f.tag_id
		 WHERE f.trip_id = $1 ORDER BY f.tag_id`, tripID)
	if err != nil {
		return v, err
	}
	for rows.Next() {
		var f tagFilterView
		if err := rows.Scan(&f.TagID, &f.Name, &f.Intent); err != nil {
			rows.Close()
			return v, err
		}
		v.TagFilters = append(v.TagFilters, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return v, err
	}

	if polyline == nil {
		return v, nil
	}
	v.Route = &routeView{Polyline: *polyline, DistanceM: *distance, DurationS: *duration, Simulated: *simulated, BusStops: []busStop{}}
	rows, err = s.db.Query(ctx, `
		SELECT b.id, b.stop_id, b.name, b.lat, b.lng
		  FROM trip_route_stops r JOIN bus_stops b ON b.id = r.bus_stop_id
		 WHERE r.trip_id = $1 ORDER BY r.seq`, tripID)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var b busStop
		if err := rows.Scan(&b.ID, &b.StopID, &b.Name, &b.Lat, &b.Lng); err != nil {
			return v, err
		}
		v.Route.BusStops = append(v.Route.BusStops, b)
	}
	return v, rows.Err()
}

func (s *Server) respondTrip(c *gin.Context, status int, tripID int64) {
	v, err := s.loadTrip(c, tripID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(status, v)
}

// showTrip makes sure the trip has a route, then returns it with the route and bus stops.
func (s *Server) showTrip(c *gin.Context, tripID int64) {
	if err := s.ensureRoute(c, tripID); isNoRows(err) {
		apiError(c, http.StatusNotFound, "not_found", "找不到這個行程")
		return
	} else if err != nil {
		s.internalError(c, err)
		return
	}
	s.respondTrip(c, http.StatusOK, tripID)
}

func tripIDParam(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		apiError(c, http.StatusBadRequest, "bad_request", "行程編號格式錯誤")
		return 0, false
	}
	return id, true
}

// getTrip returns any trip, for the map (REQ-003).
func (s *Server) getTrip(c *gin.Context) {
	if id, ok := tripIDParam(c); ok {
		s.showTrip(c, id)
	}
}

// currentTrip returns the driver's active trip.
func (s *Server) currentTrip(c *gin.Context) {
	var id int64
	err := s.db.QueryRow(c, `SELECT id FROM trips WHERE driver_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1`,
		c.GetInt64(ctxUserID)).Scan(&id)
	if isNoRows(err) {
		apiError(c, http.StatusNotFound, "not_found", "目前沒有進行中的行程")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	s.showTrip(c, id)
}

type defaultsView struct {
	PickupPointID *int64          `json:"pickup_point_id"`
	Destination   *place          `json:"destination"`
	Capacity      *int            `json:"capacity"`
	AutoAccept    bool            `json:"auto_accept"`
	TagFilters    []tagFilterView `json:"tag_filters"`
}

// tripDefaults returns the settings of the driver's last departure, to prefill the next one (REQ-016).
// Everything is empty for a driver who has never departed.
func (s *Server) tripDefaults(c *gin.Context) {
	out := defaultsView{TagFilters: []tagFilterView{}}
	var tripID int64
	var name string
	var lat, lng float64
	var pickupID int64
	var capacity int
	err := s.db.QueryRow(c, `
		SELECT id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, auto_accept
		  FROM trips WHERE driver_id = $1 ORDER BY id DESC LIMIT 1`, c.GetInt64(ctxUserID)).
		Scan(&tripID, &pickupID, &name, &lat, &lng, &capacity, &out.AutoAccept)
	if isNoRows(err) {
		c.JSON(http.StatusOK, out)
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}
	out.PickupPointID, out.Destination, out.Capacity = &pickupID, &place{Name: name, Lat: lat, Lng: lng}, &capacity

	rows, err := s.db.Query(c, `SELECT tag_id, intent FROM trip_tag_filters WHERE trip_id = $1 ORDER BY tag_id`, tripID)
	if err != nil {
		s.internalError(c, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var f tagFilterView
		if err := rows.Scan(&f.TagID, &f.Intent); err != nil {
			s.internalError(c, err)
			return
		}
		out.TagFilters = append(out.TagFilters, f)
	}
	if err := rows.Err(); err != nil {
		s.internalError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
