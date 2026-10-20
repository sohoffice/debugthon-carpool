-- +goose Up

-- Demo pre-filled data (DD-19). passenger1 starts with a usual destination and accepted bus
-- stops; driver4 starts with one ended trip, so the driver UI offers its settings as defaults
-- (REQ-016, REQ-025). passenger2 and driver5 get nothing: they show first-time use. The values
-- are replaced by the recomputation from service records at the account's first completed ride.
-- usual_arrival_time stays null: DD-19 does not seed it. No driver_profiles row for driver4:
-- that stays computed from rides.
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

-- driver4's ended trip. Not simulated (the simulated trips are driver1-3's) and not active (one
-- active trip per driver), so only the defaults endpoint reads it.
INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
                   capacity, auto_accept, status, settings_locked, started_at, ended_at, simulated)
SELECT u.id, p.id, '瑞光路 513 巷', 25.0765, 121.5742, 3, false, 'completed', true,
       now() - interval '1 day 30 minutes', now() - interval '1 day', false
FROM users u JOIN pickup_points p ON p.name = '松山車站'
WHERE u.username = 'driver4'
  AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = u.id);

-- 不抽菸 is a suggestion (preferred), not a requirement.
INSERT INTO trip_tag_filters (trip_id, tag_id, intent)
SELECT t.id, g.id, 'preferred'
FROM trips t JOIN users u ON u.id = t.driver_id AND u.username = 'driver4'
JOIN tags g ON g.name = '不抽菸'
WHERE NOT t.simulated AND t.status = 'completed' AND t.destination_name = '瑞光路 513 巷'
ON CONFLICT DO NOTHING;

-- +goose Down
-- Removes only the rows above (the filter rows cascade with the trip, the accepted stops with the profile).
DELETE FROM trips WHERE NOT simulated AND status = 'completed' AND destination_name = '瑞光路 513 巷'
    AND driver_id = (SELECT id FROM users WHERE username = 'driver4');
DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'passenger1');
