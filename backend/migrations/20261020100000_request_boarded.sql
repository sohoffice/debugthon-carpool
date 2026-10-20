-- +goose Up
-- DD-27: a confirmed request can be marked boarded by the passenger or the driver. The seat stays
-- occupied until the ride is completed, so only the status and its timestamp are added.
ALTER TABLE ride_requests DROP CONSTRAINT ride_requests_status_check;
ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check
    CHECK (status IN ('submitted', 'rejected', 'waiting_driver', 'no_match', 'confirmed', 'boarded', 'completed'));
ALTER TABLE ride_requests ADD COLUMN boarded_at timestamptz;

-- The timeout sweeper (DD-13) looks for overdue waiting requests.
CREATE INDEX ride_requests_deadline_idx ON ride_requests (response_deadline_at) WHERE status = 'waiting_driver';

-- +goose Down
DROP INDEX ride_requests_deadline_idx;
ALTER TABLE ride_requests DROP COLUMN boarded_at;
UPDATE ride_requests SET status = 'confirmed' WHERE status = 'boarded';
ALTER TABLE ride_requests DROP CONSTRAINT ride_requests_status_check;
ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check
    CHECK (status IN ('submitted', 'rejected', 'waiting_driver', 'no_match', 'confirmed', 'completed'));
