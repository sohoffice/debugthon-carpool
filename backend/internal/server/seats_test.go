package server

import (
	"context"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func seatCounts(t *testing.T, db DB, tripID int64) (held, confirmed int) {
	t.Helper()
	err := db.QueryRow(context.Background(), `SELECT seats_held, seats_confirmed FROM trips WHERE id = $1`, tripID).
		Scan(&held, &confirmed)
	if err != nil {
		t.Fatal(err)
	}
	return
}

func TestSeatLifecycle(t *testing.T) {
	tx := testTx(t)
	ctx := context.Background()
	trip := activeTrip(t, tx) // capacity 3

	for i := 0; i < 3; i++ {
		if ok, err := holdSeat(ctx, tx, trip.id); err != nil || !ok {
			t.Fatalf("hold %d = %v, %v, want true", i, ok, err)
		}
	}
	if ok, _ := holdSeat(ctx, tx, trip.id); ok {
		t.Fatal("a 4th hold on a 3-seat trip succeeded")
	}

	if ok, err := confirmSeat(ctx, tx, trip.id); err != nil || !ok {
		t.Fatalf("confirm = %v, %v, want true", ok, err)
	}
	if h, c := seatCounts(t, tx, trip.id); h != 2 || c != 1 {
		t.Fatalf("held/confirmed = %d/%d, want 2/1", h, c)
	}
	// Confirmed seats count against capacity, so releasing a hold frees exactly one seat.
	if ok, _ := holdSeat(ctx, tx, trip.id); ok {
		t.Fatal("hold succeeded while the trip is full")
	}
	if ok, err := releaseHold(ctx, tx, trip.id); err != nil || !ok {
		t.Fatalf("release hold = %v, %v, want true", ok, err)
	}
	if ok, err := holdSeat(ctx, tx, trip.id); err != nil || !ok {
		t.Fatalf("hold after release = %v, %v, want true", ok, err)
	}

	if ok, err := releaseConfirmed(ctx, tx, trip.id); err != nil || !ok {
		t.Fatalf("release confirmed = %v, %v, want true", ok, err)
	}
	if h, c := seatCounts(t, tx, trip.id); h != 2 || c != 0 {
		t.Fatalf("held/confirmed = %d/%d, want 2/0", h, c)
	}
}

func TestSeatOperationsNeedSomethingToMove(t *testing.T) {
	tx := testTx(t)
	ctx := context.Background()
	trip := activeTrip(t, tx)
	if ok, _ := confirmSeat(ctx, tx, trip.id); ok {
		t.Error("confirm succeeded with no held seat")
	}
	if ok, _ := releaseHold(ctx, tx, trip.id); ok {
		t.Error("release hold succeeded with no held seat")
	}
	if ok, _ := releaseConfirmed(ctx, tx, trip.id); ok {
		t.Error("release confirmed succeeded with no confirmed seat")
	}
}

func TestHoldOnlyOnActiveTrip(t *testing.T) {
	tx := testTx(t)
	trip := activeTrip(t, tx)
	mustExec(t, tx, `UPDATE trips SET status = 'completed' WHERE id = $1`, trip.id)
	if ok, _ := holdSeat(context.Background(), tx, trip.id); ok {
		t.Fatal("hold succeeded on a completed trip")
	}
}

// Many requests racing for the last seats never oversell (REQ-039, DD-12). This test needs real
// concurrent connections, so it commits a trip and removes it afterwards.
func TestConcurrentHoldsDoNotOversell(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testDatabaseURL())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close) // registered first, so it runs after the row cleanup below

	var driverID, tripID int64
	name := "test-race-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	if err := pool.QueryRow(ctx, `INSERT INTO users (username, display_name, is_driver) VALUES ($1, $1, true) RETURNING id`,
		name).Scan(&driverID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM trips WHERE driver_id = $1`, driverID)
		pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, driverID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status)
		VALUES ($1, (SELECT min(id) FROM pickup_points), 'x', 25.08, 121.57, 3, 'active') RETURNING id`,
		driverID).Scan(&tripID); err != nil {
		t.Fatal(err)
	}

	var won atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, err := holdSeat(ctx, pool, tripID); err == nil && ok {
				won.Add(1)
			}
		}()
	}
	wg.Wait()
	if won.Load() != 3 {
		t.Fatalf("%d holds succeeded on a 3-seat trip, want exactly 3", won.Load())
	}
	if h, c := seatCounts(t, pool, tripID); h != 3 || c != 0 {
		t.Fatalf("held/confirmed = %d/%d, want 3/0", h, c)
	}
}
