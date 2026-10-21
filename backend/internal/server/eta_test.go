package server

import (
	"context"
	"testing"
)

// distanceRoutes is a DriveTimer whose duration is 1 s per metre, so an ETA tells which
// position it was computed from. It records the endpoints it was asked about.
type distanceRoutes struct {
	from, to latLng
	calls    int
}

func (d *distanceRoutes) DriveTime(_ context.Context, from, to latLng) (Travel, error) {
	d.from, d.to = from, to
	d.calls++
	return Travel{DurationS: int(distanceM(from, to)), Simulated: true}, nil
}

func etaServer(tx DB, drives DriveTimer) *Server { return &Server{db: tx, drives: drives} }

func TestETAUsesTheCurrentPosition(t *testing.T) {
	tx := testTx(t)
	f := activeTrip(t, tx)
	act := declare(t, tx, f.token)
	routes := &distanceRoutes{}
	s := etaServer(tx, routes)

	// Reports are not an ETA until the car has been heard from.
	if eta, err := s.vehicleETA(context.Background(), f.id); err != nil || eta != nil {
		t.Fatalf("eta before any report = %v, %v; want nil", eta, err)
	}

	near, far := offsetM(f.pickup, 300), offsetM(f.pickup, 1200)
	report(t, tx, f.token, near)
	eta, err := s.vehicleETA(context.Background(), f.id)
	if err != nil || eta == nil {
		t.Fatalf("eta = %v, %v", eta, err)
	}
	if routes.from != near || routes.to != f.pickup {
		t.Fatalf("estimated from %v to %v, want from the latest report %v to the pickup %v", routes.from, routes.to, near, f.pickup)
	}
	if eta.DurationS < 290 || eta.DurationS > 310 || !eta.Simulated {
		t.Fatalf("eta = %+v, want ~300 s and marked simulated", eta)
	}

	// A detour or a stop away from the pickup: the ETA follows where the car is now, not how far
	// it has driven or how long it has been going (DD-06). The first report there is written
	// 15 minutes in the past, since the API stamps reports with the current time.
	mustExec(t, tx, `
		INSERT INTO location_reports (activity_id, lat, lng, reported_at)
		VALUES ($1, $2, $3, now() - interval '15 minutes')`, act.ID, far.Lat, far.Lng)
	eta, _ = s.vehicleETA(context.Background(), f.id)
	if eta == nil || eta.DurationS < 1190 || eta.DurationS > 1210 {
		t.Fatalf("eta after moving away = %+v, want ~1200 s", eta)
	}

	// Waiting there for 15 minutes does not change it.
	report(t, tx, f.token, far)
	var distinctTimes int
	if err := tx.QueryRow(context.Background(), `
		SELECT count(DISTINCT reported_at) FROM location_reports
		 WHERE activity_id = $1 AND lat = $2 AND lng = $3`, act.ID, far.Lat, far.Lng).Scan(&distinctTimes); err != nil {
		t.Fatal(err)
	}
	if distinctTimes != 2 {
		t.Fatalf("fixture: the two reports at the far spot have %d distinct timestamps, want 2", distinctTimes)
	}
	again, _ := s.vehicleETA(context.Background(), f.id)
	if again == nil || again.DurationS != eta.DurationS {
		t.Fatalf("eta after waiting in place = %+v, want unchanged %+v", again, eta)
	}
}

func TestETAIgnoresPassengerReports(t *testing.T) {
	tx := testTx(t)
	f := activeTrip(t, tx)
	declare(t, tx, f.token)
	_, pax := newUser(t, tx, rolePassenger)
	declare(t, tx, pax)
	routes := &distanceRoutes{}
	s := etaServer(tx, routes)

	report(t, tx, f.token, offsetM(f.pickup, 500))
	report(t, tx, pax, offsetM(f.pickup, 5))
	if _, err := s.vehicleETA(context.Background(), f.id); err != nil {
		t.Fatal(err)
	}
	if routes.from != offsetM(f.pickup, 500) {
		t.Fatalf("estimated from %v, want the driver's position", routes.from)
	}
}

func TestNoETAOnceThePickupIsPassed(t *testing.T) {
	tx := testTx(t)
	f := activeTrip(t, tx)
	declare(t, tx, f.token)
	routes := &distanceRoutes{}
	s := etaServer(tx, routes)

	report(t, tx, f.token, offsetM(f.pickup, 400))
	report(t, tx, f.token, offsetM(f.pickup, 5))
	passed := report(t, tx, f.token, offsetM(f.pickup, -(f.radiusM+100)))
	if passed.PassedPickup == nil || !*passed.PassedPickup {
		t.Fatalf("fixture: trip should have passed the pickup, got %v", passed.PassedPickup)
	}
	routes.calls = 0
	eta, err := s.vehicleETA(context.Background(), f.id)
	if err != nil || eta != nil {
		t.Fatalf("eta after passing = %v, %v; want nil", eta, err)
	}
	if routes.calls != 0 {
		t.Fatal("a passed car must not cost a route estimate")
	}
	// Coming back does not bring the ETA back.
	report(t, tx, f.token, offsetM(f.pickup, 200))
	if eta, _ := s.vehicleETA(context.Background(), f.id); eta != nil {
		t.Fatalf("eta after returning = %v, want nil", eta)
	}
}

func TestNoETAForATripThatIsNotActive(t *testing.T) {
	tx := testTx(t)
	f := activeTrip(t, tx)
	declare(t, tx, f.token)
	routes := &distanceRoutes{}
	s := etaServer(tx, routes)

	report(t, tx, f.token, offsetM(f.pickup, 500))
	if eta, err := s.vehicleETA(context.Background(), f.id); err != nil || eta == nil {
		t.Fatalf("fixture: active trip eta = %v, %v; want an estimate", eta, err)
	}

	mustExec(t, tx, `UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1`, f.id)
	routes.calls = 0
	if eta, err := s.vehicleETA(context.Background(), f.id); err != nil || eta != nil {
		t.Fatalf("eta for an ended trip = %v, %v; want nil", eta, err)
	}
	if routes.calls != 0 {
		t.Fatal("an ended trip must not cost a route estimate")
	}

	if eta, err := s.vehicleETA(context.Background(), f.id+1000000); err != nil || eta != nil {
		t.Fatalf("eta for a missing trip = %v, %v; want nil", eta, err)
	}
}
