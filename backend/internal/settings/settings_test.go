package settings

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func testTx(t *testing.T) pgx.Tx {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://carpool:carpool@localhost:5432/carpool?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect database (run `just infra up` and `just backend db-apply`): %v", err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = tx.Rollback(ctx)
		_ = conn.Close(ctx)
	})
	return tx
}

func TestGetReadsCurrentValue(t *testing.T) {
	tx := testTx(t)
	r := New(tx)
	ctx := context.Background()

	got, err := r.Get(ctx, "walk_weight")
	if err != nil || got != 1.5 {
		t.Fatalf("Get(walk_weight) = %v, %v; want 1.5", got, err)
	}

	// A change made with SQL is visible on the next read, without restarting.
	if _, err := tx.Exec(ctx, `UPDATE system_settings SET value = 3 WHERE key = 'walk_weight'`); err != nil {
		t.Fatal(err)
	}
	got, err = r.Get(ctx, "walk_weight")
	if err != nil || got != 3 {
		t.Fatalf("Get(walk_weight) after update = %v, %v; want 3", got, err)
	}
}

func TestGetUnknownKey(t *testing.T) {
	_, err := New(testTx(t)).Get(context.Background(), "no_such_key")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// Every matching parameter of REQ-060 is present with its seeded value.
func TestGetSeededKeys(t *testing.T) {
	r := New(testTx(t))
	for key, want := range map[string]float64{
		"submit_distance":        200,
		"address_match_distance": 200,
		"wait_limit":             10,
		"wait_weight":            2,
		"walk_weight":            1.5,
		"tag_bonus_cap":          4,
		"driver_confirm_timeout": 60,
		"arrival_radius":         50,  // DD-30
		"points_per_ride":        10,  // DD-34
		"demo_clock":             495, // DD-41: 08:15 as minutes after midnight
	} {
		t.Run(key, func(t *testing.T) {
			got, err := r.Get(context.Background(), key)
			if err != nil || got != want {
				t.Fatalf("Get(%s) = %v, %v; want %v", key, got, err, want)
			}
		})
	}
}
