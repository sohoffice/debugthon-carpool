@api @requests
Feature: ride requests (POST /api/passenger/requests)

  # Cars come from fresh karate-request- drivers that depart through the API at the last pickup
  # point, which the seeded trips and the other features do not use. Scenarios run in parallel, so
  # each one isolates its car with a tag of its own: the passenger requires it, and only that
  # scenario's car carries it. Passengers are fresh accounts. Drivers and passengers that took
  # part stay in the database, their trips ended (see cleanup-tracking.feature).

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def passenger = 'karate-request-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', passenger, passenger)
    * def drivers = []
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }); drivers.forEach(function(u) { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: u }) }) }
    * def auth = { Authorization: '#("Bearer passenger:" + passenger)' }
    * configure headers = auth
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[response.length - 1]
    * path 'api', 'bus-stops'
    * method get
    * def stop = response[0]
    * path 'api', 'tags'
    * method get
    * def tags = response
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def car = function(name, tagId, autoAccept) { var u = 'karate-request-driver-' + name + '-' + suffix; drivers.push(u); return karate.call('classpath:carpool/api/supply-car.feature', { user: u, pickup: pickup, northM: 500, tagIds: [tagId], body: { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: autoAccept, tag_filters: [] } }).tripId }
    * def submission = function(tagFilters, northM) { return { pickup_point_id: pickup.id, location: { lat: pickup.lat + northM * 0.000009, lng: pickup.lng }, destination: inPark, stop_ids: [stop.id], tag_filters: tagFilters } }

  Scenario: a request is assigned to the car and waits for the driver
    * def tagId = tags[0].id
    * def tripId = car('wait', tagId, false)
    * path 'api', 'passenger', 'requests'
    * request submission([{ tag_id: tagId, intent: 'required' }], 0)
    * method post
    * status 201
    * match response contains { status: 'waiting_driver', relaxed: false, trip_id: '#(tripId)', pickup_point_id: '#(pickup.id)', reason: null, confirmed_at: null }
    * match response.id == '#number'
    * match response.response_deadline_at == '#string'
    * match response.submitted_lat == pickup.lat
    * match response.submitted_lng == pickup.lng
    # the seat is held on the trip
    * path 'api', 'trips', tripId
    * method get
    * status 200
    * match response contains { seats_held: 1, seats_confirmed: 0, seats_available: 2 }

  Scenario: a passenger beyond the submit distance is rejected with the reason
    * path 'api', 'passenger', 'requests'
    * request submission([], 1000)
    * method post
    * status 201
    * match response contains { status: 'rejected', reason: 'too_far', trip_id: null, response_deadline_at: null }
    * match response.message contains '送出請求距離'
    * match response.submitted_lat == pickup.lat + 1000 * 0.000009

  Scenario: a final destination outside the park is refused and creates no request
    * def outside = { name: '市區', lat: 25.0478, lng: 121.5170 }
    * def body = submission([], 0)
    * set body.destination = outside
    * path 'api', 'passenger', 'requests'
    * request body
    * method post
    * status 400
    * match response.error.code == 'destination_outside_park'
    * path 'api', 'passenger', 'requests', 'current'
    * method get
    * status 200
    * match response == { request: null }

  Scenario: no car for the passenger answers there is no car
    # no car in this feature carries 可聊天 (the cars carry tags[0..2])
    * def chat = karate.filter(tags, function(g) { return g.name == '可聊天' })[0].id
    * path 'api', 'passenger', 'requests'
    * request submission([{ tag_id: '#(chat)', intent: 'required' }], 0)
    * method post
    * status 201
    * match response contains { status: 'no_match', reason: 'no_match', message: '目前沒有可搭的車', trip_id: null, response_deadline_at: null }

  Scenario: an auto-accept trip waits for the driver too, and the confirm takes the passenger's latest activity
    # REQ-022, DD-13, DD-33: the backend never confirms on its own; the driver UI sends the confirm
    * def tagId = tags[1].id
    * def tripId = car('auto', tagId, true)
    * path 'api', 'activities'
    * method post
    * status 201
    * def activityId = response.id
    * match response.trip_id == null
    * path 'api', 'passenger', 'requests'
    * request submission([{ tag_id: tagId, intent: 'required' }], 0)
    * method post
    * status 201
    * match response contains { status: 'waiting_driver', trip_id: '#(tripId)', confirmed_at: null }
    * match response.response_deadline_at == '#string'
    * def requestId = response.id
    * path 'api', 'trips', tripId
    * method get
    * status 200
    * match response contains { seats_held: 1, seats_confirmed: 0 }
    # not yet confirmed: the activity is not the trip's
    * path 'api', 'location'
    * request { lat: '#(pickup.lat)', lng: '#(pickup.lng)' }
    * method post
    * status 201
    * match response contains { activity_id: '#(activityId)', trip_id: null }
    * def accepted = karate.call('classpath:carpool/api/act-post.feature', { token: 'driver:karate-request-driver-auto-' + suffix, path: 'api/driver/requests/' + requestId + '/accept' })
    * match accepted.responseStatus == 200
    * match accepted.response contains { status: 'confirmed', trip_id: '#(tripId)', response_deadline_at: null }
    * match accepted.response.confirmed_at == '#string'
    * path 'api', 'trips', tripId
    * method get
    * status 200
    * match response contains { seats_held: 0, seats_confirmed: 1 }
    # DD-25: the activity now belongs to the trip, so the passenger's reports are filed under it
    * path 'api', 'location'
    * request { lat: '#(pickup.lat)', lng: '#(pickup.lng)' }
    * method post
    * status 201
    * match response contains { activity_id: '#(activityId)', trip_id: '#(tripId)' }

  Scenario: a car missing a preferred tag still gets the request, marked relaxed
    * def tagId = tags[2].id
    * def tripId = car('relaxed', tagId, false)
    * path 'api', 'passenger', 'requests'
    * request submission([{ tag_id: tagId, intent: 'required' }, { tag_id: tags[3].id, intent: 'preferred' }], 0)
    * method post
    * status 201
    * match response contains { status: 'waiting_driver', trip_id: '#(tripId)', relaxed: true }

  Scenario: a request needs a passenger token and valid input
    * path 'api', 'passenger', 'requests'
    * request submission([], 0)
    * configure headers = {}
    * method post
    * status 401

    * path 'api', 'passenger', 'requests'
    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * request submission([], 0)
    * method post
    * status 403

    * configure headers = auth
    * path 'api', 'passenger', 'requests'
    * request { pickup_point_id: '#(pickup.id)', destination: '#(inPark)', stop_ids: ['#(stop.id)'] }
    * method post
    * status 400
    * match response.error.code == 'invalid_location'

    * path 'api', 'passenger', 'requests'
    * request { pickup_point_id: 999999, location: { lat: 25.05, lng: 121.58 }, destination: '#(inPark)', stop_ids: ['#(stop.id)'] }
    * method post
    * status 400
    * match response.error.code == 'invalid_pickup_point'

  # REQ-085: the passenger filters only by tags that apply to drivers.
  Scenario: a request filtering by a tag that does not apply to drivers is refused
    # tags have no API, so the passenger-only tag is made by SQL and removed afterwards
    * def own = Db.queryLong("INSERT INTO tags (name, applies_to, passenger_self_label, driver_filter_label) VALUES (?, 'passenger', 'karate', 'karate') RETURNING id", 'karate-request-passenger-tag-' + suffix)
    * configure afterScenario = function() { Db.exec('DELETE FROM tags WHERE id = ?', own); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: passenger }) }
    * path 'api', 'passenger', 'requests'
    * request submission([{ tag_id: '#(own)', intent: 'preferred' }], 0)
    * method post
    * status 400
    * match response.error.code == 'tag_not_applicable'
    * path 'api', 'passenger', 'requests', 'current'
    * method get
    * status 200
    * match response == { request: null }
