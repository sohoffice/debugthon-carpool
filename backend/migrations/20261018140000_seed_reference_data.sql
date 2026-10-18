-- +goose Up

-- Demo seed data (T03). Every statement is idempotent, so the script can be re-run by hand.

-- Pickup points (REQ-002), on the ground-level car-park access lanes, before the ramp goes underground:
-- 世貿 on the lane off 信義路五段 leading to the 世貿一館 car park; 大巨蛋 on the west side, 光復南路. radius_m is the area used to decide a vehicle has passed (DD-06).
INSERT INTO pickup_points (name, lat, lng, radius_m) VALUES
    ('松山車站', 25.049806, 121.578206, 80),
    ('台北世貿中心', 25.033150, 121.561900, 80),
    ('台北大巨蛋', 25.044249, 121.557934, 80)
ON CONFLICT (name) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m;

-- Neihu Science Park boundary ring: south to 陽光街 and the southern 瑞光路, south-west edge along
-- 堤頂大道 (kept off the 基隆河 bank and the 中山高 interchange). DO UPDATE so a re-run
-- (or a DB seeded with an older ring) ends with this ring.
INSERT INTO park_boundary_points (seq, lat, lng) VALUES
    (1, 25.086, 121.5655),
    (2, 25.084, 121.579),
    (3, 25.077, 121.5805),
    (4, 25.071, 121.58),
    (5, 25.0712, 121.576),
    (6, 25.0732, 121.5736),
    (7, 25.075, 121.5722),
    (8, 25.0807, 121.5627),
    (9, 25.0825, 121.5645)
ON CONFLICT (seq) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;

-- Bus stops inside the park boundary, imported from docs/data/busstop/busstops.csv.
INSERT INTO bus_stops (stop_id, name, lat, lng) VALUES
    (424, '港墘', 25.080919190818054, 121.57806788111567),
    (997, '捷運港墘站(內湖高工)', 25.0801493693391, 121.574618145655),
    (1001, '內湖基湖路口', 25.08198997, 121.5652273),
    (1007, '仁寶大樓', 25.07921316, 121.5684974),
    (1013, '瑞光港墘路口', 25.077753, 121.571868),
    (1039, '西湖國中', 25.08562294, 121.5656019),
    (1041, '西湖圖書館(湖光教會)', 25.078683, 121.578396),
    (1075, '恕德家商', 25.0819632554949, 121.56904542401),
    (1083, '基湖站', 25.07973077, 121.5646071),
    (1105, '港墘', 25.08055757, 121.5775386),
    (1106, '港墘路', 25.075848, 121.574502),
    (1116, '陽光街', 25.073056, 121.576692),
    (1117, '陽光街', 25.073152, 121.577744),
    (1132, '瑞光路', 25.074821, 121.577343),
    (1149, '麗山高中(環山)', 25.08405797, 121.5768304),
    (1150, '麗山高中(港墘)', 25.08352, 121.57808),
    (1153, '麗山街', 25.081473, 121.571386),
    (4084, '麗山國中', 25.0806380998734, 121.573860343024),
    (4657, '港墘派出所', 25.078636, 121.57619),
    (8402, '內湖基湖路口', 25.08167506, 121.5653587),
    (8403, '基湖路口', 25.0805158061818, 121.565903409458),
    (8404, '基湖路口', 25.08025003, 121.5662362),
    (8405, '基湖站', 25.0801, 121.56489),
    (8410, '麗山街', 25.081132, 121.57184),
    (8527, '捷運港墘站(內湖高工)', 25.0798366021365, 121.57610868441),
    (8607, '麗山高中(環山)', 25.08421544, 121.5767705),
    (8612, '內湖運動中心', 25.077240508774, 121.575587990787),
    (8613, '港墘路', 25.075813, 121.574688),
    (8631, '麗山高中(港墘)', 25.08298972, 121.5783099),
    (50511, '西湖國中', 25.08514, 121.56545),
    (50515, '恕德家商', 25.082118261496, 121.569461375068),
    (1000499, '西湖圖書館(湖光教會)', 25.07910692, 121.5779835),
    (1000698, '捷運西湖站', 25.0821974042872, 121.565884872161),
    (1000723, '捷運西湖站', 25.0824213906562, 121.565868143978),
    (1000864, '金泰公園', 25.07803318, 121.5674816),
    (1000895, '瑞光港墘路口', 25.077273, 121.573134),
    (1000896, '仁寶大樓', 25.07878172, 121.5704605),
    (1000897, '瑞光路', 25.07478024553194, 121.57766690657958),
    (1001465, '港墘派出所', 25.0787, 121.57642),
    (1165604812, '西湖圖書館(湖光教會)', 25.07889, 121.578499),
    (1165604813, '西湖圖書館(湖光教會)', 25.078956, 121.57768),
    (1165604849, '捷運西湖站', 25.082292, 121.566608),
    (1165608385, '瑞光港墘路口', 25.078319, 121.570459)
