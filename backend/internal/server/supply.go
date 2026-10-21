package server

import (
	"context"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Supply query (REQ-024..REQ-033, DD-10): the cars a passenger could be assigned at one pickup
// point. It screens with the matching engine's eligible() and stops there: no ranking, no
// assignment and no way to pick a car (REQ-031).

type supplyCar struct {
	TripID         int64 `json:"trip_id"`
	ETAS           int   `json:"eta_s"`
	ETASimulated   bool  `json:"eta_simulated"`
	SeatsAvailable int   `json:"seats_available"`
}

type supplyCard struct {
	Count            int   `json:"count"`
	FastestETAS      *int  `json:"fastest_eta_s"`
	FastestSimulated *bool `json:"fastest_eta_simulated"` // null without a car (REQ-063)
	SeatsRemaining   int   `json:"seats_remaining"`
}

type supplyView struct {
	PickupPoint pickupPoint `json:"pickup_point"`
	Destination place       `json:"destination"`
	StopIDs     []int64     `json:"accepted_stop_ids"`
	Card        supplyCard  `json:"card"`
	// TimelineRangeS is the wait limit: the timeline runs from now to then (REQ-030).
	TimelineRangeS int         `json:"timeline_range_s"`
	Cars           []supplyCar `json:"cars"` // soonest first
}

// parseIDs reads a comma-separated list of ids; an empty string is an empty list.
func parseIDs(raw string) ([]int64, bool) {
	var ids []int64
	if raw == "" {
		return ids, true
	}
	seen := map[int64]bool{}
	for _, part := range strings.Split(raw, ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil {
			return nil, false
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids, true
}

// getSupply answers the passenger's polling. Query: pickup_point_id (required), dest_lat and
// dest_lng, stop_ids (bus_stops.id, comma-separated), required_tags and preferred_tags
// (comma-separated tag ids). A missing destination or stop list falls back to the passenger's
// habitual data (REQ-025); if either is still missing the query is refused (REQ-024).
func (s *Server) getSupply(c *gin.Context) {
	userID := c.GetInt64(ctxUserID)
	bad := func(msg string) { apiError(c, http.StatusBadRequest, "invalid_request", msg) }

	pickupID, err := strconv.ParseInt(c.Query("pickup_point_id"), 10, 64)
	if err != nil {
		bad("需要 pickup_point_id")
		return
	}
	var pickup pickupPoint
	err = s.db.QueryRow(c, `SELECT id, name, lat, lng, radius_m FROM pickup_points WHERE id = $1`, pickupID).
		Scan(&pickup.ID, &pickup.Name, &pickup.Lat, &pickup.Lng, &pickup.RadiusM)
	if isNoRows(err) {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}

	// Habitual data first, then whatever the query overrides.
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
	if c.Query("dest_lat") != "" || c.Query("dest_lng") != "" {
		lat, errLat := strconv.ParseFloat(c.Query("dest_lat"), 64)
		lng, errLng := strconv.ParseFloat(c.Query("dest_lng"), 64)
		if errLat != nil || errLng != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
			bad("dest_lat 與 dest_lng 需同時提供且為有效座標")
			return
		}
		dest = &place{Name: c.Query("dest_name"), Lat: lat, Lng: lng}
	}
	if dest == nil {
		apiError(c, http.StatusBadRequest, "destination_required", "需要最終目的地")
		return
	}

	stopIDs, ok := parseIDs(c.Query("stop_ids"))
	if !ok {
		bad("stop_ids 格式錯誤")
		return
	}
	if len(stopIDs) == 0 {
		stopIDs, err = s.habitualStopIDs(c, userID)
		if err != nil {
			s.internalError(c, err)
			return
		}
	} else {
		var n int
		if err := s.db.QueryRow(c, `SELECT count(*) FROM bus_stops WHERE id = ANY($1)`, stopIDs).Scan(&n); err != nil {
			s.internalError(c, err)
			return
		}
		if n != len(stopIDs) {
			apiError(c, http.StatusBadRequest, "invalid_stop", "公車站不在清單中")
			return
		}
	}
	if len(stopIDs) == 0 {
		apiError(c, http.StatusBadRequest, "stops_required", "需要至少一個可接受的下車公車站")
		return
	}

	filters, ok := s.parseSupplyFilters(c)
	if !ok {
		return
	}

	params, err := loadMatchParams(c, s.db)
	if err != nil {
		s.internalError(c, err)
		return
	}
	var myTags []int64
	if myTags, err = s.userTagIDs(c, userID); err != nil {
		s.internalError(c, err)
		return
	}
	req := matchRequest{PickupPointID: pickupID, Destination: latLng{dest.Lat, dest.Lng},
		AcceptedStops: stopIDs, Filters: filters, Tags: myTags}

	trips, err := s.loadMatchTrips(c, c, pickupID)
	if err != nil {
		s.internalError(c, err)
		return
	}

	view := supplyView{PickupPoint: pickup, Destination: *dest, StopIDs: stopIDs,
		TimelineRangeS: int(math.Round(params.WaitLimitS)), Cars: []supplyCar{}}
	for _, t := range trips {
		if !eligible(params, req, t) { // the one screening shared with matching (DD-10)
			continue
		}
		view.Cars = append(view.Cars, supplyCar{TripID: t.ID, ETAS: *t.ETASeconds, ETASimulated: t.ETASimulated,
			SeatsAvailable: t.Capacity - t.SeatsHeld - t.SeatsConfirmed})
	}
	sort.SliceStable(view.Cars, func(i, j int) bool { return view.Cars[i].ETAS < view.Cars[j].ETAS })
	view.Card.Count = len(view.Cars)
	for _, car := range view.Cars {
		view.Card.SeatsRemaining += car.SeatsAvailable
	}
	if len(view.Cars) > 0 {
		view.Card.FastestETAS = &view.Cars[0].ETAS
		view.Card.FastestSimulated = &view.Cars[0].ETASimulated
	}
	c.JSON(http.StatusOK, view)
}

// parseSupplyFilters reads the passenger's tag filters, writing the 400 itself on a bad one.
func (s *Server) parseSupplyFilters(c *gin.Context) ([]tagFilter, bool) {
	var body []tagFilterBody
	for _, kv := range []struct{ key, intent string }{{"required_tags", "required"}, {"preferred_tags", "preferred"}} {
		ids, ok := parseIDs(c.Query(kv.key))
		if !ok {
			apiError(c, http.StatusBadRequest, "invalid_request", kv.key+" 格式錯誤")
			return nil, false
		}
		for _, id := range ids {
			body = append(body, tagFilterBody{TagID: id, Intent: kv.intent})
		}
	}
	if !validTagFilters(body) {
		apiError(c, http.StatusBadRequest, "invalid_request", "同一個標籤不可同時列為必要與建議")
		return nil, false
	}
	if len(body) > 0 {
		if ok, err := s.tagsExist(c, s.db, body); err != nil {
			s.internalError(c, err)
			return nil, false
		} else if !ok {
			apiError(c, http.StatusBadRequest, "invalid_tag", "標籤不在清單中")
			return nil, false
		}
	}
	out := make([]tagFilter, len(body))
	for i, f := range body {
		out[i] = tagFilter{TagID: f.TagID, Intent: f.Intent}
	}
	return out, true
}

func (s *Server) habitualStopIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := s.db.Query(ctx, `SELECT bus_stop_id FROM passenger_accepted_stops WHERE user_id = $1 ORDER BY bus_stop_id`, userID)
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

func (s *Server) userTagIDs(ctx context.Context, userID int64) ([]int64, error) {
	rows, err := s.db.Query(ctx, `SELECT tag_id FROM user_tags WHERE user_id = $1`, userID)
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

// loadMatchTrips reads the active trips at a pickup point as the matching engine sees them.
// A trip whose route or ETA cannot be produced is logged and left out, like a provider error
// in rankRequest, so one bad trip does not hide the others.
func (s *Server) loadMatchTrips(ctx, estCtx context.Context, pickupID int64) ([]matchTrip, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, driver_id, passed_pickup, destination_lat, destination_lng,
		       capacity, seats_held, seats_confirmed
		  FROM trips WHERE status = 'active' AND pickup_point_id = $1 ORDER BY id`, pickupID)
	if err != nil {
		return nil, err
	}
	var trips []matchTrip
	var drivers []int64
	for rows.Next() {
		t := matchTrip{PickupPointID: pickupID, Active: true}
		var driver int64
		if err := rows.Scan(&t.ID, &driver, &t.PassedPickup, &t.Destination.Lat, &t.Destination.Lng,
			&t.Capacity, &t.SeatsHeld, &t.SeatsConfirmed); err != nil {
			rows.Close()
			return nil, err
		}
		trips = append(trips, t)
		drivers = append(drivers, driver)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := trips[:0]
	for i, t := range trips {
		if err := s.fillMatchTrip(ctx, estCtx, &t, drivers[i]); err != nil {
			log.Printf("supply: trip %d left out: %v", t.ID, err)
			continue
		}
		out = append(out, t)
	}
	return out, nil
}

func (s *Server) fillMatchTrip(ctx, estCtx context.Context, t *matchTrip, driverID int64) error {
	if err := s.ensureRoute(ctx, t.ID); err != nil { // simulated trips get their stops on first use (DD-21)
		return err
	}
	rows, err := s.db.Query(ctx, `SELECT bus_stop_id FROM trip_route_stops WHERE trip_id = $1 ORDER BY seq`, t.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		t.RouteStops = append(t.RouteStops, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	frows, err := s.db.Query(ctx, `SELECT tag_id, intent FROM trip_tag_filters WHERE trip_id = $1`, t.ID)
	if err != nil {
		return err
	}
	for frows.Next() {
		var f tagFilter
		if err := frows.Scan(&f.TagID, &f.Intent); err != nil {
			frows.Close()
			return err
		}
		t.Filters = append(t.Filters, f)
	}
	frows.Close()
	if err := frows.Err(); err != nil {
		return err
	}

	if t.Tags, err = s.userTagIDs(ctx, driverID); err != nil {
		return err
	}
	eta, err := s.vehicleETAWithin(ctx, estCtx, t.ID)
	if err != nil {
		return err
	}
	if eta != nil {
		t.ETASeconds = &eta.DurationS
		t.ETASimulated = eta.Simulated
	}
	return nil
}
