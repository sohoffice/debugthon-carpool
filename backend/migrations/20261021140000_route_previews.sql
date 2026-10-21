-- +goose Up
-- DD-21: a route preview is saved with its bus stops, so a departure can refer to it by id.
-- used_at is set in the same transaction as the trip it was used for. Previews are never
-- cleaned up in the PoC (design.md 1.1).
CREATE TABLE route_previews (
    id                bigserial        PRIMARY KEY,
    driver_id         bigint           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pickup_point_id   bigint           NOT NULL REFERENCES pickup_points (id),
    destination_lat   double precision NOT NULL,
    destination_lng   double precision NOT NULL,
    route_polyline    text             NOT NULL,
    route_distance_m  integer          NOT NULL,
    route_duration_s  integer          NOT NULL,
    route_simulated   boolean          NOT NULL,
    created_at        timestamptz      NOT NULL DEFAULT now(),
    used_at           timestamptz
);

-- Bus stops along the previewed route, in travel order.
CREATE TABLE route_preview_stops (
    preview_id  bigint  NOT NULL REFERENCES route_previews (id) ON DELETE CASCADE,
    seq         integer NOT NULL,
    bus_stop_id bigint  NOT NULL REFERENCES bus_stops (id),
    PRIMARY KEY (preview_id, seq)
);

-- +goose Down
DROP TABLE route_preview_stops;
DROP TABLE route_previews;
