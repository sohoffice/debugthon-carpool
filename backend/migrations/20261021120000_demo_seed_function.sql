-- +goose Up

-- The Demo pre-filled data (DD-19) as one function, so the Demo reset (DD-29) puts back the same
-- values the seed wrote instead of keeping its own copy. The values match
-- 20261020120000_seed_demo_habitual_data.sql; TestDemoSeedFunctionMatchesMigration guards that.
-- The caller clears the demo accounts' profiles first. Every call adds one ended trip for driver4,
-- so it becomes driver4's latest trip and the driver UI prefills the seeded settings again.
-- +goose StatementBegin
CREATE FUNCTION seed_demo_habitual_data() RETURNS void LANGUAGE sql AS $$
    INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng)
    SELECT u.id, '瑞光路 513 巷', 25.0765, 121.5742
    FROM users u WHERE u.username = 'passenger1'
    ON CONFLICT DO NOTHING;

    -- 瑞光港墘路口 (stop 1013) and 港墘路 (stop 1106).
    INSERT INTO passenger_accepted_stops (user_id, bus_stop_id)
    SELECT u.id, b.id
    FROM users u JOIN bus_stops b ON b.stop_id IN (1013, 1106)
    WHERE u.username = 'passenger1'
    ON CONFLICT DO NOTHING;

    -- driver4's ended trip; 不抽菸 is a suggestion (preferred), not a requirement.
    WITH trip AS (
        INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
                           capacity, auto_accept, status, settings_locked, started_at, ended_at, simulated)
        SELECT u.id, p.id, '瑞光路 513 巷', 25.0765, 121.5742, 3, false, 'completed', true,
               now() - interval '1 day 30 minutes', now() - interval '1 day', false
        FROM users u JOIN pickup_points p ON p.name = '松山車站'
        WHERE u.username = 'driver4'
        RETURNING id
    )
    INSERT INTO trip_tag_filters (trip_id, tag_id, intent)
    SELECT trip.id, g.id, 'preferred' FROM trip JOIN tags g ON g.name = '不抽菸';
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION seed_demo_habitual_data();
