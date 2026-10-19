package server

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sohoffice/debugthon-carpool/backend/internal/settings"
)

type supplyVehicle struct {
	ID        int64 `json:"id"`
	EtaS      int   `json:"eta_s"`
	Simulated bool  `json:"simulated"`
}

type supplyView struct {
	PickupPoint     pickupPoint     `json:"pickup_point"`
	WaitLimitMin    float64         `json:"wait_limit_min"`
	SubmitDistanceM float64         `json:"submit_distance_m"`
	VehicleCount    int             `json:"vehicle_count"`
	FastestEtaS     *int            `json:"fastest_eta_s"`
	Seats           int             `json:"seats"`
	Vehicles        []supplyVehicle `json:"vehicles"`
	Simulated       bool            `json:"simulated"`
}

// idList parses "1,2,3"; an empty string is an empty list.
func idList(raw string) ([]int64, bool) {
	if strings.TrimSpace(raw) == "" {
		return nil, true
	}
	var out []int64
	for _, p := range strings.Split(raw, ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64)
		if err != nil {
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

// getSupply is the passenger's view before asking (REQ-029, REQ-030): the chosen pickup point's
// relevant cars within the wait limit, how many seats they have and when each arrives. It screens
// with the matching engine's hard conditions and never ranks (DD-10). Cars cannot be picked (REQ-031).
func (s *Server) getSupply(c *gin.Context) {
	q := c.Request.URL.Query()
	pickupID, errPickup := strconv.ParseInt(q.Get("pickup_point_id"), 10, 64)
	lat, errLat := strconv.ParseFloat(q.Get("destination_lat"), 64)
	lng, errLng := strconv.ParseFloat(q.Get("destination_lng"), 64)
	stops, okStops := idList(q.Get("accepted_stop_ids"))
	required, okReq := idList(q.Get("required_tag_ids"))
	preferred, okPref := idList(q.Get("preferred_tag_ids"))
	if errPickup != nil || errLat != nil || errLng != nil || q.Get("destination_name") == "" || !okStops || len(stops) == 0 || !okReq || !okPref {
		apiError(c, http.StatusBadRequest, "invalid_request",
			"需要 pickup_point_id、destination_name、destination_lat、destination_lng 與至少一個 accepted_stop_ids；required_tag_ids、preferred_tag_ids 以逗號分隔")
		return
	}

	var pickup pickupPoint
	err := s.db.QueryRow(c, `SELECT id, name, lat, lng, radius_m FROM pickup_points WHERE id = $1`, pickupID).
		Scan(&pickup.ID, &pickup.Name, &pickup.Lat, &pickup.Lng, &pickup.RadiusM)
	if isNoRows(err) {
		apiError(c, http.StatusBadRequest, "invalid_pickup_point", "上車點必須是預先定義的上車點之一")
		return
	}
	if err != nil {
		s.internalError(c, err)
		return
	}

	var filters []tagFilter
	for _, id := range required {
		filters = append(filters, tagFilter{TagID: id, Intent: "required"})
	}
	for _, id := range preferred {
		filters = append(filters, tagFilter{TagID: id, Intent: "preferred"})
	}
	mine, err := userTags(c, s.db, c.GetInt64(ctxUserID))
	if err != nil {
		s.internalError(c, err)
		return
	}
	req := matchRequest{PickupPointID: pickupID, Destination: latLng{lat, lng}, AcceptedStops: stops, Filters: filters, Tags: mine}

	params, err := loadMatchParams(c, s.db)
	if err != nil {
		s.internalError(c, err)
		return
	}
	submit, err := settings.New(s.db).Get(c, "submit_distance")
	if err != nil {
		s.internalError(c, err)
		return
	}
	cands, err := s.loadCandidates(c, s.db, pickupID)
	if err != nil {
		s.internalError(c, err)
		return
	}

	out := supplyView{PickupPoint: pickup, WaitLimitMin: params.WaitLimitS / 60, SubmitDistanceM: submit, Vehicles: []supplyVehicle{}, Simulated: false}
	for _, cand := range cands {
		if !eligible(params, req, cand.Trip) {
			continue
		}
		out.Vehicles = append(out.Vehicles, supplyVehicle{ID: cand.Trip.ID, EtaS: *cand.Trip.ETASeconds, Simulated: cand.Simulated})
		out.Seats += cand.Trip.Capacity - cand.Trip.SeatsHeld - cand.Trip.SeatsConfirmed
		out.Simulated = out.Simulated || cand.Simulated
	}
	sort.SliceStable(out.Vehicles, func(i, j int) bool { return out.Vehicles[i].EtaS < out.Vehicles[j].EtaS })
	out.VehicleCount = len(out.Vehicles)
	if len(out.Vehicles) > 0 {
		out.FastestEtaS = &out.Vehicles[0].EtaS
	}
	c.JSON(http.StatusOK, out)
}
