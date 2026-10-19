-- +goose Up

-- Request flow (T12, T13). A request can also be boarded (DD-27) or cancelled before boarding
-- (docs/ui-design.md UD-17).
ALTER TABLE ride_requests DROP CONSTRAINT ride_requests_status_check;
ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check
    CHECK (status IN ('submitted', 'rejected', 'waiting_driver', 'no_match',
                      'confirmed', 'boarded', 'completed', 'cancelled'));
ALTER TABLE ride_requests
    ADD COLUMN boarded_at   timestamptz,
    ADD COLUMN cancelled_at timestamptz;

-- At most one open request per passenger; a second submission is 409 request_active.
CREATE UNIQUE INDEX ride_requests_one_open_per_passenger ON ride_requests (passenger_id)
    WHERE status IN ('submitted', 'waiting_driver', 'confirmed', 'boarded');

-- Waiting requests whose driver confirm timeout has passed are found by deadline (DD-13).
CREATE INDEX ride_requests_deadline_idx ON ride_requests (response_deadline_at)
    WHERE status = 'waiting_driver';

-- The stops the passenger accepted on this request; a completed ride makes them the passenger's
-- habitual stops (DD-19).
CREATE TABLE request_accepted_stops (
    request_id  bigint NOT NULL REFERENCES ride_requests (id) ON DELETE CASCADE,
    bus_stop_id bigint NOT NULL REFERENCES bus_stops (id),
    PRIMARY KEY (request_id, bus_stop_id)
);

-- +goose Down
DROP TABLE request_accepted_stops;
DROP INDEX ride_requests_deadline_idx;
DROP INDEX ride_requests_one_open_per_passenger;
ALTER TABLE ride_requests DROP COLUMN cancelled_at, DROP COLUMN boarded_at;
ALTER TABLE ride_requests DROP CONSTRAINT ride_requests_status_check;
ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check
    CHECK (status IN ('submitted', 'rejected', 'waiting_driver', 'no_match', 'confirmed', 'completed'));
