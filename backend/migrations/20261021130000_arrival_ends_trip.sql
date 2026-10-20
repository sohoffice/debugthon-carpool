-- +goose Up
-- DD-30: once the car has passed its pickup point, a driver report within this distance of the
-- trip's destination ends the trip. Read on every report, like pass_margin (DD-20).
INSERT INTO system_settings (key, value, unit, description) VALUES
    ('arrival_radius', 50, 'm', '抵達距離：經過上車點之後，車輛離駕駛目的地這個距離內即視為抵達，行程結束')
ON CONFLICT (key) DO NOTHING;

-- REQ-050: a request still waiting when its trip ends moves to the next car; the candidate it
-- leaves records why.
ALTER TABLE request_candidates DROP CONSTRAINT request_candidates_outcome_check;
ALTER TABLE request_candidates ADD CONSTRAINT request_candidates_outcome_check
    CHECK (outcome IN ('declined', 'timed_out', 'trip_ended', 'accepted'));

-- +goose Down
UPDATE request_candidates SET outcome = 'timed_out' WHERE outcome = 'trip_ended';
ALTER TABLE request_candidates DROP CONSTRAINT request_candidates_outcome_check;
ALTER TABLE request_candidates ADD CONSTRAINT request_candidates_outcome_check
    CHECK (outcome IN ('declined', 'timed_out', 'accepted'));
DELETE FROM system_settings WHERE key = 'arrival_radius';
