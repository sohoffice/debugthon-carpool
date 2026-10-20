@api @supply
Feature: supply query (GET /api/passenger/supply)

  # Cars come from fresh karate-supply- drivers that depart through the API; the passenger is a
  # fresh account too, so tags and profile are its own. The seeded trips may be on the road with
  # reports from a demo, so assertions look for this scenario's trips by id, never at totals.
  # Drivers that departed stay in the database (see cleanup-tracking.feature).

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def passenger = 'karate-supply-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * def drivers = []
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); drivers.forEach(function(u) { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: u }) }) }
    * def auth = { Authorization: '#("Bearer passenger:" + passenger)' }
    * configure headers = auth
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[0]
    * path 'api', 'bus-stops'
    * method get
    * def stop = response[0]
    * path 'api', 'tags'
    * method get
    * def tagA = response[0].id
    * def tagB = response[1].id
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def query = { pickup_point_id: '#(pickup.id)', dest_lat: '#(inPark.lat)', dest_lng: '#(inPark.lng)', stop_ids: '#(stop.id)' }
    * def car = function(name, northM, tagIds, filters) { var u = 'karate-supply-driver-' + name + '-' + suffix; drivers.push(u); return karate.call('classpath:carpool/api/supply-car.feature', { user: u, pickup: pickup, northM: northM, tagIds: tagIds, body: { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, tag_filters: filters } }).tripId }
    * def supply = function(q) { var r = karate.http(baseUrl + '/api/passenger/supply').header('Authorization', auth.Authorization).params(q).get(); return r.body }
    * def idsOf = function(r) { return r.cars.map(function(c) { return c.trip_id }) }

  Scenario: a car near the pickup point shows up with its card and a timeline of the wait limit
    * def tripId = car('near', 1000, [], [])
    * path 'api', 'passenger', 'supply'
    * params query
    * method get
    * status 200
    * match response.pickup_point.id == pickup.id
    * match response.destination contains { lat: '#(inPark.lat)', lng: '#(inPark.lng)' }
    * match response.accepted_stop_ids == [#(stop.id)]
    * match response.timeline_range_s == '#number'
    * match response.card == { count: '#number', fastest_eta_s: '#number', fastest_eta_simulated: '#boolean', seats_remaining: '#number' }
    * def mine = response.cars.filter(function(c) { return c.trip_id == tripId })
    * match mine == [{ trip_id: '#(tripId)', eta_s: '#number', eta_simulated: '#boolean', seats_available: 3 }]
    # REQ-063, DD-09: the route is the simulated fallback until a real source is wired in
    * match mine[0].eta_simulated == true
    * match response.card.fastest_eta_simulated == response.cars[0].eta_simulated
    * assert mine[0].eta_s <= response.timeline_range_s
    # the card agrees with the list, which is ordered soonest first
    * match response.card.count == response.cars.length
    * match response.card.fastest_eta_s == response.cars[0].eta_s
    * def seats = 0
    * response.cars.forEach(function(c) { seats += c.seats_available })
    * match response.card.seats_remaining == seats

  Scenario: a car whose destination does not fit the passenger is not listed
    # the park's south end is about 2 km from the passenger's destination; the stop the passenger
    # accepts is the northernmost one, nowhere near a route that ends there
    * def southEnd = { name: '園區南端', lat: 25.0580, lng: 121.5800 }
    * path 'api', 'bus-stops'
    * method get
    * def northStop = response.reduce(function(a, b) { return b.lat > a.lat ? b : a })
    * def other = karate.call('classpath:carpool/api/supply-car.feature', { user: 'karate-supply-driver-south-' + suffix, pickup: pickup, northM: 1000, tagIds: [], body: { pickup_point_id: pickup.id, destination: southEnd, capacity: 3, auto_accept: true, tag_filters: [] } })
    * drivers.push('karate-supply-driver-south-' + suffix)
    * def near = car('near', 1000, [], [])
    * path 'api', 'passenger', 'supply'
    * params karate.merge(query, { stop_ids: '#(northStop.id)' })
    * method get
    * status 200
    * match idsOf(response) contains near
    * match idsOf(response) !contains other.tripId

  Scenario: cars failing either side's mandatory tags are not listed
    * def plain = car('plain', 1000, [], [])
    * def withA = car('with-a', 1000, [tagA], [])
    # this driver carries A but requires B, which the passenger does not carry
    * def wantsB = car('wants-b', 1000, [tagA], [{ tag_id: tagB, intent: 'required' }])
    * def preferB = car('prefer-b', 1000, [], [{ tag_id: tagB, intent: 'preferred' }])

    # the driver's requirement alone excludes the car
    * path 'api', 'passenger', 'supply'
    * params query
    * method get
    * status 200
    * def ids = idsOf(response)
    * match ids contains [#(plain), #(withA), #(preferB)]
    * match ids !contains wantsB

    # the passenger requires A: only cars carrying A remain
    * path 'api', 'passenger', 'supply'
    * params karate.merge(query, { required_tags: '#(tagA)' })
    * method get
    * status 200
    * def ids = idsOf(response)
    * match ids contains withA
    * match ids !contains plain
    * match ids !contains preferB
    * match ids !contains wantsB

    # a preferred filter never hides a car
    * path 'api', 'passenger', 'supply'
    * params karate.merge(query, { preferred_tags: '#(tagA)' })
    * method get
    * status 200
    * match idsOf(response) contains [#(plain), #(withA), #(preferB)]

    # once the passenger carries B the driver's requirement is met
    * karate.call('classpath:carpool/api/put-tag.feature', { token: 'passenger:' + passenger, id: tagB })
    * path 'api', 'passenger', 'supply'
    * params query
    * method get
    * status 200
    * match idsOf(response) contains wantsB

  Scenario: the timeline range follows the wait limit
    # a car about 3 km away needs roughly 12 minutes with the simulated route
    * def tripId = car('far', 3000, [], [])
    * def before = supply(query)
    * match before.timeline_range_s == '#number'
    * match idsOf(before) !contains tripId

    * def saved = Db.queryLong("SELECT (value * 1000)::bigint FROM system_settings WHERE key = 'wait_limit'")
    * configure afterScenario = function() { Db.exec("UPDATE system_settings SET value = ? / 1000.0 WHERE key = 'wait_limit'", saved); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); drivers.forEach(function(u) { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: u }) }) }
    # only ever raised, so scenarios running in parallel are not affected
    * Db.exec("UPDATE system_settings SET value = 15 WHERE key = 'wait_limit'")
    * def after = supply(query)
    * match after.timeline_range_s == 900
    * match idsOf(after) contains tripId

  Scenario: the destination and stops fall back to the passenger's habitual data
    * Db.exec("INSERT INTO passenger_profiles (user_id, usual_destination_name, usual_destination_lat, usual_destination_lng) SELECT id, '常去的地方', ?, ? FROM users WHERE username = ?", inPark.lat, inPark.lng, passenger)
    * Db.exec('INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) SELECT id, ? FROM users WHERE username = ?', stop.id, passenger)
    * def tripId = car('habit', 1000, [], [])
    * path 'api', 'passenger', 'supply'
    * param pickup_point_id = pickup.id
    * method get
    * status 200
    * match response.destination.name == '常去的地方'
    * match response.accepted_stop_ids == [#(stop.id)]
    * match idsOf(response) contains tripId

  Scenario Outline: the query is refused without <what>
    * def q = karate.merge(query, {})
    * karate.remove('q', '$.<field>')
    * path 'api', 'passenger', 'supply'
    * params q
    * method get
    * status 400
    * match response.error.code == '<code>'

    Examples:
      | what            | field           | code                 |
      | a pickup point | pickup_point_id | invalid_request      |
      | a destination   | dest_lat        | invalid_request      |
      | stops           | stop_ids        | stops_required       |

  Scenario: an unknown pickup point is refused
    * path 'api', 'passenger', 'supply'
    * params karate.merge(query, { pickup_point_id: 999999 })
    * method get
    * status 400
    * match response.error.code == 'invalid_pickup_point'

  Scenario: no destination at all is refused when the profile has none
    * path 'api', 'passenger', 'supply'
    * param pickup_point_id = pickup.id
    * param stop_ids = stop.id
    * method get
    * status 400
    * match response.error.code == 'destination_required'

  Scenario: only passengers with a token may ask, and no car can be picked
    * configure headers = null
    * path 'api', 'passenger', 'supply'
    * params query
    * method get
    * status 401

    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * path 'api', 'passenger', 'supply'
    * params query
    * method get
    * status 403

    * configure headers = auth
    * path 'api', 'passenger', 'supply', 1
    * method post
    * request {}
    * match [404, 405] contains responseStatus
