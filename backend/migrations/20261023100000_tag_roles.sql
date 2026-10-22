-- +goose Up

-- DD-42: each tag records the side it applies to and the wording for each side and use.
-- A label exists exactly when the tag applies to that side: a driver tag has the driver's
-- self label and the passenger's filter label, a passenger tag the other two.
ALTER TABLE tags
    ADD COLUMN applies_to             text NOT NULL DEFAULT 'both' CHECK (applies_to IN ('driver', 'passenger', 'both')),
    ADD COLUMN driver_self_label      text,
    ADD COLUMN driver_filter_label    text,
    ADD COLUMN passenger_self_label   text,
    ADD COLUMN passenger_filter_label text;

-- These tags are dropped from the list. trip_tag_filters and request_tag_filters reference tags
-- without ON DELETE, so their filter rows go first.
DELETE FROM trip_tag_filters WHERE tag_id IN (SELECT id FROM tags WHERE name IN ('可帶寵物', '女性友善'));
DELETE FROM request_tag_filters WHERE tag_id IN (SELECT id FROM tags WHERE name IN ('可帶寵物', '女性友善'));
DELETE FROM user_tags WHERE tag_id IN (SELECT id FROM tags WHERE name IN ('可帶寵物', '女性友善'));
DELETE FROM tags WHERE name IN ('可帶寵物', '女性友善');

UPDATE tags t
   SET applies_to = v.applies_to, driver_self_label = v.ds, driver_filter_label = v.df,
       passenger_self_label = v.ps, passenger_filter_label = v.pf
  FROM (VALUES
    ('不抽菸', 'both', '我不抽菸', '不抽菸的乘客', '我不抽菸', '不抽菸'),
    ('安靜通勤', 'both', '開車喜歡安靜', '喜歡安靜的乘客', '喜歡安靜', '安靜坐車'),
    ('可聊天', 'both', '可以聊天', '可以聊天的乘客', '可以聊天', '可以聊天'),
    ('可載行李', 'driver', '車上能放大件行李', NULL, NULL, '能放大件行李')
  ) v (name, applies_to, ds, df, ps, pf)
 WHERE t.name = v.name;

ALTER TABLE tags
    ALTER COLUMN applies_to DROP DEFAULT,
    ADD CONSTRAINT tags_labels_match_side CHECK (
        (applies_to IN ('driver', 'both')) = (driver_self_label IS NOT NULL)
        AND (applies_to IN ('driver', 'both')) = (passenger_filter_label IS NOT NULL)
        AND (applies_to IN ('passenger', 'both')) = (passenger_self_label IS NOT NULL)
        AND (applies_to IN ('passenger', 'both')) = (driver_filter_label IS NOT NULL));

-- REQ-008: a user keeps only the tags that apply to one of their roles.
DELETE FROM user_tags ut
 USING users u, tags t
 WHERE u.id = ut.user_id AND t.id = ut.tag_id
   AND NOT ((u.is_driver AND t.applies_to IN ('driver', 'both'))
         OR (u.is_passenger AND t.applies_to IN ('passenger', 'both')));

-- REQ-013: a driver's filter is always required. This also drops driver4's seeded 不抽菸
-- suggestion (20261020120000_seed_demo_habitual_data.sql).
DELETE FROM trip_tag_filters WHERE intent <> 'required';
ALTER TABLE trip_tag_filters DROP CONSTRAINT trip_tag_filters_intent_check;
ALTER TABLE trip_tag_filters ADD CONSTRAINT trip_tag_filters_intent_check CHECK (intent = 'required');

-- The Demo reset (DD-29) calls this function; it no longer writes driver4's suggested filter,
-- which the CHECK above would reject. driver4's ended trip now carries no filter.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION seed_demo_habitual_data() RETURNS void LANGUAGE sql AS $$
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

    -- driver4's ended trip, without tag filters.
    INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng,
                       capacity, auto_accept, status, settings_locked, started_at, ended_at, simulated)
    SELECT u.id, p.id, '瑞光路 513 巷', 25.0765, 121.5742, 3, false, 'completed', true,
           now() - interval '1 day 30 minutes', now() - interval '1 day', false
    FROM users u JOIN pickup_points p ON p.name = '松山車站'
    WHERE u.username = 'driver4';
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION seed_demo_habitual_data() RETURNS void LANGUAGE sql AS $$
    INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng)
    SELECT u.id, '瑞光路 513 巷', 25.0765, 121.5742
    FROM users u WHERE u.username = 'passenger1'
    ON CONFLICT DO NOTHING;

    INSERT INTO passenger_accepted_stops (user_id, bus_stop_id)
    SELECT u.id, b.id
    FROM users u JOIN bus_stops b ON b.stop_id IN (1013, 1106)
    WHERE u.username = 'passenger1'
    ON CONFLICT DO NOTHING;

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
ALTER TABLE trip_tag_filters DROP CONSTRAINT trip_tag_filters_intent_check;
ALTER TABLE trip_tag_filters ADD CONSTRAINT trip_tag_filters_intent_check CHECK (intent IN ('required', 'preferred'));
ALTER TABLE tags
    DROP CONSTRAINT tags_labels_match_side,
    DROP COLUMN applies_to,
    DROP COLUMN driver_self_label,
    DROP COLUMN driver_filter_label,
    DROP COLUMN passenger_self_label,
    DROP COLUMN passenger_filter_label;
-- Deleted user tags and filters are not restored.
INSERT INTO tags (name, issuer) VALUES ('可帶寵物', 'self'), ('女性友善', 'self') ON CONFLICT (name) DO NOTHING;
