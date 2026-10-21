-- +goose Up

-- T23: with real routes (Google Routes) driver2's destination from 20261020120100 is reached via
-- 金泰公園 and 恕德家商 and passes none of passenger1's accepted stops, so the wait-vs-walk
-- trade-off of the demo is lost. At 25.0790, 121.5690 the real route passes 瑞光港墘路口 (stop
-- 1013) and the destination stays about 590 m from 瑞光路 513 巷. Offline, on the simulated
-- straight line, driver2 then takes no part in the trade-off. The latest simulated trip moves
-- (the Demo reset restarts it); its stored route is cleared and rebuilt on the next read (DD-21).
UPDATE trips SET destination_name = '瑞光路 內科大樓 B', destination_lat = 25.0790, destination_lng = 121.5690,
                 route_polyline = NULL, route_distance_m = NULL, route_duration_s = NULL, route_simulated = NULL
WHERE id = (SELECT t.id FROM trips t JOIN users u ON u.id = t.driver_id
             WHERE u.username = 'driver2' AND t.simulated ORDER BY t.id DESC LIMIT 1)
  AND destination_lat = 25.0815 AND destination_lng = 121.5705;
DELETE FROM trip_route_stops WHERE trip_id IN (
    SELECT t.id FROM trips t JOIN users u ON u.id = t.driver_id
     WHERE u.username = 'driver2' AND t.simulated AND t.destination_lat = 25.0790 AND t.destination_lng = 121.5690);

-- +goose Down
UPDATE trips SET destination_name = '瑞光路 內科大樓 B', destination_lat = 25.0815, destination_lng = 121.5705,
                 route_polyline = NULL, route_distance_m = NULL, route_duration_s = NULL, route_simulated = NULL
WHERE simulated AND destination_lat = 25.0790 AND destination_lng = 121.5690
  AND driver_id = (SELECT id FROM users WHERE username = 'driver2');
DELETE FROM trip_route_stops WHERE trip_id IN (
    SELECT id FROM trips WHERE simulated AND destination_lat = 25.0815 AND destination_lng = 121.5705
        AND driver_id = (SELECT id FROM users WHERE username = 'driver2'));
