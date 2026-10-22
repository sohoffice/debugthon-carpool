-- +goose Up

-- Pickup-point statistics (Phase 2, REQ-056, REQ-080, DD-37): per pickup point and 15-minute slot,
-- the trips departing from it (drivers), the requests sent at it (passengers) and the rides
-- completed there (rides), each ride counted in the slot its request was sent in. No weather here:
-- the API takes the slot's weather from traffic_observations, the one copy (DD-36, REQ-083).
CREATE TABLE supply_demand_stats (
    pickup_point_id bigint      NOT NULL REFERENCES pickup_points (id),
    -- Start of the slot, on :00/:15/:30/:45 Taipei time, in the commute window 07:00-10:00.
    slot_start      timestamptz NOT NULL,
    driver_count    integer     NOT NULL CHECK (driver_count >= 0),
    passenger_count integer     NOT NULL CHECK (passenger_count >= 0),
    ride_count      integer     NOT NULL CHECK (ride_count >= 0),
    simulated       boolean     NOT NULL, -- REQ-063
    PRIMARY KEY (pickup_point_id, slot_start),
    -- Every ride has a request sent in the same slot (DD-37).
    CHECK (ride_count <= passenger_count)
);

-- Generates the simulated pickup-point statistics (DD-40 step 3) for the slots the traffic
-- generator just wrote, so both cover the same days and today's slots before now (step 4), and
-- rain falls on the same slots. Passengers and drivers follow the slot (peak around 08:15), the
-- weekday (Friday the most) and the weather (rain brings more passengers and a few more drivers);
-- rides stay within the passengers and within the drivers' seats.
-- +goose StatementBegin
CREATE FUNCTION generate_pickup_stats(now_ timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    today date := (now_ AT TIME ZONE 'Asia/Taipei')::date;
    -- Average passengers a simulated driver carries (DD-40 step 3). Only for the simulation: the
    -- simulated drivers are not real trips, so trip and vehicle capacities do not apply.
    avg_seats CONSTANT integer := 2;
BEGIN
    DELETE FROM supply_demand_stats WHERE simulated;

    INSERT INTO supply_demand_stats (pickup_point_id, slot_start, driver_count, passenger_count, ride_count, simulated)
    WITH slots AS (
        SELECT DISTINCT ON (o.slot_start) o.slot_start,
               (o.slot_start AT TIME ZONE 'Asia/Taipei')::date AS day,
               (o.weather->>'precipitation')::numeric > 0 AS raining
          FROM traffic_observations o
         WHERE o.simulated
         ORDER BY o.slot_start, o.vd_id
    ),
    cells AS (
        SELECT s.*, p.id AS pickup_point_id,
               extract(epoch FROM s.slot_start - ((s.day + time '07:00') AT TIME ZONE 'Asia/Taipei')) / 900 AS slot,
               CASE extract(isodow FROM s.day) WHEN 5 THEN 1.3 WHEN 1 THEN 1.05 ELSE 1 END AS dow,
               4 + commute_sim_random(today, 'passengers/' || p.id) * 4 AS base_passengers,
               2 + commute_sim_random(today, 'drivers/' || p.id) * 2 AS base_drivers,
               commute_sim_random(today, 'passenger-noise/' || p.id || '/' || s.slot_start) AS passenger_noise,
               commute_sim_random(today, 'driver-noise/' || p.id || '/' || s.slot_start) AS driver_noise,
               commute_sim_random(today, 'match/' || p.id || '/' || s.slot_start) AS match_noise
          FROM slots s CROSS JOIN pickup_points p
    ),
    counted AS (
        SELECT c.pickup_point_id, c.slot_start,
               -- Peak shape: 1 at 08:15 (slot 5), about 0.45 at the window's ends.
               round(c.base_passengers * (0.45 + 0.55 * exp(-power(c.slot - 5, 2) / 6.0)) * c.dow
                     * CASE WHEN c.raining THEN 1.3 ELSE 1 END * (0.85 + c.passenger_noise * 0.3))::int AS passengers,
               round(c.base_drivers * (0.45 + 0.55 * exp(-power(c.slot - 5, 2) / 6.0)) * c.dow
                     * CASE WHEN c.raining THEN 1.1 ELSE 1 END * (0.85 + c.driver_noise * 0.3))::int AS drivers,
               0.65 + c.match_noise * 0.3 AS match_rate
          FROM cells c
    )
    SELECT pickup_point_id, slot_start, drivers, passengers,
           least(passengers, drivers * avg_seats, round(passengers * match_rate))::int, true
      FROM counted;
END;
$$;
-- +goose StatementEnd

-- The traffic generator keeps its body under a new name; generate_commute_simulation, which the
-- migration, the Demo reset (DD-29) and Karate call, now runs DD-40 steps 1-4 in order. The
-- traffic step takes the advisory lock for the caller's transaction, so it covers both steps.
ALTER FUNCTION generate_commute_simulation(timestamptz) RENAME TO generate_commute_traffic;

-- +goose StatementBegin
CREATE FUNCTION generate_commute_simulation(now_ timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM generate_commute_traffic(now_);
    PERFORM generate_pickup_stats(now_);
END;
$$;
-- +goose StatementEnd

-- Today's real rides by pickup point and slot (REQ-083, DD-37, DD-40 step 4, DD-41), the one rule
-- for every Phase 2 view that adds them to today's simulated statistics (pickup rides, and the
-- city dashboard's today). A ride counts on the real Taipei date its request was sent, whatever
-- the commute today is (on Saturday 10/24 under demo_clock the rides of 10/24 count for Monday
-- 10/26). With demo_clock every such ride is in the slot holding now (08:15-08:30 in the Demo);
-- without it, in the slot its request was sent in. slot_start is null when that slot is outside
-- the commute window: the ride counts for the day's total only. service_records.request_id is
-- unique, so a reassigned request is one ride.
-- +goose StatementBegin
CREATE FUNCTION commute_real_rides(real_now timestamptz)
RETURNS TABLE (pickup_point_id bigint, slot_start timestamptz, rides bigint) LANGUAGE sql STABLE AS $$
    WITH placed AS (
        SELECT s.pickup_point_id,
               date_bin(interval '15 minutes',
                        CASE WHEN EXISTS (SELECT 1 FROM system_settings WHERE key = 'demo_clock')
                             THEN commute_now(real_now) ELSE q.created_at END,
                        timestamptz '2000-01-01 00:00+08') AS slot
          FROM service_records s JOIN ride_requests q ON q.id = s.request_id
         WHERE (q.created_at AT TIME ZONE 'Asia/Taipei')::date = (real_now AT TIME ZONE 'Asia/Taipei')::date
    )
    SELECT p.pickup_point_id,
           CASE WHEN (p.slot AT TIME ZONE 'Asia/Taipei')::time BETWEEN time '07:00' AND time '09:45' THEN p.slot END,
           count(*)
      FROM placed p
     GROUP BY 1, 2;
$$;
-- +goose StatementEnd

SELECT generate_pickup_stats(commute_now(now()));

-- +goose Down
DROP FUNCTION commute_real_rides(timestamptz);
DROP FUNCTION generate_commute_simulation(timestamptz);
ALTER FUNCTION generate_commute_traffic(timestamptz) RENAME TO generate_commute_simulation;
DROP FUNCTION generate_pickup_stats(timestamptz);
DROP TABLE supply_demand_stats;
