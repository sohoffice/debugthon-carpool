@api @city
Feature: city dashboard (REQ-063, REQ-078 to REQ-084, DD-39, DD-40, DD-41)

  # Read-only. Like commute.feature, every scenario first regenerates the simulated data for today,
  # as a reset would (SQL: no API for it apart from the reset, which demo-reset.feature owns). A
  # reset in parallel restarts the live simulation round; the scenarios check shapes, not counts
  # that depend on where the round is. The Go tests (city*_test.go) pin the clock for the numbers.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * Db.query('SELECT generate_commute_simulation(commute_now(now()))')
    * def clockShape = { now: '#string', today: '#string', demo_clock: '#boolean' }
    * def placeShape = { id: '#number', name: '#string', lat: '#number', lng: '#number' }
    * def weatherShape = { station_id: '#string', station_name: '#string', obs_time: '#string', weather: '#string', air_temperature: '#number', precipitation: '#number? _ >= 0' }
    * def countsShape = { vehicles: '#number? _ >= 0', on_board: '#number? _ >= 0', waiting: '#number? _ >= 0', matched: '#number? _ >= 0' }
    * def noIdentity = function(body) { var s = JSON.stringify(body); return ['username', 'display_name', 'plate', 'passenger_name', 'driver_id', 'passenger_id', 'trip_id'].filter(function(k) { return s.indexOf('"' + k + '"') >= 0 }) }

  Scenario: live cars and passengers, with the simulation labelled and no identity
    * path 'api', 'city', 'live'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response contains { counts: '#(countsShape)', simulated_counts: '#(countsShape)', simulated: '#boolean' }
    * match each response.vehicles == { lat: '#number', lng: '#number', heading_deg: '##number', on_board: '#number? _ >= 0', simulated: '#boolean' }
    # the simulated round puts cars on the map even without a real trip (DD-40 step 5)
    * match karate.filter(response.vehicles, function(v) { return v.simulated }) == '#[_ > 0]'
    * match response.pickup_points == '#[3]'
    * match each response.pickup_points == karate.merge(placeShape, { waiting: '#number? _ >= 0', simulated_waiting: '#number? _ >= 0' })
    * match noIdentity(response) == []

  Scenario: traffic in the latest slot, with each detector and the main roads' speeds
    * path 'api', 'city', 'traffic'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response contains { slot_start: '#string', simulated: true }
    * match response.detectors == '#[_ > 0]'
    * match each response.detectors == { vd_id: '#string', road_name: '#string', road_direction: '#string', lat: '#number', lng: '#number', volume: '#number? _ >= 0', avg_speed_kmh: '##number', simulated: '#boolean' }
    * match each response.roads == { road_name: '#string', avg_speed_kmh: '##number', past_avg_speed_kmh: '##number' }
    # the latest slot ends no later than now (DD-41)
    * match new Date(response.slot_start).getTime() + 15 * 60000 <= new Date(response.now).getTime() == true
    * def latest = response.slot_start

    # a past slot from the commute traffic gives that slot
    * def commute = karate.call('classpath:carpool/api/act-get.feature', { token: 'passenger:passenger1', path: 'api/commute/traffic' }).response
    * def past = commute.days[0].slots[3].slot_start
    * path 'api', 'city', 'traffic'
    * param slot = past
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match new Date(response.slot_start).getTime() == new Date(past).getTime()

  Scenario Outline: a slot <case> is refused - <status>
    * path 'api', 'city', 'traffic'
    * param slot = '<slot>'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status <status>
    * match response.error.code == '<code>'

    Examples:
      | case             | slot                      | status | code            |
      | without data     | 2020-01-06T08:00:00+08:00 | 404    | not_found       |
      | off the boundary | 2026-10-22T08:07:00+08:00 | 400    | invalid_request |
      | not a time       | yesterday                 | 400    | invalid_request |

  Scenario: today's results, the trips saved labelled as an estimate
    * path 'api', 'city', 'today'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response contains { completed: '#number? _ >= 0', requests: '#number? _ >= 0', matched: '#number? _ >= 0', no_match: '#number? _ >= 0', trips_saved: '#number', trips_saved_estimate: true, simulated: '#boolean' }
    * match response.match_rate == '##number? _ >= 0 && _ <= 1'
    * match response.trips_saved == response.completed
    * match response.pickup_points == '#[3]'
    * match each response.pickup_points == karate.merge(placeShape, { completed: '#number? _ >= 0' })
    * def sum = 0
    * karate.forEach(response.pickup_points, function(p) { sum += p.completed })
    * match sum == response.completed
    * match noIdentity(response) == []

  Scenario: history of the past 10 workdays, the days and weather those of the commute traffic
    * path 'api', 'city', 'history'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response.simulated == true
    * match response.days == '#[10]'
    * match each response.days == { date: '#string', weekday: '#? _ >= 1 && _ <= 5', rides: '#number? _ >= 0', weather: '#(weatherShape)', simulated: '#boolean' }
    * match response.pickup_points == '#[3]'
    * match each response.pickup_points == karate.merge(placeShape, { drivers_per_day: '#number? _ >= 0', passengers_per_day: '#number? _ >= 0', rides_per_day: '#number? _ >= 0' })
    # one decimal (REQ-080)
    * match each response.pickup_points[*].rides_per_day == '#? Math.round(_ * 10) == _ * 10'
    * def commute = karate.call('classpath:carpool/api/act-get.feature', { token: 'passenger:passenger1', path: 'api/commute/traffic' }).response
    * match karate.map(response.days, function(d) { return d.date }) == karate.map(commute.days, function(d) { return d.date })
    * match noIdentity(response) == []

  Scenario Outline: a driver or passenger token is refused - <resource> as <token>
    * path 'api', 'city', '<resource>'
    * header Authorization = 'Bearer <token>'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

    Examples:
      | resource | token                |
      | live     | driver:driver1       |
      | traffic  | passenger:passenger1 |
      | today    | driver:driver1       |
      | history  | passenger:passenger1 |

  Scenario Outline: no token is refused - <resource>
    * path 'api', 'city', '<resource>'
    * method get
    * status 401
    * match response.error.code == 'unauthorized'

    Examples:
      | resource |
      | live     |
      | traffic  |
      | today    |
      | history  |

  # DD-39: a city token calls only /api/city/*, shared APIs included.
  Scenario Outline: a city token is refused elsewhere - <method> <path>
    * path '<path>'
    * header Authorization = 'Bearer city:city1'
    * request {}
    * method <method>
    * status 403
    * match response.error.code == 'forbidden'

    Examples:
      | method | path                              |
      | get    | api/me                            |
      | get    | api/pickup-points                 |
      | get    | api/commute/traffic               |
      | get    | api/commute/weather               |
      | post   | api/location                      |
      | get    | api/driver/profile                |
      | get    | api/passenger/profile             |
      | get    | api/passenger/requests/current    |
