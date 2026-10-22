-- +goose Up

-- Traffic and weather (Phase 2, REQ-076, DD-36): vehicle detectors near the park and a 15-minute
-- summary per detector, with the slot's weather on the same row. Columns follow TDX so real data can
-- replace the simulated rows later without changing the tables.
CREATE TABLE traffic_detectors (
    vd_id          text             PRIMARY KEY, -- TDX VDID
    road_name      text             NOT NULL,
    road_direction text             NOT NULL,
    lat            double precision NOT NULL,
    lng            double precision NOT NULL
);

CREATE TABLE traffic_observations (
    vd_id         text         NOT NULL REFERENCES traffic_detectors (vd_id),
    -- Start of the slot, on :00/:15/:30/:45 Taipei time; only the commute window 07:00-10:00 is kept.
    slot_start    timestamptz  NOT NULL,
    volume        integer      NOT NULL CHECK (volume >= 0),
    avg_speed_kmh numeric(5,1) NOT NULL CHECK (avg_speed_kmh >= 0),
    occupancy_pct numeric(4,1) NOT NULL CHECK (occupancy_pct BETWEEN 0 AND 100),
    -- CWA automatic station observation (O-A0001-001): station_id, station_name, obs_time, weather,
    -- air_temperature, precipitation. Every detector in a slot carries the same copy (DD-36).
    weather       jsonb        NOT NULL,
    simulated     boolean      NOT NULL, -- REQ-063
    PRIMARY KEY (vd_id, slot_start)
);
CREATE INDEX traffic_observations_slot_idx ON traffic_observations (slot_start);

-- Detectors on the main roads into the park, ids and positions from the Taipei VD static data
-- (TDX VD/City/Taipei, same feed as data.taipei VD.xml, updated 2026-10-22). road_direction is the
-- detection link's direction; for a two-way detector, the direction into the park.
INSERT INTO traffic_detectors (vd_id, road_name, road_direction, lat, lng) VALUES
    ('V6121A0', '堤頂大道',     'N', 25.05497, 121.57682),
    ('VRHT600', '堤頂大道',     'N', 25.07446, 121.57250),
    ('VSGRX60', '堤頂大道',     'N', 25.07713, 121.57025),
    ('VTXQL00', '堤頂大道',     'N', 25.08277, 121.56175),
    ('VTXQJ20', '內湖路一段',   'E', 25.08487, 121.55860),
    ('VTHRR20', '內湖路一段',   'E', 25.08208, 121.56698),
    ('VSXTK20', '內湖路一段',   'E', 25.08026, 121.57446),
    ('V6120C0', '環東大道',     'E', 25.05133, 121.57074),
    ('V6150C1', '環東大道',     'E', 25.05862, 121.58438),
    ('VQEUU60', '民權東路六段', 'E', 25.06845, 121.58360),
    ('VS6TI00', '瑞光路',       'SE', 25.07569, 121.57616),
    ('VTVXH20', '成功路四段',   'NE', 25.08307, 121.59383);

-- Demo clock (REQ-060, REQ-084, DD-41): minutes after midnight that Phase 2 uses as "now".
-- Delete the row to use the real clock.
INSERT INTO system_settings (key, value, unit, description) VALUES
    ('demo_clock', 495, 'min', 'Demo 模擬時間：Phase 2 的資料與畫面以今天的這個時間（0 點起的分鐘數）作為現在；刪除即使用實際時間')
ON CONFLICT (key) DO NOTHING;