ON CONFLICT (stop_id) DO NOTHING;

-- Self-selected tags only; no corporate issuer in the PoC (DD-05).
INSERT INTO tags (name, issuer) VALUES
    ('不抽菸', 'self'),
    ('可載行李', 'self'),
    ('安靜通勤', 'self'),
    ('可聊天', 'self'),
    ('可帶寵物', 'self'),
    ('女性友善', 'self')
ON CONFLICT (name) DO NOTHING;

-- Tags the simulated drivers carry, so a preferred-tag filter has something to match.
INSERT INTO user_tags (user_id, tag_id)
SELECT u.id, t.id FROM (VALUES
    ('driver2', '可載行李'),
    ('driver3', '不抽菸'),
    ('driver3', '安靜通勤')
) v (username, tag) JOIN users u ON u.username = v.username JOIN tags t ON t.name = v.tag
ON CONFLICT DO NOTHING;

-- Simulated trips for driver1-3, all from 松山車站 with auto-accept on. driver4 and driver5 have
-- no trip, so a person can depart from the driver UI. The trade-off for proposal 7.3: with a
-- passenger heading to 瑞光路 who accepts a nearby stop, driver1 and driver3 match the
-- destination (driver3 also has the suggested tag), driver2 only passes bus stops.
INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
                   capacity, auto_accept, status, settings_locked, started_at, simulated)
SELECT u.id, p.id, v.dest, v.lat, v.lng, v.capacity, true, 'active', true, now(), true
FROM (VALUES
    ('driver1', '瑞光路 內科大樓 A', 25.0768, 121.5738, 3),
    ('driver2', '基湖路 內科大樓 B', 25.0805, 121.5668, 4),
    ('driver3', '瑞光路 內科大樓 C', 25.0763, 121.5750, 2)
) v (username, dest, lat, lng, capacity)
JOIN users u ON u.username = v.username
JOIN pickup_points p ON p.name = '松山車站'
WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = u.id AND t.simulated);

-- +goose Down
-- Only works on a freshly seeded DB: once a demo has run, location_reports (append-only) and
-- requests reference these rows; use `just backend db-reset` then.
DELETE FROM trips WHERE simulated AND driver_id IN
    (SELECT id FROM users WHERE username IN ('driver1', 'driver2', 'driver3'));
DELETE FROM user_tags WHERE user_id IN (SELECT id FROM users WHERE username IN ('driver2', 'driver3'));
DELETE FROM tags WHERE name IN ('不抽菸', '可載行李', '安靜通勤', '可聊天', '可帶寵物', '女性友善');
DELETE FROM bus_stops WHERE stop_id IN (424, 997, 1001, 1007, 1013, 1039, 1041, 1075, 1083, 1105, 1106, 1116, 1117, 1132, 1149, 1150, 1153, 4084, 4657, 8402, 8403, 8404, 8405, 8410, 8527, 8607, 8612, 8613, 8631, 50511, 50515, 1000499, 1000698, 1000723, 1000864, 1000895, 1000896, 1000897, 1001465, 1165604812, 1165604813, 1165604849, 1165608385);
DELETE FROM park_boundary_points;
DELETE FROM pickup_points WHERE name IN ('松山車站', '台北世貿中心', '台北大巨蛋');
