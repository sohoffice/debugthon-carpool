-- +goose Up

-- Driver points (REQ-071, REQ-072, DD-34): the balance lives on driver_profiles and every change is
-- a ledger row, written in one transaction so the balance always equals the ledger's sum.
ALTER TABLE driver_profiles ADD COLUMN point_balance integer NOT NULL DEFAULT 0;

CREATE TABLE driver_point_ledger (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    driver_id         bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    delta             integer     NOT NULL,
    reason            text        NOT NULL CHECK (reason IN ('ride', 'seed')),
    -- One ride is credited once; a seed row has no ride behind it.
    service_record_id bigint UNIQUE REFERENCES service_records (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    CHECK ((reason = 'ride') = (service_record_id IS NOT NULL))
);
CREATE INDEX driver_point_ledger_driver_idx ON driver_point_ledger (driver_id, created_at DESC, id DESC);

INSERT INTO system_settings (key, value, unit, description) VALUES
    ('points_per_ride', 10, 'pt', '每次共乘點數：每完成一位乘客的共乘，駕駛增加的點數')
ON CONFLICT (key) DO NOTHING;

-- The demo drivers' starting points (REQ-073, DD-34) as a function, so the Demo reset (DD-29) puts
-- back the same state. Every demo driver gets a driver_profiles row (usual data left empty) and,
-- once, a few seed rows; driver4 has the most, to show in the driver drawer (DD-35). The balance
-- becomes the sum of the seed rows, so the caller deletes the demo drivers' ride rows first.
-- +goose StatementBegin
CREATE FUNCTION seed_demo_driver_points() RETURNS void LANGUAGE sql AS $$
    INSERT INTO driver_profiles (user_id)
    SELECT id FROM users WHERE simulated AND is_driver
    ON CONFLICT DO NOTHING;

    INSERT INTO driver_point_ledger (driver_id, delta, reason, created_at)
    SELECT u.id, 10, 'seed', now() - make_interval(days => d)
      FROM users u
      JOIN (VALUES ('driver1', 3), ('driver2', 2), ('driver3', 4), ('driver4', 8), ('driver5', 1)) s (username, n)
        ON s.username = u.username
     CROSS JOIN LATERAL generate_series(1, s.n) d
     WHERE NOT EXISTS (SELECT 1 FROM driver_point_ledger l WHERE l.driver_id = u.id AND l.reason = 'seed');

    UPDATE driver_profiles p
       SET point_balance = (SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger l
                             WHERE l.driver_id = p.user_id AND l.reason = 'seed')
      FROM users u
     WHERE u.id = p.user_id AND u.simulated;
$$;
-- +goose StatementEnd

SELECT seed_demo_driver_points();

-- +goose Down
DROP FUNCTION seed_demo_driver_points();
DELETE FROM system_settings WHERE key = 'points_per_ride';
DROP TABLE driver_point_ledger;
ALTER TABLE driver_profiles DROP COLUMN point_balance;
