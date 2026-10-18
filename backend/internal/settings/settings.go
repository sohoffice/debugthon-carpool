// Package settings reads matching parameters from system_settings (DD-20).
package settings

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a key has no row in system_settings.
var ErrNotFound = errors.New("setting not found")

// Querier is satisfied by *pgxpool.Pool and pgx.Tx.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Reader reads settings straight from the database on every call, so a value
// edited with SQL takes effect without restarting the service.
type Reader struct{ db Querier }

func New(db Querier) *Reader { return &Reader{db: db} }

// Get returns the current value of key.
func (r *Reader) Get(ctx context.Context, key string) (float64, error) {
	var v float64
	err := r.db.QueryRow(ctx, `SELECT value::float8 FROM system_settings WHERE key = $1`, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return v, err
}
