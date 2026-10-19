-- +goose Up

-- Vehicle information shown to the passenger when the driver confirms (REQ-052). Created by SQL
-- like accounts (DD-19); not part of driver_profiles, which is recomputed from service records.
CREATE TABLE vehicles (
    user_id     bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    plate       text   NOT NULL,
    description text   NOT NULL
);

-- Placeholder demo vehicles for the seeded drivers; edit freely.
INSERT INTO vehicles (user_id, plate, description)
SELECT u.id, v.plate, v.description
FROM (VALUES
    ('driver1', 'ABC-1234', '白色 Toyota Altis'),
    ('driver2', 'BCD-2345', '黑色 Honda CR-V'),
    ('driver3', 'CDE-3456', '銀色 Nissan Sentra'),
    ('driver4', 'DEF-4567', '藍色 Mazda 3'),
    ('driver5', 'EFG-5678', '紅色 Toyota Yaris')
) v (username, plate, description)
JOIN users u ON u.username = v.username
ON CONFLICT DO NOTHING;

-- Master record of location reports (carpool-oi-11, option B): created when a user declares they
-- take part today. Reports go to the user's latest activity. trip_id is set when there is a trip
-- to link: a driver's at departure, a passenger's when the request is confirmed.
CREATE TABLE activities (
    id         bigserial PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users (id),
    role       text        NOT NULL CHECK (role IN ('driver', 'passenger')),
    trip_id    bigint      REFERENCES trips (id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_user_idx ON activities (user_id, id DESC);
CREATE INDEX activities_trip_idx ON activities (trip_id) WHERE trip_id IS NOT NULL;

-- Move existing reports under activities: one activity per (user, trip) pair already reported.
INSERT INTO activities (user_id, role, trip_id, created_at)
SELECT r.user_id,
       CASE WHEN r.trip_id IS NOT NULL OR NOT u.is_passenger THEN 'driver' ELSE 'passenger' END,
       r.trip_id,
       min(r.reported_at)
FROM location_reports r
JOIN users u ON u.id = r.user_id
GROUP BY r.user_id, r.trip_id, u.is_passenger;

ALTER TABLE location_reports ADD COLUMN activity_id bigint REFERENCES activities (id);

-- location_reports is append-only; lift the trigger for this one-off rewrite.
ALTER TABLE location_reports DISABLE TRIGGER location_reports_append_only;
UPDATE location_reports r SET activity_id = a.id
FROM activities a
WHERE a.user_id = r.user_id AND a.trip_id IS NOT DISTINCT FROM r.trip_id;
ALTER TABLE location_reports ENABLE TRIGGER location_reports_append_only;

ALTER TABLE location_reports ALTER COLUMN activity_id SET NOT NULL;
DROP INDEX location_reports_user_idx;
DROP INDEX location_reports_trip_idx;
ALTER TABLE location_reports DROP COLUMN user_id, DROP COLUMN trip_id;
CREATE INDEX location_reports_activity_idx ON location_reports (activity_id, id);

-- The simulated trips are already under way, so their drivers take part from the start.
INSERT INTO activities (user_id, role, trip_id)
SELECT t.driver_id, 'driver', t.id
FROM trips t
WHERE t.simulated AND t.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.trip_id = t.id AND a.role = 'driver');

-- +goose Down
-- Restores the previous shape: each report gets back its user and (for drivers) its trip.
ALTER TABLE location_reports
    ADD COLUMN user_id bigint REFERENCES users (id),
    ADD COLUMN trip_id bigint REFERENCES trips (id);

ALTER TABLE location_reports DISABLE TRIGGER location_reports_append_only;
UPDATE location_reports r SET user_id = a.user_id, trip_id = a.trip_id
FROM activities a
WHERE a.id = r.activity_id;
ALTER TABLE location_reports ENABLE TRIGGER location_reports_append_only;

ALTER TABLE location_reports ALTER COLUMN user_id SET NOT NULL;
DROP INDEX location_reports_activity_idx;
ALTER TABLE location_reports DROP COLUMN activity_id;
CREATE INDEX location_reports_user_idx ON location_reports (user_id, reported_at DESC);
CREATE INDEX location_reports_trip_idx ON location_reports (trip_id, reported_at) WHERE trip_id IS NOT NULL;

DROP TABLE activities;
DROP TABLE vehicles;
