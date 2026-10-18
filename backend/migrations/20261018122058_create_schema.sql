-- +goose Up

-- Accounts. Created by SQL only (DD-19); the bearer token names the account (DD-18).
CREATE TABLE users (
    id           bigserial PRIMARY KEY,
    username     text    NOT NULL UNIQUE,
    display_name text    NOT NULL,
    is_driver    boolean NOT NULL DEFAULT false,
    is_passenger boolean NOT NULL DEFAULT false,
    simulated    boolean NOT NULL DEFAULT false,
    CHECK (is_driver OR is_passenger)
);

-- Tags: a predefined list with an issuer (DD-05); users pick the ones that apply to them.
CREATE TABLE tags (
    id     bigserial PRIMARY KEY,
    name   text NOT NULL UNIQUE,
    issuer text NOT NULL DEFAULT 'self'
);

CREATE TABLE user_tags (
    user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tag_id  bigint NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, tag_id)
);

-- Reference places (DD-15: plain lat/lng, no PostGIS).
CREATE TABLE pickup_points (
    id       bigserial PRIMARY KEY,
    name     text             NOT NULL UNIQUE,
    lat      double precision NOT NULL,
    lng      double precision NOT NULL,
    radius_m integer          NOT NULL DEFAULT 50 CHECK (radius_m > 0)
);

-- Bus stops inside the park. stop_id is the open-data feed's stopLocationId.
CREATE TABLE bus_stops (
    id      bigserial PRIMARY KEY,
    stop_id integer          UNIQUE,
    name    text             NOT NULL,
    lat     double precision NOT NULL,
    lng     double precision NOT NULL
);

-- Habitual data, recomputed from service records on each completed ride (DD-19).
CREATE TABLE driver_profiles (
    user_id                bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    usual_pickup_point_id  bigint REFERENCES pickup_points (id),
    usual_destination_name text,
    usual_destination_lat  double precision,
    usual_destination_lng  double precision,
    capacity               integer CHECK (capacity > 0)
);

CREATE TABLE passenger_profiles (
    user_id                bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    usual_arrival_time     time,
    usual_destination_name text,
    usual_destination_lat  double precision,
    usual_destination_lng  double precision
);

CREATE TABLE passenger_accepted_stops (
    user_id     bigint NOT NULL REFERENCES passenger_profiles (user_id) ON DELETE CASCADE,
    bus_stop_id bigint NOT NULL REFERENCES bus_stops (id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, bus_stop_id)
);

-- Trips. Settings are a snapshot taken at departure and locked once the trip is
-- active (DD-07). Seats are counters so a hold is one conditional UPDATE (DD-12):
--   UPDATE trips SET seats_held = seats_held + 1
--    WHERE id = $1 AND seats_held + seats_confirmed < capacity;
CREATE TABLE trips (
    id                    bigserial PRIMARY KEY,
    driver_id             bigint           NOT NULL REFERENCES users (id),
    pickup_point_id       bigint           NOT NULL REFERENCES pickup_points (id),
    destination_name      text             NOT NULL,
    destination_lat       double precision NOT NULL,
    destination_lng       double precision NOT NULL,
    capacity              integer          NOT NULL CHECK (capacity > 0),
    auto_accept           boolean          NOT NULL DEFAULT false,
    status                text             NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
    settings_locked       boolean          NOT NULL DEFAULT false,
    seats_held            integer          NOT NULL DEFAULT 0 CHECK (seats_held >= 0),
    seats_confirmed       integer          NOT NULL DEFAULT 0 CHECK (seats_confirmed >= 0),
    passed_pickup         boolean          NOT NULL DEFAULT false,
    passed_pickup_at      timestamptz,
    -- Route pickup point -> destination (DD-21); null until built for simulated trips.
    route_polyline        text,
    route_distance_m      integer,
    route_duration_s      integer,
    route_simulated       boolean,
    simulated             boolean          NOT NULL DEFAULT false,
    created_at            timestamptz      NOT NULL DEFAULT now(),
    started_at            timestamptz,
    ended_at              timestamptz,
    CHECK (seats_held + seats_confirmed <= capacity)
);
CREATE INDEX trips_active_idx ON trips (pickup_point_id) WHERE status = 'active';
CREATE INDEX trips_driver_idx ON trips (driver_id, created_at DESC);

-- Bus stops along the stored route, in travel order (DD-21).
CREATE TABLE trip_route_stops (
    trip_id     bigint  NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    seq         integer NOT NULL,
    bus_stop_id bigint  NOT NULL REFERENCES bus_stops (id),
    PRIMARY KEY (trip_id, seq)
);

-- Tag filters with intent (REQ-013), for trips and for requests.
CREATE TABLE trip_tag_filters (
    trip_id bigint NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
    tag_id  bigint NOT NULL REFERENCES tags (id),
    intent  text   NOT NULL CHECK (intent IN ('required', 'preferred')),
    PRIMARY KEY (trip_id, tag_id)
);