-- "Now" for Phase 2 data (DD-41), from the real time the caller passes in. With demo_clock it is
-- today at that minute, and a Saturday or Sunday becomes the next Monday; without it, the real time.
-- Matching, trips, requests and timeouts keep the real clock (REQ-084).
-- +goose StatementBegin
CREATE FUNCTION commute_now(real_now timestamptz) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
    clock numeric;
    day   date := (real_now AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
    SELECT value INTO clock FROM system_settings WHERE key = 'demo_clock';
    IF NOT FOUND THEN
        RETURN real_now;
    END IF;
    IF clock < 0 OR clock >= 1440 OR clock <> trunc(clock) THEN
        RAISE EXCEPTION 'demo_clock must be a whole number of minutes in [0, 1440), got %', clock;
    END IF;
    day := day + CASE extract(isodow FROM day) WHEN 6 THEN 2 WHEN 7 THEN 1 ELSE 0 END;
    RETURN (day + make_interval(mins => clock::int)) AT TIME ZONE 'Asia/Taipei';
END;
$$;
-- +goose StatementEnd

-- The n workdays (Monday to Friday, public holidays not removed) before today, newest first (DD-36).
-- +goose StatementBegin
CREATE FUNCTION commute_past_workdays(today date, n integer) RETURNS SETOF date LANGUAGE sql IMMUTABLE AS $$
    SELECT d::date
      FROM generate_series(today - 1, today - (n * 2 + 7), interval '-1 day') d
     WHERE extract(isodow FROM d) < 6
     ORDER BY d DESC
     LIMIT n;
$$;
-- +goose StatementEnd

-- A pseudo-random number in [0, 1) for key, seeded by today's date (DD-40): the same today always
-- gives the same data, so rehearsals and the Demo show the same numbers.
-- +goose StatementBegin
CREATE FUNCTION commute_sim_random(today date, key text) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
    SELECT (hashtextextended(today::text || '/' || key, 0) & 2147483647)::double precision / 2147483648;
$$;
-- +goose StatementEnd

-- Regenerates the simulated traffic and weather around now (DD-40 steps 1 and 2); the Demo reset
-- calls it again (DD-29). Covers the past 10 workdays and today's complete slots before now, in the
-- commute window 07:00-10:00 only. Weather first: 2 or 3 of the 10 days rain for hours, from one of
-- the first slots to the end of the window. Then traffic from the weather: a peak around 08:15,
-- Friday the busiest, and in the rain more cars at lower speeds. Only simulated rows are replaced.
-- T37 continues from the same weather (traffic_observations) for the pickup-point statistics.
-- +goose StatementBegin
CREATE FUNCTION generate_commute_simulation(now_ timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    today date := (now_ AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
    DELETE FROM traffic_observations WHERE simulated;

    INSERT INTO traffic_observations (vd_id, slot_start, volume, avg_speed_kmh, occupancy_pct, weather, simulated)
    WITH days AS (
        SELECT d AS day,
               row_number() OVER (ORDER BY commute_sim_random(today, 'rain/' || d))
                 <= 2 + (commute_sim_random(today, 'rain-days') < 0.5)::int AS rainy
          FROM commute_past_workdays(today, 10) d
        UNION ALL
        SELECT today, commute_sim_random(today, 'rain/' || today) < 0.25
         WHERE extract(isodow FROM today) < 6
    ),
    slots AS (
        SELECT d.day, s.slot, (d.day + time '07:00' + s.slot * interval '15 minutes') AT TIME ZONE 'Asia/Taipei' AS slot_start,
               d.rainy AND s.slot >= floor(commute_sim_random(today, 'rain-start/' || d.day) * 4) AS raining
          FROM days d CROSS JOIN generate_series(0, 11) s (slot)
    ),
    weathered AS (
        SELECT sl.*,
               CASE WHEN sl.raining THEN round((0.5 + commute_sim_random(today, 'mm/' || sl.slot_start) * 3.5)::numeric, 1)
                    ELSE 0 END AS precipitation,
               CASE WHEN sl.raining THEN '陰有雨'
                    WHEN EXISTS (SELECT 1 FROM days d WHERE d.day = sl.day AND d.rainy) THEN '陰'
                    WHEN commute_sim_random(today, 'sky/' || sl.day) < 0.5 THEN '晴'
                    ELSE '多雲' END AS sky,
               round((18 + commute_sim_random(today, 'temp/' || sl.day) * 6 + sl.slot * 0.15
                      - CASE WHEN sl.raining THEN 2 ELSE 0 END)::numeric, 1) AS temperature
          FROM slots sl
         WHERE sl.slot_start + interval '15 minutes' <= now_ OR sl.day < today
    ),
    cells AS (
        SELECT w.*, v.vd_id,
               -- Peak shape: 1 at 08:15 (slot 5), about 0.55 at the window's ends.
               0.55 + 0.45 * exp(-power(w.slot - 5, 2) / 8.0) AS shape,
               CASE extract(isodow FROM w.day) WHEN 5 THEN 1.15 WHEN 1 THEN 1.02 WHEN 4 THEN 1.0 ELSE 0.97 END AS dow,
               120 + commute_sim_random(today, 'base/' || v.vd_id) * 280 AS base_volume,
               50 + commute_sim_random(today, 'free/' || v.vd_id) * 20 AS free_speed,
               commute_sim_random(today, 'volume/' || v.vd_id || '/' || w.slot_start) AS volume_noise,
               commute_sim_random(today, 'speed/' || v.vd_id || '/' || w.slot_start) AS speed_noise
          FROM weathered w CROSS JOIN traffic_detectors v
    ),
    measured AS (
        SELECT c.*,
               round(c.base_volume * c.shape * c.dow * CASE WHEN c.raining THEN 1.1 ELSE 1 END
                     * (0.92 + c.volume_noise * 0.16)) AS volume,
               c.free_speed * (1 - 0.45 * (c.shape - 0.55) / 0.45)
                 * CASE WHEN c.dow > 1.1 THEN 0.92 ELSE 1 END
                 * CASE WHEN c.raining THEN 0.75 ELSE 1 END
                 * (0.95 + c.speed_noise * 0.1) AS speed
          FROM cells c
    )
    SELECT m.vd_id, m.slot_start, m.volume, round(m.speed::numeric, 1),
           round(least(95, 4 + 70 * (1 - m.speed / m.free_speed))::numeric, 1),
           jsonb_build_object(
               'station_id', 'C0A9F0', -- CWA automatic station 內湖
               'station_name', '內湖',
               'obs_time', to_char((m.slot_start + interval '10 minutes') AT TIME ZONE 'Asia/Taipei',
                                   'YYYY-MM-DD"T"HH24:MI:SS"+08:00"'),
               'weather', m.sky,
               'air_temperature', m.temperature,
               'precipitation', m.precipitation), -- mm in this slot
           true
      FROM measured m;
END;
$$;
-- +goose StatementEnd

SELECT generate_commute_simulation(commute_now(now()));

-- +goose Down
DROP FUNCTION generate_commute_simulation(timestamptz);
DROP FUNCTION commute_sim_random(date, text);
DROP FUNCTION commute_past_workdays(date, integer);
DROP FUNCTION commute_now(timestamptz);
DELETE FROM system_settings WHERE key = 'demo_clock';
DROP TABLE traffic_observations;
DROP TABLE traffic_detectors;
