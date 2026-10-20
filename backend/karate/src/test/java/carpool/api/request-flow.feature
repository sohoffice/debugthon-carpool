@api @request-flow
Feature: ride request flow after submission (driver response, timeout, boarding, completion)

  # Each scenario puts its own cars at the last pickup point and isolates them with a tag created
  # for it by SQL (tags have no API), which the passenger requires; so scenarios run in parallel.
  # The tag is removed afterwards. Passengers and drivers that took part stay (see
  # cleanup-tracking.feature); their trips are ended. The backend's timeout sweeper runs in the
  # background, so the timeout scenario waits for it.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def passenger = 'karate-flow-passenger-' + suffix
    * def other = 'karate-flow-other-' + suffix
    * def tagName = 'karate-flow-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', other, other)
    * def tagId = Db.queryLong('INSERT INTO tags (name) VALUES (?) RETURNING id', tagName)
    * def drivers = []
    * def afterAll = function() { Db.exec('DELETE FROM request_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM trip_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM tags WHERE id = ?', tagId); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: other }); drivers.forEach(function(u) { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: u }) }) }
    * configure afterScenario = afterAll
    * def pt = 'passenger:' + passenger
    * configure headers = { Authorization: '#("Bearer " + pt)' }
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[response.length - 1]
    * path 'api', 'bus-stops'
    * method get
    * def stop = response[0]
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def car = function(name, northM, autoAccept) { var u = 'karate-flow-driver-' + name + '-' + suffix; drivers.push(u); return karate.call('classpath:carpool/api/supply-car.feature', { user: u, pickup: pickup, northM: northM, tagIds: [tagId], body: { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: autoAccept, tag_filters: [] } }).tripId }
    * def driverToken = function(name) { return 'driver:karate-flow-driver-' + name + '-' + suffix }
    * def submit = function() { return karate.call('classpath:carpool/api/submit-request.feature', { token: pt, body: { pickup_point_id: pickup.id, location: { lat: pickup.lat, lng: pickup.lng }, destination: inPark, stop_ids: [stop.id], tag_filters: [{ tag_id: tagId, intent: 'required' }] } }).response }
    * def doPost = function(token, path) { return karate.call('classpath:carpool/api/act-post.feature', { token: token, path: path }) }
    * def doGet = function(token, path) { return karate.call('classpath:carpool/api/act-get.feature', { token: token, path: path }) }

  Scenario: the driver sees the request with pickup and drop-off and accepts it
    * def tripId = car('accept', 500, false)
    * def req = submit()
    * match req.status == 'waiting_driver'
    * def d = driverToken('accept')
    * def list = doGet(d, 'api/driver/requests')
    * match list.responseStatus == 200
    * match list.response.trip_id == tripId
    * match list.response.pending == '#[1]'
    * match list.response.pending[0] contains deep { id: '#(req.id)', status: 'waiting_driver', pickup_point: { id: '#(pickup.id)', name: '#(pickup.name)' }, dropoff: { name: '#string', lat: '#number', lng: '#number' } }
    * match list.response.pending[0].response_deadline_at == '#string'
    * match list.response.passengers == '#[0]'
    * def accepted = doPost(d, 'api/driver/requests/' + req.id + '/accept')
    * match accepted.responseStatus == 200
    * match accepted.response contains { status: 'confirmed', trip_id: '#(tripId)', response_deadline_at: null }
    * def seats = doGet(d, 'api/trips/' + tripId)
    * match seats.response contains { seats_held: 0, seats_confirmed: 1 }
    # answering again is refused
    * match doPost(d, 'api/driver/requests/' + req.id + '/accept').responseStatus == 409
    * match doPost(d, 'api/driver/requests/' + req.id + '/decline').responseStatus == 409
    # REQ-052: the passenger sees where, which car and when
    * def status = doGet(pt, 'api/passenger/requests/' + req.id)
    * match status.responseStatus == 200
    * match status.response contains deep { status: 'confirmed', reassigned_count: 0, pickup_point: { id: '#(pickup.id)' }, vehicle: '#object', eta_s: '#number', trip: { id: '#(tripId)', route: '#object' } }
    * match status.response.eta_s == '#? _ > 0'
    # REQ-069: the unfinished request is the current one
    * def current = doGet(pt, 'api/passenger/requests/current')
    * match current.response.request.id == req.id

  Scenario: a declined request goes to the next car and, with none left, to no car
    * def first = car('first', 500, false)
    * def second = car('second', 1500, false)
    * def req = submit()
    * match req.trip_id == first
    * def declined = doPost(driverToken('first'), 'api/driver/requests/' + req.id + '/decline')
    * match declined.responseStatus == 200
    * match declined.response contains { status: 'waiting_driver', trip_id: '#(second)' }
    * match doGet(driverToken('first'), 'api/trips/' + first).response contains { seats_held: 0 }
    * match doGet(driverToken('second'), 'api/trips/' + second).response contains { seats_held: 1 }
    * match doGet(pt, 'api/passenger/requests/' + req.id).response.reassigned_count == 1
    # the declined driver no longer owns it
    * match doPost(driverToken('first'), 'api/driver/requests/' + req.id + '/accept').responseStatus == 404
    * def last = doPost(driverToken('second'), 'api/driver/requests/' + req.id + '/decline')
    * match last.response contains { status: 'no_match', trip_id: null, response_deadline_at: null }
    * match doGet(driverToken('second'), 'api/trips/' + second).response contains { seats_held: 0 }
    * def status = doGet(pt, 'api/passenger/requests/' + req.id)
    * match status.response contains { status: 'no_match', reassigned_count: 2, reason: 'no_match', message: '目前沒有可搭的車' }
    * match doGet(pt, 'api/passenger/requests/current').response.request == null

  Scenario: a request the driver does not answer in time is reassigned by the backend
    * def first = car('slow', 500, false)
    * def second = car('next', 1500, false)
    * def req = submit()
    * match req.trip_id == first
    # no API moves the clock: put the deadline in the past
    * Db.exec("UPDATE ride_requests SET response_deadline_at = now() - interval '1 second' WHERE id = ?", req.id)
    * def waitFor = function() { return doGet(pt, 'api/passenger/requests/' + req.id).response.trip_id }
    * eval var n = 0; while (waitFor() == first && n < 15) { java.lang.Thread.sleep(500); n++ }
    * def status = doGet(pt, 'api/passenger/requests/' + req.id)
    * match status.response contains { status: 'waiting_driver', trip_id: '#(second)', reassigned_count: 1 }
    * match doGet(driverToken('slow'), 'api/trips/' + first).response contains { seats_held: 0 }

  Scenario Outline: boarding is marked once, by <first> first, and the later side gets the same answer
    * def tripId = car('board', 500, true)
    * def req = submit()
    * match req.status == 'confirmed'
    * def d = driverToken('board')
    * def mark = function(who) { return who == 'passenger' ? doPost(pt, 'api/passenger/requests/' + req.id + '/board') : doPost(d, 'api/driver/requests/' + req.id + '/board') }
    * def a = mark('<first>')
    * match a.responseStatus == 200
    * match a.response contains { status: 'boarded', boarded_at: '#string' }
    * def b = mark('<second>')
    * match b.responseStatus == 200
    * match b.response.status == 'boarded'
    * match b.response.boarded_at == a.response.boarded_at
    # the seat stays occupied
    * match doGet(d, 'api/trips/' + tripId).response contains { seats_held: 0, seats_confirmed: 1 }
    # the driver sees who boarded; the passenger no longer gets ETA or pickup
    * def list = doGet(d, 'api/driver/requests')
    * match list.response.passengers == '#[1]'
    * match list.response.passengers[0] contains { id: '#(req.id)', status: 'boarded', boarded: true }
    * def status = doGet(pt, 'api/passenger/requests/' + req.id)
    * match status.response contains { status: 'boarded', eta_s: null, pickup_point: null, vehicle: null, trip: null }

    Examples:
      | first     | second    |
      | passenger | driver    |
      | driver    | passenger |
      | passenger | passenger |

  Scenario: only a confirmed request can be marked as boarded
    * def tripId = car('early', 500, false)
    * def req = submit()
    * match doPost(pt, 'api/passenger/requests/' + req.id + '/board').responseStatus == 409
    * match doPost(driverToken('early'), 'api/driver/requests/' + req.id + '/board').responseStatus == 409
    * match doGet(pt, 'api/passenger/requests/' + req.id).response.status == 'waiting_driver'

  Scenario Outline: the ride can be ended <how>, and ending it twice is harmless
    * def tripId = car('end', 500, true)
    * def req = submit()
    * def d = driverToken('end')
    * eval if ('<boarded>' == 'yes') doPost(pt, 'api/passenger/requests/' + req.id + '/board')
    * def end = function(who) { return who == 'passenger' ? doPost(pt, 'api/passenger/requests/' + req.id + '/complete') : doPost(d, 'api/driver/requests/' + req.id + '/complete') }
    * def a = end('<by>')
    * match a.responseStatus == 200
    * match a.response contains { status: 'completed', completed_at: '#string' }
    * match end('<by>' == 'passenger' ? 'driver' : 'passenger').response.completed_at == a.response.completed_at
    * match doGet(d, 'api/trips/' + tripId).response contains { seats_held: 0, seats_confirmed: 0 }
    * match doGet(pt, 'api/passenger/requests/current').response.request == null
    * def record = Db.queryLong('SELECT count(*) FROM service_records WHERE request_id = ? AND passenger_id IS NOT NULL AND driver_id IS NOT NULL AND trip_id = ? AND pickup_point_id = ? AND dropoff_name <> \'\' AND completed_at IS NOT NULL AND (picked_up_at IS NOT NULL) = ?', req.id, tripId, pickup.id, '<boarded>' == 'yes')
    * match record == 1
    * match Db.queryLong('SELECT count(*) FROM service_records WHERE request_id = ?', req.id) == 1

    Examples:
      | how                          | boarded | by        |
      | by the passenger after boarding | yes   | passenger |
      | by the driver after boarding    | yes   | driver    |
      | by the passenger without boarding | no  | passenger |
      | by the driver without boarding    | no  | driver    |

  Scenario: only a confirmed request can be completed
    * def tripId = car('notyet', 500, false)
    * def req = submit()
    * match doPost(pt, 'api/passenger/requests/' + req.id + '/complete').responseStatus == 409
    * match doPost(driverToken('notyet'), 'api/driver/requests/' + req.id + '/complete').responseStatus == 409

  Scenario: request actions need the right token and a party of the request
    * def tripId = car('auth', 500, false)
    * def req = submit()
    * def d = driverToken('auth')
    * def actions = ['accept', 'decline', 'board', 'complete']
    * def check = function(a) { var p = 'api/driver/requests/' + req.id + '/' + a; karate.match(doPost('', p).responseStatus, 401); karate.match(doPost(pt, p).responseStatus, 403); karate.match(doPost('driver:driver5', p).responseStatus, 404) }
    * karate.forEach(actions, check)
    * def checkPassenger = function(a) { var p = 'api/passenger/requests/' + req.id + '/' + a; karate.match(doPost('', p).responseStatus, 401); karate.match(doPost(d, p).responseStatus, 403); karate.match(doPost('passenger:' + other, p).responseStatus, 404) }
    * karate.forEach(['board', 'complete'], checkPassenger)
    * match doGet('', 'api/driver/requests').responseStatus == 401
    * match doGet(pt, 'api/driver/requests').responseStatus == 403
    * match doGet('', 'api/passenger/requests/current').responseStatus == 401
    * match doGet(d, 'api/passenger/requests/current').responseStatus == 403
    * match doGet('passenger:' + other, 'api/passenger/requests/' + req.id).responseStatus == 404
    * match doGet(pt, 'api/passenger/requests/999999999').responseStatus == 404
    # nothing of the above changed the request
    * match doGet(pt, 'api/passenger/requests/' + req.id).response.status == 'waiting_driver'
    # a driver without a trip has nothing to answer
    * match doGet('driver:driver5', 'api/driver/requests').response == { trip_id: null, pending: [], passengers: [] }
