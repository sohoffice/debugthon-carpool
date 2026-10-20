-- +goose Up

-- driver2 is the car that only works through a bus stop (proposal 7.3). With the simulated
-- straight-line route, its old destination (基湖路, 25.0805, 121.5668) bypassed every stop
-- passenger1 accepts, so the car was screened out instead of competing on wait vs walk. The new
-- destination lies beyond 瑞光港墘路口 (stop 1013), so the route passes it while the destination
-- stays more than the address match distance away from passenger1's 瑞光路 513 巷. The stored
-- route is cleared; it is rebuilt on the next read (DD-21).
UPDATE trips SET destination_lat = 25.0815, destination_lng = 121.5705,
                 route_polyline = NULL, route_distance_m = NULL, route_duration_s = NULL, route_simulated = NULL
WHERE simulated AND status = 'active' AND destination_lat = 25.0805 AND destination_lng = 121.5668
  AND driver_id = (SELECT id FROM users WHERE username = 'driver2');
DELETE FROM trip_route_stops WHERE trip_id IN (
    SELECT id FROM trips WHERE simulated AND destination_lat = 25.0815 AND destination_lng = 121.5705
        AND driver_id = (SELECT id FROM users WHERE username = 'driver2'));

-- +goose Down
UPDATE trips SET destination_lat = 25.0805, destination_lng = 121.5668,
                 route_polyline = NULL, route_distance_m = NULL, route_duration_s = NULL, route_simulated = NULL
WHERE simulated AND destination_lat = 25.0815 AND destination_lng = 121.5705
  AND driver_id = (SELECT id FROM users WHERE username = 'driver2');
DELETE FROM trip_route_stops WHERE trip_id IN (
    SELECT id FROM trips WHERE simulated AND destination_lat = 25.0805 AND destination_lng = 121.5668
        AND driver_id = (SELECT id FROM users WHERE username = 'driver2'));
