@api @trips
Feature: trips (POST /api/driver/trips, GET /api/driver/trips/current|defaults, GET /api/trips/:id)

  # Departing creates an activity, and activities pin the account (see location.feature), so every
  # scenario uses its own fresh karate-trip- driver; cleanup-tracking.feature ends its trip.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def user = 'karate-trip-driver-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true)', user, user)
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: user }) }
    * def auth = { Authorization: '#("Bearer driver:" + user)' }
    * configure headers = auth
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[0]
    * path 'api', 'tags'
    * method get
    * def tagId = response[0].id
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def depart = function(body) { return karate.call('classpath:carpool/api/post-trip.feature', { body: body, user: user }) }

  Scenario: departing starts a locked trip with its route and the driver can report at once
    * def r = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, tag_filters: [{ tag_id: tagId, intent: 'required' }] })
    * match r.responseStatus == 201
    * match r.response contains { status: 'active', settings_locked: true, auto_accept: true, capacity: 3, seats_available: 3, seats_held: 0, seats_confirmed: 0 }
    * match r.response.pickup_point.id == pickup.id
    * match r.response.destination == inPark
    * match r.response.tag_filters == [{ tag_id: '#(tagId)', name: '#string', intent: 'required' }]
    * match r.response.route == { polyline: '#string', distance_m: '#number', duration_s: '#number', simulated: '#boolean', bus_stops: '#array' }
    * def tripId = r.response.id

    * path 'api', 'trips', tripId
    * method get
    * status 200
    * match response.route.polyline == r.response.route.polyline

    * path 'api', 'driver', 'trips', 'current'
    * method get
    * status 200
    * match response.id == tripId

    # no POST /api/activities: departing already made the driver's activity
    * path 'api', 'location'
    * request { lat: 25.05, lng: 121.58 }
    * method post
    * status 201
    * match response.trip_id == tripId

  Scenario: the next departure is prefilled from the last one
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response == { pickup_point_id: null, destination: null, capacity: null, auto_accept: false, tag_filters: [] }
    * def r = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 2, auto_accept: true, tag_filters: [{ tag_id: tagId, intent: 'preferred' }] })
    * Db.exec("UPDATE trips SET status = 'completed', ended_at = now() WHERE id = ?", r.response.id)
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response == { pickup_point_id: '#(pickup.id)', destination: '#(inPark)', capacity: 2, auto_accept: true, tag_filters: [{ tag_id: '#(tagId)', intent: 'preferred' }] }

  Scenario: a departure with a bad pickup point, destination, capacity or tag is refused and starts nothing
    * def bad = function(body, code) { var r = depart(body); karate.match(r.responseStatus, 400); karate.match(r.response.error.code, code) }
    * eval bad({ pickup_point_id: 999999, destination: inPark, capacity: 3 }, 'invalid_pickup_point')
    * eval bad({ pickup_point_id: pickup.id, destination: { name: '台北車站', lat: 25.0478, lng: 121.5170 }, capacity: 3 }, 'destination_outside_park')
    * eval bad({ pickup_point_id: pickup.id, destination: inPark, capacity: 0 }, 'invalid_request')
    * eval bad({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, tag_filters: [{ tag_id: 999999, intent: 'required' }] }, 'invalid_tag')
    * eval bad({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, tag_filters: [{ tag_id: tagId, intent: 'must' }] }, 'invalid_request')
    * path 'api', 'driver', 'trips', 'current'
    * method get
    * status 404

  Scenario: a second departure while one is active is refused
    * def body = { pickup_point_id: '#(pickup.id)', destination: '#(inPark)', capacity: 3 }
    * match depart(body).responseStatus == 201
    * def again = depart(body)
    * match again.responseStatus == 409
    * match again.response.error.code == 'already_active'

  Scenario: settings are locked at departure and no API can modify them
    * def r = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true })
    * def tripId = r.response.id
    * match r.response.settings_locked == true
    * path 'api', 'driver', 'trips', tripId
    * request { auto_accept: false }
    * method patch
    * status 404
    * path 'api', 'trips', tripId
    * method get
    * status 200
    * match response contains { auto_accept: true, settings_locked: true, tag_filters: [] }

  Scenario: a trip created with SQL gets its route the first time it is read
    * def id = Db.queryLong("INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status) VALUES ((SELECT id FROM users WHERE username = ?), ?, 'Office', 25.0768, 121.5738, 3, 'active') RETURNING id", user, pickup.id)
    * path 'api', 'trips', id
    * method get
    * status 200
    * match response.route == { polyline: '#string', distance_m: '#number', duration_s: '#number', simulated: true, bus_stops: '#array' }

  Scenario: unknown trips are not found
    * path 'api', 'trips', 999999999
    * method get
    * status 404

  Scenario: a missing token is unauthorized and a passenger cannot depart
    * configure headers = {}
    * path 'api', 'driver', 'trips'
    * request { pickup_point_id: 1, destination: '#(inPark)', capacity: 3 }
    * method post
    * status 401
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'driver', 'trips'
    * request { pickup_point_id: 1, destination: '#(inPark)', capacity: 3 }
    * method post
    * status 403
