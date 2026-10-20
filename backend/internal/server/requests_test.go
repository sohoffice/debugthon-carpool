package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Request flow tests (T12, T13). They use 台北大巨蛋, where the demo seed has no cars, so only the
// trips a test makes take part.

type requestResp struct {
	ID           int64  `json:"id"`
	Status       string `json:"status"`
	Reassigned   bool   `json:"reassigned"`
	Relaxed      bool   `json:"relaxed"`
	CanCancel    bool   `json:"can_cancel"`
	RejectReason *struct {
		Code      string `json:"code"`
		DistanceM int    `json:"distance_m"`
	} `json:"reject_reason"`
	Ride *struct {
		Vehicle struct {
			Plate string `json:"plate"`
		} `json:"vehicle"`
		EtaS     *int `json:"eta_s"`
		Position *struct {
			Lat float64 `json:"lat"`
		} `json:"position"`
		Dropoff struct {
			Name      string `json:"name"`
			BusStopID *int64 `json:"bus_stop_id"`
		} `json:"dropoff"`
		Route *struct {
			Polyline string `json:"polyline"`
		} `json:"route"`
	} `json:"ride"`
	Alternatives []struct {
		Mode        string `json:"mode"`
		DurationMin int    `json:"duration_min"`
	} `json:"alternatives"`
}

type driverTripResp struct {
	ID             int64      `json:"id"`
	Status         string     `json:"status"`
	EndedAt        *time.Time `json:"ended_at"`
	CompletedCount int        `json:"completed_count"`
	PendingRequest *struct {
		ID int64 `json:"id"`
	} `json:"pending_request"`
	Passengers []struct {
		RequestID int64 `json:"request_id"`
		Boarded   bool  `json:"boarded"`
	} `json:"passengers"`
}

var flowDest = place{Name: "瑞光路 內科大樓 A", Lat: 25.0768, Lng: 121.5738}

type flowPickup struct {
	id  int64
	pos latLng
}

func domePickup(t *testing.T, db DB) flowPickup {
	t.Helper()
	var p flowPickup
	if err := db.QueryRow(context.Background(), `SELECT id, lat, lng FROM pickup_points WHERE name = '台北大巨蛋'`).
		Scan(&p.id, &p.pos.Lat, &p.pos.Lng); err != nil {
		t.Fatalf("no seeded pickup point 台北大巨蛋: %v", err)
	}
	return p
}