-- Raw position reports (DD-06). Append-only: enforced by the trigger below.
-- trip_id is null for passengers; one table serves both (DD-08).
CREATE TABLE location_reports (
    id          bigserial PRIMARY KEY,
    user_id     bigint           NOT NULL REFERENCES users (id),
    trip_id     bigint           REFERENCES trips (id),
    lat         double precision NOT NULL,
    lng         double precision NOT NULL,
    reported_at timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX location_reports_user_idx ON location_reports (user_id, reported_at DESC);
CREATE INDEX location_reports_trip_idx ON location_reports (trip_id, reported_at) WHERE trip_id IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION location_reports_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'location_reports is append-only';
END
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER location_reports_append_only
    BEFORE UPDATE OR DELETE ON location_reports
    FOR EACH ROW EXECUTE FUNCTION location_reports_append_only();

-- Ride requests. A hold exists while status = 'waiting_driver'; it becomes a
-- confirmed seat on 'confirmed'. Hold order follows id (submission order, DD-12).
CREATE TABLE ride_requests (
    id                   bigserial PRIMARY KEY,
    passenger_id         bigint           NOT NULL REFERENCES users (id),
    pickup_point_id      bigint           NOT NULL REFERENCES pickup_points (id),
    destination_name     text             NOT NULL,
    destination_lat      double precision NOT NULL,
    destination_lng      double precision NOT NULL,
    status               text             NOT NULL DEFAULT 'submitted'
                             CHECK (status IN ('submitted', 'rejected', 'waiting_driver',
                                               'no_match', 'confirmed', 'completed')),
    trip_id              bigint           REFERENCES trips (id),
    -- Null means the trip's destination.
    dropoff_bus_stop_id  bigint           REFERENCES bus_stops (id),
    relaxed              boolean          NOT NULL DEFAULT false,
    submitted_lat        double precision,
    submitted_lng        double precision,
    response_deadline_at timestamptz,
    created_at           timestamptz      NOT NULL DEFAULT now(),
    confirmed_at         timestamptz,
    completed_at         timestamptz
);
CREATE INDEX ride_requests_trip_idx ON ride_requests (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX ride_requests_passenger_idx ON ride_requests (passenger_id, id DESC);

CREATE TABLE request_tag_filters (
    request_id bigint NOT NULL REFERENCES ride_requests (id) ON DELETE CASCADE,
    tag_id     bigint NOT NULL REFERENCES tags (id),
    intent     text   NOT NULL CHECK (intent IN ('required', 'preferred')),
    PRIMARY KEY (request_id, tag_id)
);

-- Ranked assignment order computed at submission; reassignment walks it.
CREATE TABLE request_candidates (
    request_id          bigint  NOT NULL REFERENCES ride_requests (id) ON DELETE CASCADE,
    rank                integer NOT NULL,
    trip_id             bigint  NOT NULL REFERENCES trips (id),
    dropoff_bus_stop_id bigint  REFERENCES bus_stops (id),
    outcome             text    CHECK (outcome IN ('declined', 'timed_out', 'accepted')),
    PRIMARY KEY (request_id, rank)
);

-- One row per completed ride (REQ-055). The driven route is rebuilt from location_reports.
CREATE TABLE service_records (
    id                  bigserial PRIMARY KEY,
    request_id          bigint      NOT NULL UNIQUE REFERENCES ride_requests (id),
    trip_id             bigint      NOT NULL REFERENCES trips (id),
    driver_id           bigint      NOT NULL REFERENCES users (id),
    passenger_id        bigint      NOT NULL REFERENCES users (id),
    pickup_point_id     bigint      NOT NULL REFERENCES pickup_points (id),
    dropoff_bus_stop_id bigint      REFERENCES bus_stops (id),
    dropoff_name        text        NOT NULL,
    dropoff_lat         double precision NOT NULL,
    dropoff_lng         double precision NOT NULL,
    picked_up_at        timestamptz,
    completed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_records_driver_idx ON service_records (driver_id, completed_at DESC);
CREATE INDEX service_records_passenger_idx ON service_records (passenger_id, completed_at DESC);

-- Matching parameters, edited with SQL and read on every use (DD-20, REQ-060).
CREATE TABLE system_settings (
    key         text    PRIMARY KEY,
    value       numeric NOT NULL,
    unit        text    NOT NULL,
    description text    NOT NULL
);

INSERT INTO system_settings (key, value, unit, description) VALUES
    ('submit_distance',        200, 'm',      '送出請求距離：乘客離上車點這個距離內才能送出請求'),
    ('address_match_distance', 200, 'm',      '地址相符距離：駕駛目的地與乘客最終目的地相距這個距離內視為相符'),
    ('wait_limit',              10, 'min',    '等待上限：等待時間超過就不分配'),
    ('wait_weight',              2, 'ratio',  '等待加重：等 1 分鐘視同幾分鐘'),
    ('walk_weight',            1.5, 'ratio',  '步行加重：走 1 分鐘視同幾分鐘'),
    ('tag_bonus_cap',            4, 'min',    '標籤加分上限：建議標籤全部符合時降低的感受成本'),
    -- 駕駛確認時限 is still undecided (requirement REQ-060); 60 s is a placeholder.
    ('driver_confirm_timeout',  60, 's',      '駕駛確認時限：駕駛未在時限內回應即改配（暫定值）');

-- +goose Down
DROP TABLE system_settings;
DROP TABLE service_records;
DROP TABLE request_candidates;
DROP TABLE request_tag_filters;
DROP TABLE ride_requests;
DROP TABLE location_reports;
DROP FUNCTION location_reports_append_only();
DROP TABLE trip_tag_filters;
DROP TABLE trip_route_stops;
DROP TABLE trips;
DROP TABLE passenger_accepted_stops;
DROP TABLE passenger_profiles;
DROP TABLE driver_profiles;
DROP TABLE bus_stops;
DROP TABLE pickup_points;
DROP TABLE user_tags;
DROP TABLE tags;
DROP TABLE users;
