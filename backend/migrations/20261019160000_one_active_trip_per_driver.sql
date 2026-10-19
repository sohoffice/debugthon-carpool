-- +goose Up
-- A driver departs once at a time (T05); the index also settles two departures racing each other.
CREATE UNIQUE INDEX trips_one_active_per_driver ON trips (driver_id) WHERE status = 'active';

-- +goose Down
DROP INDEX trips_one_active_per_driver;
