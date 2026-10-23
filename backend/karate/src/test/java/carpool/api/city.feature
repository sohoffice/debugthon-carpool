@api @city
Feature: city dashboard (REQ-063, REQ-078 to REQ-084, DD-36, DD-39, DD-40, DD-41, DD-44)

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
    * def gatewayShape = { vd_id: '#string', source: '#? _ == "city" || _ == "freeway"', gateway: '#string', road_name: '#string', road_direction: '#string', bearing: '#string', sort_order: '#number', location_note: '#string', lat: '#number', lng: '#number', shape: '##[_ > 1]', proxy: '#boolean', proxy_note: '##string', reference_speed_kmh: '#number? _ > 0', volume: '##number? _ >= 0', avg_speed_kmh: '##number', occupancy_pct: '##number', coverage_pct: '##number', past_avg_speed_kmh: '##number', past_min_speed_kmh: '##number', past_max_speed_kmh: '##number', simulated: '#boolean' }
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

  Scenario: traffic in the latest slot, every gateway with its fields
    * path 'api', 'city', 'traffic'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response contains { slot_start: '#string', weather: '##(weatherShape)', simulated: '#boolean', weather_simulated: true }
    * match response.detectors == '#[16]'
    * match each response.detectors == gatewayShape
    # 6 gateways have a TDX section shape; 成美橋 and 成功橋 are proxies with the detector's place (DD-36)
    * def shaped = karate.filter(response.detectors, function(g) { return g.shape != null })
    * match shaped == '#[6]'
    * def proxies = karate.filter(response.detectors, function(g) { return g.proxy == true && g.proxy_note != null })
    * match proxies == '#[2]'
    # gateways by sort_order 1-16, UD-28's grid rows (city roads from Dazhi, then the freeway ramps)
    * match karate.map(response.detectors, function(g) { return g.sort_order }) == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    * match response.detectors[0].gateway == '內湖路一段'
    * match response.detectors[10].gateway == '國道1號高架 堤頂交流道（北向出口）'
    * match response.detectors[15].gateway == '國道1號 東湖交流道（北向出口）'
    * match each response.detectors == '#? _.past_min_speed_kmh == null || (_.past_min_speed_kmh <= _.past_avg_speed_kmh && _.past_avg_speed_kmh <= _.past_max_speed_kmh)'
    # the latest slot ends no later than now (DD-41)
    * match new Date(response.slot_start).getTime() + 15 * 60000 <= new Date(response.now).getTime() == true

    # a past slot from the commute traffic gives that slot
    * def commute = karate.call('classpath:carpool/api/act-get.feature', { token: 'passenger:passenger1', path: 'api/commute/traffic' }).response
    * def past = commute.days[0].slots[3].slot_start
    * path 'api', 'city', 'traffic'
    * param slot = past
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match new Date(response.slot_start).getTime() == new Date(past).getTime()
    * match response.detectors == '#[16]'

  Scenario: a past day's 12 slots by date, every slot with the 16 gateways
    * def commute = karate.call('classpath:carpool/api/act-get.feature', { token: 'passenger:passenger1', path: 'api/commute/traffic' }).response
    * def day = commute.days[1].date
    * path 'api', 'city', 'traffic'
    * param date = day
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response contains clockShape
    * match response contains { date: '#(day)', simulated: '#boolean', weather_simulated: true }
    * match response.slots == '#[12]'
    * match each response.slots == { slot_start: '#string', detectors: '#[16]', weather: '#(weatherShape)', simulated: '#boolean', weather_simulated: true }
    * match each response.slots[0].detectors == gatewayShape
    * match each response.slots == '#? karate.map(_.detectors, function(g) { return g.sort_order }).join() == "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16"'

  Scenario: today by date has all 12 slots, those after the latest slot without traffic or weather
    * path 'api', 'city', 'traffic'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * def latest = new Date(response.slot_start).getTime()
    * def today = response.today
    * path 'api', 'city', 'traffic'
    * param date = today
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * match response.slots == '#[12]'
    * def over = karate.filter(response.slots, function(s) { return new Date(s.slot_start).getTime() <= latest })
    * def notYet = karate.filter(response.slots, function(s) { return new Date(s.slot_start).getTime() > latest })
    * match new Date(over[over.length - 1].slot_start).getTime() == latest
    * match each over contains { simulated: true, weather: '#notnull' }
    * match each notYet contains { simulated: false, weather_simulated: false, weather: null }
    * def notYetGateways = []
    * karate.forEach(notYet, function(s) { karate.forEach(s.detectors, function(g) { notYetGateways.push(g) }) })
    * match notYetGateways == '#[_ > 0]'
    * match each notYetGateways contains { volume: null, avg_speed_kmh: null, occupancy_pct: null, coverage_pct: null, simulated: false, past_avg_speed_kmh: '#number', past_min_speed_kmh: '#number', past_max_speed_kmh: '#number' }

  Scenario Outline: traffic <case> is refused - <status>
    * path 'api', 'city', 'traffic'
    * param <param> = '<value>'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status <status>
    * match response.error.code == '<code>'

    Examples:
      | case                  | param | value                     | status | code            |
      | slot without data     | slot  | 2020-01-06T08:00:00+08:00 | 404    | not_found       |
      | slot off the boundary | slot  | 2026-10-22T08:07:00+08:00 | 400    | invalid_request |
      | slot not a time       | slot  | yesterday                 | 400    | invalid_request |
      | date without data     | date  | 2020-01-06                | 404    | not_found       |
      | date not a date       | date  | 2026/10/22                | 400    | invalid_request |
      | date out of range     | date  | 2026-10-32                | 400    | invalid_request |

  Scenario Outline: today's slot at <time>, outside the commute window, is not found
    * path 'api', 'city', 'traffic'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 200
    * def today = response.today
    * path 'api', 'city', 'traffic'
    * param slot = today + 'T<time>:00+08:00'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 404
    * match response.error.code == 'not_found'

    Examples:
      | time  |
      | 06:00 |
      | 06:45 |

  Scenario: slot and date together are refused
    * path 'api', 'city', 'traffic'
    * param slot = '2026-10-22T08:00:00+08:00'
    * param date = '2026-10-22'
    * header Authorization = 'Bearer city:city1'
    * method get
    * status 400
    * match response.error.code == 'invalid_request'

  Scenario Outline: traffic by <param> is refused for a <token> token
    * path 'api', 'city', 'traffic'
    * param <param> = '<value>'
    * header Authorization = 'Bearer <token>'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

    Examples:
      | param | value                     | token                |
      | slot  | 2026-10-22T08:00:00+08:00 | driver:driver1       |
      | date  | 2026-10-22                | passenger:passenger1 |

  Scenario Outline: traffic by <param> without a token is refused
    * path 'api', 'city', 'traffic'
    * param <param> = '<value>'
    * method get
    * status 401
    * match response.error.code == 'unauthorized'

    Examples:
      | param | value                     |
      | slot  | 2026-10-22T08:00:00+08:00 |
      | date  | 2026-10-22                |

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
