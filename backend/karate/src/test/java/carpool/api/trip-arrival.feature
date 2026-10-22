@api @arrival
Feature: a trip ends when the car arrives at its destination (POST /api/location, GET /api/trips/:id)

  # REQ-070, DD-30. Same isolation as e2e-happy-path.feature: a fresh driver departs at the last
  # pickup point and the passenger requires a tag created for this scenario by SQL, so parallel
  # scenarios cannot take the request. The tag is removed afterwards; the accounts stay (see
  # cleanup-tracking.feature).

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def passenger = 'karate-arrival-passenger-' + suffix
    * def driver = 'karate-trip-arrival-' + suffix
    * def tagId = Db.queryLong("INSERT INTO tags (name, applies_to, driver_self_label, passenger_filter_label) VALUES (?, 'driver', 'karate', 'karate') RETURNING id", 'karate-arrival-' + suffix)
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * def afterAll = function() { Db.exec('DELETE FROM request_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM trip_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM tags WHERE id = ?', tagId); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: driver }) }
    * configure afterScenario = afterAll
    * def pt = 'passenger:' + passenger
    * def dt = 'driver:' + driver
    * def doGet = function(token, path) { return karate.call('classpath:carpool/api/act-get.feature', { token: token, path: path }) }
    * def doPost = function(token, path) { return karate.call('classpath:carpool/api/act-post.feature', { token: token, path: path }) }
    * def at = function(lat, lng) { return karate.call('classpath:carpool/api/post-location.feature', { token: dt, lat: lat, lng: lng }) }
    * def pickups = doGet(pt, 'api/pickup-points').response
    * def pickup = pickups[pickups.length - 1]
    * def stop = doGet(pt, 'api/bus-stops').response[0]
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def tripId = karate.call('classpath:carpool/api/supply-car.feature', { user: driver, pickup: pickup, northM: 500, tagIds: [tagId], body: { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: false, tag_filters: [] } }).tripId

  Scenario: the driver drives to the destination; the trip ends and the passenger's ride is completed
    * def req = karate.call('classpath:carpool/api/submit-request.feature', { token: pt, body: { pickup_point_id: pickup.id, location: { lat: pickup.lat, lng: pickup.lng }, destination: inPark, stop_ids: [stop.id], tag_filters: [{ tag_id: tagId, intent: 'required' }] } }).response
    * match req contains { status: 'waiting_driver', trip_id: '#(tripId)' }
    * match doPost(dt, 'api/driver/requests/' + req.id + '/accept').responseStatus == 200

    # through the pickup point (DD-06), then up to the destination
    * match at(pickup.lat, pickup.lng).response contains { passed_pickup: false, trip_ended: false }
    * match at(pickup.lat + 200 * 0.000009, pickup.lng).response contains { passed_pickup: true, trip_ended: false }
    # about 100 m short of the destination: still outside the 50 m arrival radius
    * match at(inPark.lat - 100 * 0.000009, inPark.lng).response.trip_ended == false
    * match doGet(dt, 'api/driver/trips/current').responseStatus == 200
    * def arrived = at(inPark.lat, inPark.lng)
    * match arrived.response.trip_ended == true

    # the driver UI: requests list has no trip, the trip says it ended and how many rides it completed
    * match doGet(dt, 'api/driver/requests').response == { trip_id: null, pending: [], passengers: [] }
    * match doGet(dt, 'api/driver/trips/current').responseStatus == 404
    * match doGet(dt, 'api/trips/' + tripId).response contains { id: '#(tripId)', status: 'completed', ended_at: '#string', completed_rides: 1, seats_held: 0, seats_confirmed: 0 }

    # REQ-067: the passenger's ride is completed, with its service record (REQ-055)
    * match doGet(pt, 'api/passenger/requests/' + req.id).response contains { status: 'completed', completed_at: '#string' }
    * match doGet(pt, 'api/passenger/requests/current').response.request == null
    * match Db.queryLong('SELECT count(*) FROM service_records WHERE request_id = ? AND trip_id = ?', req.id, tripId) == 1

  Scenario: reaching the destination before passing the pickup point does not end the trip
    * match at(inPark.lat, inPark.lng).response contains { passed_pickup: false, trip_ended: false }
    * match doGet(dt, 'api/trips/' + tripId).response contains { status: 'active', ended_at: null, completed_rides: 0 }

  Scenario: reporting a position needs a token
    * path 'api', 'location'
    * request { lat: '#(inPark.lat)', lng: '#(inPark.lng)' }
    * method post
    * status 401
    * path 'api', 'trips', tripId
    * method get
    * status 401
