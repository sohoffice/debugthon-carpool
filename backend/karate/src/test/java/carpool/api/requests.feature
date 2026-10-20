@api @requests
Feature: supply and the request flow (GET /api/passenger/supply, /api/passenger/request(s), /api/driver/trip, /api/driver/requests/:id/*, POST /api/demo/reset)

  # Every scenario departs its own fresh karate-flow- driver at 台北大巨蛋, where the demo seed has
  # no cars, and the passenger requires a tag only that driver carries: each scenario (and each
  # Examples row) uses a different tag of the seeded list, so parallel scenarios never share a car. Reports pin the accounts (see location.feature): cleanup-requests.feature removes
  # the requests and ends the trip.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def driver = 'karate-flow-driver-' + suffix
    * def passenger = 'karate-flow-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true)', driver, driver)
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup-requests.feature', { driver: driver, passenger: passenger }) }
    * def asDriver = { Authorization: '#("Bearer driver:" + driver)' }
    * def asPassenger = { Authorization: '#("Bearer passenger:" + passenger)' }
    * configure headers = asDriver

    * path 'api', 'pickup-points'
    * method get
    * def pickup = karate.filter(response, function(p) { return p.name == '台北大巨蛋' })[0]
    * path 'api', 'bus-stops'
    * method get
    * def stopId = response[0].id
    * path 'api', 'tags'
    * method get
    * def tags = response
    * def useTag = function(i) { var id = tags[i].id; karate.call('classpath:carpool/api/put-tag.feature', { token: 'driver:' + driver, id: id }); return id }
    * def dest = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    # one metre of latitude is about 0.000009 degrees
    * def at = function(northM) { return { lat: pickup.lat + northM * 0.000009, lng: pickup.lng } }
    * def depart = function(auto) { return karate.call('classpath:carpool/api/post-trip.feature', { user: driver, body: { pickup_point_id: pickup.id, destination: dest, capacity: 3, auto_accept: auto } }) }
    # the car 400 m before the pickup point, so it has an ETA and has not passed it
    * def reportCar = function() { var p = at(-400); return karate.call('classpath:carpool/api/post-location.feature', { token: 'driver:' + driver, lat: p.lat, lng: p.lng }) }
    * def onRequest = function(role, id, action) { var user = role == 'driver' ? driver : passenger; return karate.call('classpath:carpool/api/post-request-action.feature', { token: role + ':' + user, role: role, id: id, action: action }).responseStatus }

  Scenario: supply lists the chosen pickup point's relevant cars within the wait limit
    * def tagId = useTag(4)
    * def r = depart(false)
    * match r.responseStatus == 201
    * reportCar()

    * configure headers = asPassenger
    * path 'api', 'passenger', 'supply'
    * params { pickup_point_id: '#(pickup.id)', destination_name: '#(dest.name)', destination_lat: '#(dest.lat)', destination_lng: '#(dest.lng)', accepted_stop_ids: '#(stopId)', required_tag_ids: '#(tagId)', preferred_tag_ids: '' }
    * method get
    * status 200
    * match response == { pickup_point: '#(pickup)', wait_limit_min: 10, submit_distance_m: 200, vehicle_count: 1, fastest_eta_s: '#number', seats: 3, vehicles: [{ id: '#(r.response.id)', eta_s: '#number', simulated: true }], simulated: true }

    # a required tag this driver does not carry leaves the car out (REQ-040)
    * def otherTag = tags[(tags.indexOf(karate.filter(tags, function(t) { return t.id == tagId })[0]) + 1) % tags.length].id
    * path 'api', 'passenger', 'supply'
    * params { pickup_point_id: '#(pickup.id)', destination_name: '#(dest.name)', destination_lat: '#(dest.lat)', destination_lng: '#(dest.lng)', accepted_stop_ids: '#(stopId)', required_tag_ids: '#(otherTag)' }
    * method get
    * status 200
    * match response.vehicles[*].id !contains r.response.id

    # the pickup point, the destination and at least one stop are required
    * def full = { pickup_point_id: '#(pickup.id)', destination_name: '#(dest.name)', destination_lat: '#(dest.lat)', destination_lng: '#(dest.lng)', accepted_stop_ids: '#(stopId)' }
    * def without = function(key) { var q = JSON.parse(JSON.stringify(full)); delete q[key]; return q }
    * path 'api', 'passenger', 'supply'
    * params without('pickup_point_id')
    * method get
    * status 400
    * match response.error.code == 'invalid_request'
    * path 'api', 'passenger', 'supply'
    * params without('destination_lat')
    * method get
    * status 400
    * path 'api', 'passenger', 'supply'
    * params without('accepted_stop_ids')
    * method get
    * status 400

  Scenario Outline: a full ride: request, confirm, board (<first>, then <second>), end
    * def tagId = useTag(<tag>)
    * def r = depart(false)
    * def tripId = r.response.id
    * reportCar()

    * configure headers = asPassenger
    * karate.call('classpath:carpool/api/post-activity.feature', { token: 'passenger:' + passenger })
    * path 'api', 'passenger', 'requests'
    * request { pickup_point_id: '#(pickup.id)', destination: '#(dest)', accepted_stop_ids: ['#(stopId)'], tag_filters: [{ tag_id: '#(tagId)', intent: 'required' }], location: '#(at(20))' }
    * method post
    * status 201
    * match response.request contains { status: 'waiting_driver', can_cancel: true, ride: null, reassigned: false }
    * def requestId = response.request.id

    * configure headers = asDriver
    * path 'api', 'driver', 'trip'
    * method get
    * status 200
    * match response.trip contains { id: '#(tripId)', status: 'active', passengers: [], completed_count: 0, ended_at: null }
    * match response.trip.pending_request == { id: '#(requestId)', pickup_point: '#(pickup)', dropoff: '#(dest)' }
    * path 'api', 'driver', 'requests', requestId, 'accept'
    * method post
    * status 200
    * match response.trip.passengers == [{ request_id: '#(requestId)', dropoff: '#(dest)', boarded: false }]

    * configure headers = asPassenger
    * path 'api', 'passenger', 'request'
    * method get
    * status 200
    * match response.request contains { status: 'confirmed', can_cancel: true }
    * match response.request.ride contains { vehicle: { plate: '#string', description: '#string' }, eta_s: '#number', passed_pickup: false }
    * match response.request.ride.position contains { lat: '#number', lng: '#number' }

    # Either side may mark boarding; a second mark changes nothing (DD-27).
    * match onRequest('<first>', requestId, 'board') == 200
    * if ('<second>' != 'none') karate.match(onRequest('<second>', requestId, 'board'), 200)

    * configure headers = asDriver
    * path 'api', 'driver', 'trip'
    * method get
    * match response.trip.passengers == [{ request_id: '#(requestId)', dropoff: '#(dest)', boarded: true }]

    * configure headers = asPassenger
    * path 'api', 'passenger', 'request'
    * method get
    * match response.request contains { status: 'boarded', can_cancel: false }
    * match response.request.ride contains { eta_s: null, position: null }
    * path 'api', 'passenger', 'requests', requestId, 'cancel'
    * method post
    * status 409
    * match response.error.code == 'cannot_cancel'

    * path 'api', 'passenger', 'requests', requestId, 'complete'
    * method post
    * status 200
    * match response.request.status == 'completed'
    * configure headers = asDriver
    * path 'api', 'driver', 'requests', requestId, 'complete'
    * method post
    * status 200
    * match response.trip contains { passengers: [], completed_count: 1 }

    # habitual data follows the completed ride (DD-19)
    * configure headers = asPassenger
    * path 'api', 'passenger', 'profile'
    * method get
    * match response.usual_destination == dest
    * match response.accepted_stops[*].id == ['#(stopId)']

    Examples:
      | first     | second    | tag |
      | passenger | none      | 0   |
      | driver    | none      | 1   |
      | passenger | driver    | 2   |
      | driver    | passenger | 3   |

  Scenario: too far from the pickup point is rejected, and only one request is open at a time
    * def tagId = useTag(5)
    * def r = depart(true)
    * reportCar()
    * configure headers = asPassenger
    * def body = { pickup_point_id: '#(pickup.id)', destination: '#(dest)', accepted_stop_ids: ['#(stopId)'], tag_filters: [{ tag_id: '#(tagId)', intent: 'required' }] }

    * path 'api', 'passenger', 'requests'
    * request karate.merge(body, { location: at(420) })
    * method post
    * status 201
    * match response.request contains { status: 'rejected', reject_reason: { code: 'too_far', message: '#string', distance_m: '#number' } }

    * path 'api', 'passenger', 'requests'
    * request karate.merge(body, { location: at(20) })
    * method post
    * status 201
    # auto-accept confirms at once (REQ-022)
    * match response.request.status == 'confirmed'

    * path 'api', 'passenger', 'requests'
    * request karate.merge(body, { location: at(20) })
    * method post
    * status 409
    * match response.error.code == 'request_active'

  Scenario: the demo reset needs no token and leaves the demo ready to start
    * configure headers = {}
    * path 'api', 'demo', 'reset'
    * method post
    * status 204
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'passenger', 'profile'
    * method get
    * match response.usual_destination.name == '瑞光路 513 巷'
    * configure headers = { Authorization: 'Bearer driver:driver4' }
    * path 'api', 'driver', 'trip'
    * method get
    * match response.trip.status == 'completed'
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * match response contains { capacity: 3, auto_accept: false }
