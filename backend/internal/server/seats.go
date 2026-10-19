package server

import "context"

// Seat accounting (REQ-039, DD-12). Each operation is one conditional UPDATE, so concurrent
// callers cannot oversell: the CHECK on trips also refuses a total above capacity. They report
// whether a seat moved. Used by the request flow (T12, T13); there is no HTTP surface.

// holdSeat reserves a free seat on an active trip.
func holdSeat(ctx context.Context, db DB, tripID int64) (bool, error) {
	return seatUpdate(ctx, db, `
		UPDATE trips SET seats_held = seats_held + 1
		 WHERE id = $1 AND status = 'active' AND seats_held + seats_confirmed < capacity`, tripID)
}

// confirmSeat turns a held seat into a confirmed one.
func confirmSeat(ctx context.Context, db DB, tripID int64) (bool, error) {
	return seatUpdate(ctx, db, `
		UPDATE trips SET seats_held = seats_held - 1, seats_confirmed = seats_confirmed + 1
		 WHERE id = $1 AND seats_held > 0`, tripID)
}

// releaseHold gives a held seat back.
func releaseHold(ctx context.Context, db DB, tripID int64) (bool, error) {
	return seatUpdate(ctx, db, `UPDATE trips SET seats_held = seats_held - 1 WHERE id = $1 AND seats_held > 0`, tripID)
}

// releaseConfirmed gives a confirmed seat back, e.g. when the ride ends.
func releaseConfirmed(ctx context.Context, db DB, tripID int64) (bool, error) {
	return seatUpdate(ctx, db, `
		UPDATE trips SET seats_confirmed = seats_confirmed - 1 WHERE id = $1 AND seats_confirmed > 0`, tripID)
}

func seatUpdate(ctx context.Context, db DB, sql string, tripID int64) (bool, error) {
	tag, err := db.Exec(ctx, sql, tripID)
	return tag.RowsAffected() == 1, err
}
