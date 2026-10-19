-- +goose Up

-- Demo seed beyond T03 (docs/ui-design.md 10.2): passenger1's habitual data, so the passenger app
-- opens on the supply board, and a finished trip for driver4, so the departure screen is
-- prefilled (REQ-016). passenger2 and driver5 keep none, to show the first-time screens.
-- One function, run here and again by the demo reset (POST /api/demo/reset, UD-18).
-- +goose StatementBegin
CREATE FUNCTION demo_seed_extras() RETURNS void LANGUAGE sql AS $$
    DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1');
    INSERT INTO passenger_profiles (user_id, usual_arrival_time, usual_destination_name, usual_destination_lat, usual_destination_lng)
    SELECT id, '08:15', '瑞光路 513 巷', 25.0765, 121.5742 FROM users WHERE username = 'passenger1';
    INSERT INTO passenger_accepted_stops (user_id, bus_stop_id)
    SELECT u.id, b.id FROM users u, bus_stops b
     WHERE u.username = 'passenger1' AND b.stop_id IN (1013, 1106); -- 瑞光港墘路口, 港墘路

    WITH trip AS (
        INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
                           capacity, auto_accept, status, settings_locked, started_at, ended_at)
        SELECT u.id, p.id, '瑞光路 513 巷', 25.0765, 121.5742, 3, false, 'completed', true,
               now() - interval '1 day', now() - interval '1 day' + interval '20 minutes'
          FROM users u, pickup_points p WHERE u.username = 'driver4' AND p.name = '松山車站'
        RETURNING id
    )
    INSERT INTO trip_tag_filters (trip_id, tag_id, intent)
    SELECT trip.id, t.id, 'preferred' FROM trip, tags t WHERE t.name = '不抽菸';
$$;
-- +goose StatementEnd

SELECT demo_seed_extras();

-- +goose Down
DELETE FROM trip_tag_filters WHERE trip_id IN
    (SELECT id FROM trips WHERE NOT simulated AND driver_id = (SELECT id FROM users WHERE username = 'driver4'));
DELETE FROM trips WHERE NOT simulated AND status = 'completed'
    AND driver_id = (SELECT id FROM users WHERE username = 'driver4')
    AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.trip_id = trips.id);
DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1');
DROP FUNCTION demo_seed_extras();
