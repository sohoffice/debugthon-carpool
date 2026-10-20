@api @e2e
Feature: end-to-end happy path (depart, supply, request, accept, board, complete)

  # REQ-065: one ride from the driver's departure to its end, through the API only. Every step
  # asserts its own response and that the result of the previous step shows up in it.
  # Edge cases of each step live in request-flow.feature; this file keeps the single chain.
  # The car is isolated by a tag created for this scenario by SQL (tags have no API) that the
  # passenger requires, so parallel scenarios cannot take the request. The tag is removed
  # afterwards; the driver and passenger stay (see cleanup-tracking.feature), the trip is ended.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def passenger = 'karate-e2e-passenger-' + suffix
    * def driver = 'karate-trip-e2e-' + suffix
    * def tagId = Db.queryLong('INSERT INTO tags (name) VALUES (?) RETURNING id', 'karate-e2e-' + suffix)
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * def afterAll = function() { Db.exec('DELETE FROM request_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM trip_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM tags WHERE id = ?', tagId); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: driver }) }
    * configure afterScenario = afterAll
    * def pt = 'passenger:' + passenger
    * def dt = 'driver:' + driver
    * configure headers = { Authorization: '#("Bearer " + pt)' }
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[response.length - 1]
    * path 'api', 'bus-stops'
    * method get
    * def stop = response[0]
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def parkCheck = function(token, p) { return karate.http(baseUrl + '/api/park/check').header('Authorization', 'Bearer ' + token).params({ lat: p.lat, lng: p.lng }).get().body }
    * def doGet = function(token, path) { return karate.call('classpath:carpool/api/act-get.feature', { token: token, path: path }) }
    * def doPost = function(token, path) { return karate.call('classpath:carpool/api/act-post.feature', { token: token, path: path }) }

  Scenario: a ride goes from departure to completion
    # 0. REQ-001, DD-32: the driver and the passenger each check the destination they picked (from Google Places in the UI) is in the park
    * match parkCheck('driver:driver4', inPark) == { inside: true }
    * match parkCheck(pt, inPark) == { inside: true }

    # 1. REQ-015: the driver departs (auto_accept off, so the driver must confirm) and reports a position
    * def tripId = karate.call('classpath:carpool/api/supply-car.feature', { user: driver, pickup: pickup, northM: 500, tagIds: [tagId], body: { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: false, tag_filters: [] } }).tripId
    * def trip = doGet(dt, 'api/driver/trips/current')
    * match trip.responseStatus == 200
    * match trip.response contains { id: '#(tripId)', status: 'active', capacity: 3, auto_accept: false }

    # 2. REQ-029: the passenger sees the approaching car, with all seats free
    * def supply = function() { return karate.http(baseUrl + '/api/passenger/supply').header('Authorization', 'Bearer ' + pt).params({ pickup_point_id: pickup.id, dest_lat: inPark.lat, dest_lng: inPark.lng, stop_ids: stop.id, required_tags: tagId }).get().body }
    * def seen = supply()
    * match seen.cars == '#[1]'
    * match seen.cars[0] contains { trip_id: '#(tripId)', eta_s: '#? _ > 0', seats_available: 3 }
    * match seen.card contains { count: 1, seats_remaining: 3 }
    # REQ-063, DD-09: the ETA says it is simulated
    * match seen.cars[0].eta_simulated == true
    * match seen.card.fastest_eta_simulated == true

    # 3. REQ-036: the request is assigned to that driver, one seat held
    * def req = karate.call('classpath:carpool/api/submit-request.feature', { token: pt, body: { pickup_point_id: pickup.id, location: { lat: pickup.lat, lng: pickup.lng }, destination: inPark, stop_ids: [stop.id], tag_filters: [{ tag_id: tagId, intent: 'required' }] } }).response
    * match req contains { status: 'waiting_driver', trip_id: '#(tripId)' }
    * match doGet(dt, 'api/trips/' + tripId).response contains { seats_held: 1, seats_confirmed: 0 }
    * match supply().cars[0].seats_available == 2

    # 4. REQ-049: the request is on the driver's list and the driver confirms it
    * def pending = doGet(dt, 'api/driver/requests')
    * match pending.response.trip_id == tripId
    * match pending.response.pending == '#[1]'
    * match pending.response.pending[0].id == req.id
    * match pending.response.passengers == '#[0]'
    * def accepted = doPost(dt, 'api/driver/requests/' + req.id + '/accept')
    * match accepted.responseStatus == 200
    * match accepted.response contains { id: '#(req.id)', status: 'confirmed', trip_id: '#(tripId)' }
    * match doGet(dt, 'api/trips/' + tripId).response contains { seats_held: 0, seats_confirmed: 1 }
    # REQ-065: the passenger receives the confirmation with pickup, vehicle and ETA
    * def confirmed = doGet(pt, 'api/passenger/requests/' + req.id)
    * match confirmed.response contains deep { status: 'confirmed', pickup_point: { id: '#(pickup.id)' }, vehicle: '#object', eta_s: '#number', trip: { id: '#(tripId)' } }
    * match doGet(pt, 'api/passenger/requests/current').response.request.id == req.id
    * match doGet(dt, 'api/driver/requests').response contains { pending: '#[0]', passengers: '#[1]' }
    # REQ-052, REQ-063, DD-31: the car is on the map, not yet at the pickup, and its ETA is marked simulated
    * match confirmed.response contains { passed_pickup: false, eta_simulated: true }
    * match confirmed.response.vehicle_position contains { lat: '#(pickup.lat + 500 * 0.000009)', lng: '#(pickup.lng)', heading_deg: null, reported_at: '#string' }

    # 4b. DD-31: the car drives towards the pickup; the passenger sees it move and which way it heads
    * karate.call('classpath:carpool/api/post-location.feature', { token: dt, lat: pickup.lat + 200 * 0.000009, lng: pickup.lng })
    * def approaching = doGet(pt, 'api/passenger/requests/' + req.id).response
    * match approaching.vehicle_position.lat == pickup.lat + 200 * 0.000009
    * match approaching.vehicle_position.heading_deg == '#number? _ > 179 && _ < 181'
    * match approaching contains { passed_pickup: false, eta_s: '#? _ < confirmed.response.eta_s' }

    # 5. REQ-068, DD-27: the passenger marks boarding and the request becomes boarded
    * def boarded = doPost(pt, 'api/passenger/requests/' + req.id + '/board')
    * match boarded.responseStatus == 200
    * match boarded.response contains { id: '#(req.id)', status: 'boarded', boarded_at: '#string' }
    * match doGet(pt, 'api/passenger/requests/' + req.id).response contains { status: 'boarded', boarded_at: '#(boarded.response.boarded_at)', vehicle_position: null, passed_pickup: null }
    * def onBoard = doGet(dt, 'api/driver/requests').response.passengers
    * match onBoard == '#[1]'
    * match onBoard[0] contains { id: '#(req.id)', boarded: true }
    * match doGet(dt, 'api/trips/' + tripId).response contains { seats_held: 0, seats_confirmed: 1 }

    # 6. REQ-067, DD-23: the ride ends, the seat is freed and nothing is left unfinished
    * def done = doPost(dt, 'api/driver/requests/' + req.id + '/complete')
    * match done.responseStatus == 200
    * match done.response contains { id: '#(req.id)', status: 'completed', completed_at: '#string' }
    * match doGet(pt, 'api/passenger/requests/' + req.id).response contains { status: 'completed', completed_at: '#(done.response.completed_at)' }
    * match doGet(pt, 'api/passenger/requests/current').response.request == null
    * match doGet(dt, 'api/trips/' + tripId).response contains { seats_held: 0, seats_confirmed: 0 }
    * match doGet(dt, 'api/driver/requests').response contains { pending: '#[0]', passengers: '#[0]' }
    * match Db.queryLong('SELECT count(*) FROM service_records WHERE request_id = ? AND trip_id = ? AND picked_up_at IS NOT NULL AND completed_at IS NOT NULL', req.id, tripId) == 1