func anyStop(t *testing.T, db DB) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(context.Background(), `SELECT min(id) FROM bus_stops`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// flowTrip departs a fresh driver at 台北大巨蛋 and reports the car metresAway south of it, so
// the trip has an ETA and has not passed the pickup point.
func flowTrip(t *testing.T, tx pgx.Tx, capacity int, autoAccept bool, metresAway float64) tripFixture {
	t.Helper()
	p := domePickup(t, tx)
	f := tripFixture{pickup: p.pos, radiusM: 80}
	f.driverID, f.token = newUser(t, tx, roleDriver)
	body := `{"pickup_point_id":` + itoa(p.id) + `,"destination":{"name":"` + flowDest.Name + `","lat":` + ftoa(flowDest.Lat) +
		`,"lng":` + ftoa(flowDest.Lng) + `},"capacity":` + strconv.Itoa(capacity) + `,"auto_accept":` + strconv.FormatBool(autoAccept) + `}`
	w := call(t, tx, http.MethodPost, "/api/driver/trips", f.token, body)
	wantStatus(t, w, http.StatusCreated, "")
	f.id = decode[tripResp](t, w).ID
	report(t, tx, f.token, offsetM(p.pos, -metresAway))
	return f
}

func submitBody(pickupID, stopID int64, at latLng, extra string) string {
	b := `{"pickup_point_id":` + itoa(pickupID) + `,"destination":{"name":"` + flowDest.Name + `","lat":` + ftoa(flowDest.Lat) +
		`,"lng":` + ftoa(flowDest.Lng) + `},"accepted_stop_ids":[` + itoa(stopID) + `],"tag_filters":[],"location":{"lat":` +
		ftoa(at.Lat) + `,"lng":` + ftoa(at.Lng) + `}`
	if extra != "" {
		b += "," + extra
	}
	return b + "}"
}

// passengerAt makes a fresh passenger who has taken part (DD-25).
func passengerAt(t *testing.T, tx pgx.Tx) (int64, string) {
	t.Helper()
	id, token := newUser(t, tx, rolePassenger)
	declare(t, tx, token)
	return id, token
}

func submit(t *testing.T, tx pgx.Tx, token string, metresFromPickup float64) requestResp {
	t.Helper()
	p := domePickup(t, tx)
	w := call(t, tx, http.MethodPost, "/api/passenger/requests", token, submitBody(p.id, anyStop(t, tx), offsetM(p.pos, metresFromPickup), ""))
	wantStatus(t, w, http.StatusCreated, "")
	return decode[struct {
		Request requestResp `json:"request"`
	}](t, w).Request
}

func myRequest(t *testing.T, tx pgx.Tx, token string) requestResp {
	t.Helper()
	w := call(t, tx, http.MethodGet, "/api/passenger/request", token, "")
	wantStatus(t, w, http.StatusOK, "")
	return decode[struct {
		Request requestResp `json:"request"`
	}](t, w).Request
}

func driverTrip(t *testing.T, tx pgx.Tx, token string) driverTripResp {
	t.Helper()
	w := call(t, tx, http.MethodGet, "/api/driver/trip", token, "")
	wantStatus(t, w, http.StatusOK, "")
	return decode[struct {
		Trip driverTripResp `json:"trip"`
	}](t, w).Trip
}

func act(t *testing.T, tx pgx.Tx, token, role string, requestID int64, action string, status int, code string) {
	t.Helper()
	w := call(t, tx, http.MethodPost, "/api/"+role+"/requests/"+itoa(requestID)+"/"+action, token, "")
	wantStatus(t, w, status, code)
}

func linkedTrip(t *testing.T, db DB, passengerID int64) *int64 {
	t.Helper()
	var trip *int64
	if err := db.QueryRow(context.Background(), `SELECT trip_id FROM activities WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, passengerID).
		Scan(&trip); err != nil {
		t.Fatal(err)
	}
	return trip
}

func TestRequestIsHeldThenConfirmedByTheDriver(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, false, 400)
	passengerID, token := passengerAt(t, tx)

	r := submit(t, tx, token, 20)
	if r.Status != statusWaitingDriver || !r.CanCancel || r.Ride != nil {
		t.Fatalf("submitted = %+v, want waiting_driver with no ride yet", r)
	}
	if h, c := seatCounts(t, tx, trip.id); h != 1 || c != 0 {
		t.Fatalf("held/confirmed = %d/%d, want the seat held (DD-12)", h, c)
	}
	d := driverTrip(t, tx, trip.token)
	if d.PendingRequest == nil || d.PendingRequest.ID != r.ID {
		t.Fatalf("driver sees %+v, want request %d pending", d, r.ID)
	}

	act(t, tx, trip.token, "driver", r.ID, "accept", http.StatusOK, "")
	got := myRequest(t, tx, token)
	if got.Status != statusConfirmed || got.Ride == nil || got.Ride.EtaS == nil || *got.Ride.EtaS <= 0 || got.Ride.Position == nil ||
		got.Ride.Route == nil || got.Ride.Dropoff.Name != flowDest.Name {
		t.Fatalf("confirmed = %+v, want the car, ETA, position, route and drop-off (REQ-052)", got)
	}
	if h, c := seatCounts(t, tx, trip.id); h != 0 || c != 1 {
		t.Fatalf("held/confirmed = %d/%d, want 0/1", h, c)
	}
	if lt := linkedTrip(t, tx, passengerID); lt == nil || *lt != trip.id {
		t.Fatalf("passenger activity trip = %v, want %d (DD-25)", lt, trip.id)
	}
	if d := driverTrip(t, tx, trip.token); d.PendingRequest != nil || len(d.Passengers) != 1 || d.Passengers[0].Boarded {
		t.Fatalf("driver sees %+v, want one confirmed passenger not on board", d)
	}
	act(t, tx, trip.token, "driver", r.ID, "accept", http.StatusConflict, "request_not_pending")
}

func TestAutoAcceptConfirmsAtOnce(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 2, true, 400)
	passengerID, token := passengerAt(t, tx)

	if r := submit(t, tx, token, 20); r.Status != statusConfirmed {
		t.Fatalf("status = %s, want confirmed (REQ-022)", r.Status)
	}
	if h, c := seatCounts(t, tx, trip.id); h != 0 || c != 1 {
		t.Fatalf("held/confirmed = %d/%d, want 0/1", h, c)
	}
	if lt := linkedTrip(t, tx, passengerID); lt == nil || *lt != trip.id {
		t.Fatalf("passenger activity trip = %v, want %d (DD-25)", lt, trip.id)
	}
}

func TestTooFarIsRejectedWithTheDistance(t *testing.T) {
	tx := testTx(t)
	flowTrip(t, tx, 3, true, 400)
	_, token := passengerAt(t, tx)

	r := submit(t, tx, token, 420)
	if r.Status != statusRejected || r.RejectReason == nil || r.RejectReason.Code != "too_far" ||
		r.RejectReason.DistanceM < 410 || r.RejectReason.DistanceM > 430 {
		t.Fatalf("got %+v, want rejected too_far at about 420 m (REQ-034)", r)
	}
	var lat float64
	if err := tx.QueryRow(context.Background(), `SELECT submitted_lat FROM ride_requests WHERE id = $1`, r.ID).Scan(&lat); err != nil || lat == 0 {
		t.Fatalf("submitted_lat = %v, %v; want the position kept on the request (DD-25)", lat, err)
	}
}

func TestNoCarAnswersAtOnceWithWalking(t *testing.T) {
	tx := testTx(t)
	_, token := passengerAt(t, tx)
	r := submit(t, tx, token, 20)
	if r.Status != statusNoMatch || len(r.Alternatives) == 0 || r.Alternatives[0].Mode != "walk" || r.Alternatives[0].DurationMin <= 0 {
		t.Fatalf("got %+v, want no_match with a walking alternative (REQ-036, REQ-051)", r)
	}
}

func TestDeclinesMoveOnUntilNoCarIsLeft(t *testing.T) {
	tx := testTx(t)
	first := flowTrip(t, tx, 3, false, 300)
	second := flowTrip(t, tx, 3, false, 900)
	_, token := passengerAt(t, tx)

	r := submit(t, tx, token, 20)
	if d := driverTrip(t, tx, first.token); d.PendingRequest == nil {
		t.Fatalf("the closer car should get the request first")
	}
	act(t, tx, first.token, "driver", r.ID, "decline", http.StatusOK, "")
	if h, _ := seatCounts(t, tx, first.id); h != 0 {
		t.Fatalf("declined car still holds %d seats", h)
	}
	if d := driverTrip(t, tx, second.token); d.PendingRequest == nil || d.PendingRequest.ID != r.ID {
		t.Fatalf("the next car should get it (REQ-050), got %+v", d)
	}
	if got := myRequest(t, tx, token); got.Status != statusWaitingDriver || !got.Reassigned {
		t.Fatalf("got %+v, want waiting_driver and reassigned", got)
	}
	act(t, tx, second.token, "driver", r.ID, "decline", http.StatusOK, "")
	if got := myRequest(t, tx, token); got.Status != statusNoMatch {
		t.Fatalf("status = %s, want no_match once every car declined", got.Status)
	}
}

func TestTimeoutMovesToTheNextCar(t *testing.T) {
	tx := testTx(t)
	first := flowTrip(t, tx, 3, false, 300)
	second := flowTrip(t, tx, 3, true, 900)
	_, token := passengerAt(t, tx)

	r := submit(t, tx, token, 20)
	// The deadline is stored, so passing it is enough; any poll runs the check (DD-13).
	mustExec(t, tx, `UPDATE ride_requests SET response_deadline_at = now() - interval '1 second' WHERE id = $1`, r.ID)
	got := myRequest(t, tx, token)
	if got.Status != statusConfirmed || !got.Reassigned {
		t.Fatalf("got %+v, want confirmed by the auto-accepting car after the timeout", got)
	}
	var outcome string
	if err := tx.QueryRow(context.Background(), `SELECT outcome FROM request_candidates WHERE request_id = $1 AND trip_id = $2`, r.ID, first.id).
		Scan(&outcome); err != nil || outcome != "timed_out" {
		t.Fatalf("first car outcome = %q, %v; want timed_out", outcome, err)
	}
	if h, c := seatCounts(t, tx, second.id); h != 0 || c != 1 {
		t.Fatalf("second car held/confirmed = %d/%d, want 0/1", h, c)
	}
}

func TestBoardingAndCompletingHappenOnce(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, true, 400)
	passengerID, token := passengerAt(t, tx)
	r := submit(t, tx, token, 20)

	act(t, tx, token, "passenger", r.ID, "board", http.StatusOK, "")
	act(t, tx, trip.token, "driver", r.ID, "board", http.StatusOK, "") // second one is a no-op (DD-27)
	got := myRequest(t, tx, token)
	if got.Status != statusBoarded || got.CanCancel || got.Ride == nil || got.Ride.EtaS != nil || got.Ride.Position != nil {
		t.Fatalf("boarded = %+v, want no ETA, no position and no cancel (REQ-068)", got)
	}
	if d := driverTrip(t, tx, trip.token); len(d.Passengers) != 1 || !d.Passengers[0].Boarded {
		t.Fatalf("driver sees %+v, want the passenger marked on board", d)
	}
	act(t, tx, token, "passenger", r.ID, "cancel", http.StatusConflict, "cannot_cancel")

	act(t, tx, token, "passenger", r.ID, "complete", http.StatusOK, "")
	act(t, tx, trip.token, "driver", r.ID, "complete", http.StatusOK, "") // no-op (DD-23)
	var records int
	var pickedUp *time.Time
	if err := tx.QueryRow(context.Background(), `SELECT count(*), max(picked_up_at) FROM service_records WHERE request_id = $1`, r.ID).
		Scan(&records, &pickedUp); err != nil || records != 1 || pickedUp == nil {
		t.Fatalf("service records = %d (picked up %v), %v; want exactly one with the boarding time (REQ-055)", records, pickedUp, err)
	}
	if _, c := seatCounts(t, tx, trip.id); c != 0 {
		t.Fatalf("seat still taken after the ride ended")
	}
	if d := driverTrip(t, tx, trip.token); d.CompletedCount != 1 || len(d.Passengers) != 0 {
		t.Fatalf("driver sees %+v, want one finished ride", d)
	}

	// Habitual data follows the completed ride (DD-19).
	var dest string
	var stops int
	if err := tx.QueryRow(context.Background(), `
		SELECT p.usual_destination_name, (SELECT count(*) FROM passenger_accepted_stops s WHERE s.user_id = p.user_id)
		  FROM passenger_profiles p WHERE p.user_id = $1`, passengerID).Scan(&dest, &stops); err != nil || dest != flowDest.Name || stops != 1 {
		t.Fatalf("passenger profile = %q with %d stops, %v", dest, stops, err)
	}
	var capacity int
	if err := tx.QueryRow(context.Background(), `SELECT capacity FROM driver_profiles WHERE user_id = $1`, trip.driverID).Scan(&capacity); err != nil || capacity != 3 {
		t.Fatalf("driver profile capacity = %d, %v; want 3", capacity, err)
	}
}

func TestCompleteWithoutBoarding(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, true, 400)
	_, token := passengerAt(t, tx)
	r := submit(t, tx, token, 20)
	act(t, tx, trip.token, "driver", r.ID, "complete", http.StatusOK, "")
	if got := myRequest(t, tx, token); got.Status != statusCompleted {
		t.Fatalf("status = %s, want completed straight from confirmed (DD-27)", got.Status)
	}
}

func TestCancelBeforeBoardingOnly(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, false, 400)
	_, token := passengerAt(t, tx)

	first := submit(t, tx, token, 20)
	act(t, tx, token, "passenger", first.ID, "cancel", http.StatusOK, "")
	if h, _ := seatCounts(t, tx, trip.id); h != 0 {
		t.Fatalf("cancelled request still holds a seat")
	}
	if d := driverTrip(t, tx, trip.token); d.PendingRequest != nil {
		t.Fatalf("the driver still sees the cancelled request")
	}

	second := submit(t, tx, token, 20)
	act(t, tx, trip.token, "driver", second.ID, "accept", http.StatusOK, "")
	mustExec(t, tx, `UPDATE trips SET passed_pickup = true WHERE id = $1`, trip.id)
	act(t, tx, token, "passenger", second.ID, "cancel", http.StatusConflict, "cannot_cancel")
	if got := myRequest(t, tx, token); got.CanCancel {
		t.Fatalf("can_cancel after the car passed the pickup point")
	}
}

func TestOneOpenRequestAtATime(t *testing.T) {
	tx := testTx(t)
	flowTrip(t, tx, 3, false, 400)
	_, token := passengerAt(t, tx)
	submit(t, tx, token, 20)
	p := domePickup(t, tx)
	w := call(t, tx, http.MethodPost, "/api/passenger/requests", token, submitBody(p.id, anyStop(t, tx), p.pos, ""))
	wantStatus(t, w, http.StatusConflict, "request_active")
}

func TestSubmissionValidation(t *testing.T) {
	tx := testTx(t)
	_, token := passengerAt(t, tx)
	p := domePickup(t, tx)
	stop := anyStop(t, tx)
	for name, tc := range map[string]struct{ body, code string }{
		"no location":  {strings.Replace(submitBody(p.id, stop, p.pos, ""), `,"location":{"lat":`+ftoa(p.pos.Lat)+`,"lng":`+ftoa(p.pos.Lng)+`}`, "", 1), "invalid_location"},
		"no stops":     {strings.Replace(submitBody(p.id, stop, p.pos, ""), `[`+itoa(stop)+`]`, `[]`, 1), "no_accepted_stops"},
		"bad pickup":   {submitBody(999999, stop, p.pos, ""), "invalid_pickup_point"},
		"unknown stop": {submitBody(p.id, 99999999, p.pos, ""), "unknown_bus_stop"},
		"outside park": {strings.Replace(submitBody(p.id, stop, p.pos, ""), `"lat":25.0768,"lng":121.5738`, `"lat":25.0478,"lng":121.517`, 1), "destination_outside_park"},
	} {
		t.Run(name, func(t *testing.T) {
			wantStatus(t, call(t, tx, http.MethodPost, "/api/passenger/requests", token, tc.body), http.StatusBadRequest, tc.code)
		})
	}
}

func TestTripEndsAtTheDestination(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, true, 400)
	_, token := passengerAt(t, tx)
	if r := submit(t, tx, token, 20); r.Status != statusConfirmed {
		t.Fatalf("status = %s, want confirmed", r.Status)
	}

	report(t, tx, trip.token, trip.pickup)               // enter the pickup area
	report(t, tx, trip.token, offsetM(trip.pickup, 300)) // leave it: passed
	if d := driverTrip(t, tx, trip.token); d.Status != "active" {
		t.Fatalf("trip ended before reaching its destination")
	}
	report(t, tx, trip.token, latLng{flowDest.Lat, flowDest.Lng})
	d := driverTrip(t, tx, trip.token)
	if d.Status != "completed" || d.EndedAt == nil || d.CompletedCount != 1 {
		t.Fatalf("driver sees %+v, want the trip ended with one finished ride (UD-16)", d)
	}
	if got := myRequest(t, tx, token); got.Status != statusCompleted {
		t.Fatalf("ride status = %s, want completed with the trip (REQ-067)", got.Status)
	}
}

func TestSupplyOfThePickupPoint(t *testing.T) {
	tx := testTx(t)
	far := flowTrip(t, tx, 3, false, 900)
	near := flowTrip(t, tx, 2, false, 300)
	_, token := passengerAt(t, tx)
	p := domePickup(t, tx)
	q := "/api/passenger/supply?pickup_point_id=" + itoa(p.id) + "&destination_name=x&destination_lat=" + ftoa(flowDest.Lat) +
		"&destination_lng=" + ftoa(flowDest.Lng) + "&accepted_stop_ids=" + itoa(anyStop(t, tx)) + "&required_tag_ids=&preferred_tag_ids="

	w := call(t, tx, http.MethodGet, q, token, "")
	wantStatus(t, w, http.StatusOK, "")
	got := decode[struct {
		PickupPoint  pickupPoint `json:"pickup_point"`
		WaitLimitMin float64     `json:"wait_limit_min"`
		VehicleCount int         `json:"vehicle_count"`
		FastestEtaS  *int        `json:"fastest_eta_s"`
		Seats        int         `json:"seats"`
		Vehicles     []struct {
			ID   int64 `json:"id"`
			EtaS int   `json:"eta_s"`
		} `json:"vehicles"`
	}](t, w)
	if got.PickupPoint.ID != p.id || got.WaitLimitMin != 10 || got.VehicleCount != 2 || got.Seats != 5 ||
		got.Vehicles[0].ID != near.id || got.Vehicles[1].ID != far.id || got.FastestEtaS == nil || *got.FastestEtaS != got.Vehicles[0].EtaS {
		t.Fatalf("supply = %+v, want both cars nearest first with 5 seats (REQ-029, REQ-030)", got)
	}
	wantStatus(t, call(t, tx, http.MethodGet, strings.Replace(q, "pickup_point_id="+itoa(p.id)+"&", "", 1), token, ""), http.StatusBadRequest, "invalid_request")
	wantStatus(t, call(t, tx, http.MethodGet, strings.Replace(q, "accepted_stop_ids="+itoa(anyStop(t, tx)), "accepted_stop_ids=", 1), token, ""), http.StatusBadRequest, "invalid_request")
}

// The timeline spans the wait limit setting, read on every query (REQ-030, DD-20), and a car whose
// driver lacks a tag the passenger requires is left out (REQ-040).
func TestSupplyFollowsWaitLimitAndRequiredTags(t *testing.T) {
	tx := testTx(t)
	trip := flowTrip(t, tx, 3, false, 900)
	_, token := passengerAt(t, tx)
	p := domePickup(t, tx)
	var tagID int64
	if err := tx.QueryRow(context.Background(), `SELECT min(id) FROM tags`).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	q := func(required string) string {
		return "/api/passenger/supply?pickup_point_id=" + itoa(p.id) + "&destination_name=x&destination_lat=" + ftoa(flowDest.Lat) +
			"&destination_lng=" + ftoa(flowDest.Lng) + "&accepted_stop_ids=" + itoa(anyStop(t, tx)) + "&required_tag_ids=" + required
	}
	type supply struct {
		WaitLimitMin float64 `json:"wait_limit_min"`
		VehicleCount int     `json:"vehicle_count"`
	}
	get := func(path string) supply {
		w := call(t, tx, http.MethodGet, path, token, "")
		wantStatus(t, w, http.StatusOK, "")
		return decode[supply](t, w)
	}

	if s := get(q("")); s.WaitLimitMin != 10 || s.VehicleCount != 1 {
		t.Fatalf("supply = %+v, want the car within a 10-minute limit", s)
	}
	// The car is about 3.5 minutes away; a 2-minute limit leaves it out and shortens the timeline.
	mustExec(t, tx, `UPDATE system_settings SET value = 2 WHERE key = 'wait_limit'`)
	if s := get(q("")); s.WaitLimitMin != 2 || s.VehicleCount != 0 {
		t.Fatalf("supply = %+v, want a 2-minute timeline without the car", s)
	}
	mustExec(t, tx, `UPDATE system_settings SET value = 10 WHERE key = 'wait_limit'`)

	if s := get(q(itoa(tagID))); s.VehicleCount != 0 {
		t.Fatalf("a required tag the driver lacks should exclude the car, got %+v", s)
	}
	mustExec(t, tx, `INSERT INTO user_tags (user_id, tag_id) VALUES ($1, $2)`, trip.driverID, tagID)
	if s := get(q(itoa(tagID))); s.VehicleCount != 1 {
		t.Fatalf("the driver now carries the tag, got %+v", s)
	}

	for name, path := range map[string]string{
		"no destination": strings.Replace(q(""), "&destination_lat="+ftoa(flowDest.Lat), "", 1),
		"no stops":       strings.Replace(q(""), "&accepted_stop_ids="+itoa(anyStop(t, tx)), "", 1),
		"no pickup":      strings.Replace(q(""), "pickup_point_id="+itoa(p.id)+"&", "", 1),
	} {
		t.Run(name, func(t *testing.T) {
			wantStatus(t, call(t, tx, http.MethodGet, path, token, ""), http.StatusBadRequest, "invalid_request")
		})
	}
}

func TestPlacesAndRoutePreview(t *testing.T) {
	tx := testTx(t)
	_, token := newUser(t, tx, roleDriver)
	w := call(t, tx, http.MethodGet, "/api/places?q="+"瑞光", token, "")
	wantStatus(t, w, http.StatusOK, "")
	places := decode[[]place](t, w)
	if len(places) == 0 || len(places) > maxPlaces || !strings.Contains(places[0].Name, "瑞光") {
		t.Fatalf("places = %+v, want park places matching 瑞光", places)
	}

	p := domePickup(t, tx)
	body := `{"pickup_point_id":` + itoa(p.id) + `,"destination":` + inPark + `}`
	w = call(t, tx, http.MethodPost, "/api/driver/route-preview", token, body)
	wantStatus(t, w, http.StatusOK, "")
	if r := decode[routeView](t, w); r.Polyline == "" || r.DistanceM <= 0 || r.BusStops == nil {
		t.Fatalf("route = %+v", r)
	}
	var trips int
	if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id WHERE u.username = $1`,
		strings.TrimPrefix(token, "driver:")).Scan(&trips); err != nil || trips != 0 {
		t.Fatalf("a preview must not store a trip (%d, %v)", trips, err)
	}
	wantStatus(t, call(t, tx, http.MethodPost, "/api/driver/route-preview", token, `{"pickup_point_id":`+itoa(p.id)+`,"destination":`+outPark+`}`),
		http.StatusBadRequest, "destination_outside_park")
}

func TestDemoResetRestartsTheDemo(t *testing.T) {
	tx := testTx(t)
	before, err := int64s(context.Background(), tx, `SELECT id FROM trips WHERE simulated AND status = 'active' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, tx, `DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1')`)

	wantStatus(t, call(t, tx, http.MethodPost, "/api/demo/reset", "", ""), http.StatusNoContent, "")

	after, err := int64s(context.Background(), tx, `SELECT id FROM trips WHERE simulated AND status = 'active' ORDER BY id`)
	if err != nil || len(after) != 3 || (len(before) > 0 && after[0] <= before[len(before)-1]) {
		t.Fatalf("simulated trips %v → %v, want three new ones (DD-14)", before, after)
	}
	var activities int
	if err := tx.QueryRow(context.Background(), `SELECT count(*) FROM activities WHERE trip_id = ANY($1) AND role = 'driver'`, after).Scan(&activities); err != nil || activities != 3 {
		t.Fatalf("driver activities on the new trips = %d, %v; want 3 (DD-25)", activities, err)
	}
	w := call(t, tx, http.MethodGet, "/api/passenger/profile", "passenger:passenger1", "")
	if !strings.Contains(w.Body.String(), "瑞光路 513 巷") {
		t.Fatalf("passenger1 profile after reset = %s, want the demo destination", w.Body.String())
	}
	w = call(t, tx, http.MethodGet, "/api/driver/trips/defaults", "driver:driver4", "")
	if d := decode[defaultsResp](t, w); d.Destination == nil || d.Destination.Name != "瑞光路 513 巷" || len(d.TagFilters) != 1 {
		t.Fatalf("driver4 defaults after reset = %+v, want the demo's last trip (REQ-016)", d)
	}
	w = call(t, tx, http.MethodGet, "/api/driver/trip", "driver:driver4", "")
	if !strings.Contains(w.Body.String(), `"status":"completed"`) {
		t.Fatalf("driver4 should have no running trip after reset: %s", w.Body.String())
	}
}

// ---------------------------------------------------------------- with real concurrent connections

// raceFixture commits a fresh driver trip at 台北大巨蛋 with a reported position. Activities and
// reports are append-only, so the accounts stay; the trip is ended and requests removed afterwards.
func raceFixture(t *testing.T, pool *pgxpool.Pool, capacity int) (tripID int64, passengerTokens []string) {
	t.Helper()
	ctx := context.Background()
	srv := newServer(pool, testDeps(t))
	stamp := strconv.FormatInt(time.Now().UnixNano(), 36)
	var driverID int64
	if err := pool.QueryRow(ctx, `INSERT INTO users (username, display_name, is_driver) VALUES ($1, $1, true) RETURNING id`,
		"test-race-driver-"+stamp).Scan(&driverID); err != nil {
		t.Fatal(err)
	}
	p := domePickup(t, pool)
	if err := pool.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status, auto_accept, started_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', true, now()) RETURNING id`,
		driverID, p.id, flowDest.Name, flowDest.Lat, flowDest.Lng, capacity).Scan(&tripID); err != nil {
		t.Fatal(err)
	}
	var activityID int64
	if err := pool.QueryRow(ctx, `INSERT INTO activities (user_id, role, trip_id) VALUES ($1, 'driver', $2) RETURNING id`, driverID, tripID).Scan(&activityID); err != nil {
		t.Fatal(err)
	}
	car := offsetM(p.pos, -400)
	if _, err := pool.Exec(ctx, `INSERT INTO location_reports (activity_id, lat, lng) VALUES ($1, $2, $3)`, activityID, car.Lat, car.Lng); err != nil {
		t.Fatal(err)
	}
	if err := srv.ensureRoute(ctx, tripID); err != nil {
		t.Fatal(err)
	}
	var passengerIDs []int64
	for i := 0; i < 2; i++ {
		name := "test-race-passenger-" + strconv.Itoa(i) + "-" + stamp
		var id int64
		if err := pool.QueryRow(ctx, `INSERT INTO users (username, display_name, is_passenger) VALUES ($1, $1, true) RETURNING id`, name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		passengerIDs = append(passengerIDs, id)
		passengerTokens = append(passengerTokens, "passenger:"+name)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM service_records WHERE trip_id = $1`, tripID)
		pool.Exec(ctx, `DELETE FROM ride_requests WHERE passenger_id = ANY($1)`, passengerIDs)
		pool.Exec(ctx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1`, tripID)
		pool.Exec(ctx, `DELETE FROM passenger_profiles WHERE user_id = ANY($1)`, passengerIDs)
		pool.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`, passengerIDs)
		pool.Exec(ctx, `DELETE FROM driver_profiles WHERE user_id = $1`, driverID)
	})
	return tripID, passengerTokens
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close) // registered before the fixture's cleanup, so it runs after it
	return pool
}

// Two passengers race for the last seat: the one submitted first gets it (REQ-048, DD-12).
func TestLastSeatGoesToTheFirstSubmitted(t *testing.T) {
	pool := testPool(t)
	_, tokens := raceFixture(t, pool, 1)
	p := domePickup(t, pool)
	body := submitBody(p.id, anyStop(t, pool), offsetM(p.pos, 20), "")

	var wg sync.WaitGroup
	for _, token := range tokens {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			call(t, pool, http.MethodPost, "/api/passenger/requests", token, body)
		}(token)
	}
	wg.Wait()

	rows, err := pool.Query(context.Background(), `
		SELECT r.status FROM ride_requests r JOIN users u ON u.id = r.passenger_id
		 WHERE u.username = ANY($1) ORDER BY r.id`, []string{strings.TrimPrefix(tokens[0], "passenger:"), strings.TrimPrefix(tokens[1], "passenger:")})
	if err != nil {
		t.Fatal(err)
	}
	statuses, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(statuses) != 2 || statuses[0] != statusConfirmed || statuses[1] != statusNoMatch {
		t.Fatalf("statuses in submission order = %v, %v; want [confirmed no_match]", statuses, err)
	}
}

// Both sides ending, or boarding, the same ride at the same moment take effect once (DD-23, DD-27).
func TestSimultaneousBoardAndCompleteTakeEffectOnce(t *testing.T) {
	pool := testPool(t)
	tripID, tokens := raceFixture(t, pool, 2)
	p := domePickup(t, pool)
	w := call(t, pool, http.MethodPost, "/api/passenger/requests", tokens[0], submitBody(p.id, anyStop(t, pool), offsetM(p.pos, 20), ""))
	wantStatus(t, w, http.StatusCreated, "")
	id := decode[struct {
		Request requestResp `json:"request"`
	}](t, w).Request.ID
	var driver string
	if err := pool.QueryRow(context.Background(), `SELECT u.username FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.id = $1`, tripID).Scan(&driver); err != nil {
		t.Fatal(err)
	}

	for _, action := range []string{"board", "complete"} {
		var wg sync.WaitGroup
		codes := make([]int, 2)
		for i, path := range []struct{ token, role string }{{tokens[0], "passenger"}, {"driver:" + driver, "driver"}} {
			wg.Add(1)
			go func(i int, token, role string) {
				defer wg.Done()
				codes[i] = call(t, pool, http.MethodPost, "/api/"+role+"/requests/"+itoa(id)+"/"+action, token, "").Code
			}(i, path.token, path.role)
		}
		wg.Wait()
		if codes[0] != http.StatusOK || codes[1] != http.StatusOK {
			t.Fatalf("%s: codes %v, want both 200", action, codes)
		}
	}
	var records, confirmed int
	if err := pool.QueryRow(context.Background(), `
		SELECT (SELECT count(*) FROM service_records WHERE request_id = $1), (SELECT seats_confirmed FROM trips WHERE id = $2)`, id, tripID).
		Scan(&records, &confirmed); err != nil || records != 1 || confirmed != 0 {
		t.Fatalf("service records %d, seats confirmed %d, %v; want 1 and 0", records, confirmed, err)
	}
}
