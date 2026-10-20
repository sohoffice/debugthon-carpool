@api @location
Feature: position reports (POST /api/activities, POST /api/location, GET /api/me/location-reports)

  # No trip API exists yet, so the active trip is created with SQL. location_reports is
  # append-only, so the accounts that report cannot be deleted: every scenario uses its own
  # fresh karate-track- account (parallel-safe, exact assertions) and cleanup-tracking.feature
  # ends its trip afterwards. Only scenarios that send nothing leave no account behind.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def user = null
    * configure afterScenario = function() { if (user) karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: user }) }
    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[0]
    # one metre of latitude is about 0.000009 degrees
    * def at = function(northM) { return { lat: pickup.lat + northM * 0.000009, lng: pickup.lng } }
    * def declare = function(token) { return karate.call('classpath:carpool/api/post-activity.feature', { token: token }).response }
    * def send = function(token, p) { return karate.call('classpath:carpool/api/post-location.feature', { token: token, lat: p.lat, lng: p.lng }).response }

  Scenario: a driver's trip passes the pickup point after the car enters and leaves its range
    * set user = 'karate-track-driver-' + suffix
    * def userId = Db.queryLong('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true) RETURNING id', user, user)
    * def tripId = Db.queryLong("INSERT INTO trips (driver_id, pickup_point_id, destination_name, destination_lat, destination_lng, capacity, status) VALUES (?, ?, 'Office', 25.08, 121.57, 3, 'active') RETURNING id", userId, pickup.id)
    * def token = 'driver:' + user
    * def r = pickup.radius_m
    * match declare(token) == { id: '#number', role: 'driver', trip_id: '#(tripId)', created_at: '#string' }

    * def far = send(token, at(800))
    * match far == { id: '#number', activity_id: '#number', trip_id: '#(tripId)', lat: '#number', lng: '#number', reported_at: '#string', passed_pickup: false, trip_ended: false }
    * match send(token, at(r + 100)).passed_pickup == false
    * match send(token, at(5)).passed_pickup == false
    # just outside the radius but inside the pass_margin setting (25 m by default): not left yet
    * match send(token, at(r + 10)).passed_pickup == false
    * match send(token, at(-(r + 40))).passed_pickup == true
    # once passed it stays passed, even when the car comes back
    * match send(token, at(5)).passed_pickup == true

  Scenario: a passenger's report has no trip
    * set user = 'karate-track-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', user, user)
    * match declare('passenger:' + user) == { id: '#number', role: 'passenger', trip_id: null, created_at: '#string' }
    * def sent = send('passenger:' + user, at(30))
    * match sent == { id: '#number', activity_id: '#number', trip_id: null, lat: '#number', lng: '#number', reported_at: '#string' }

  Scenario: every sent position can be read back, oldest first
    * set user = 'karate-track-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', user, user)
    * def token = 'passenger:' + user
    * def act = declare(token)
    # at(400) is sent twice: repeated positions are kept too
    * def northM = [500, 400, 400, 60]
    * def sendNorth = function(n) { return send(token, at(n)) }
    * def sent = karate.map(northM, sendNorth)

    * configure headers = { Authorization: '#("Bearer passenger:" + user)' }
    * path 'api', 'me', 'location-reports'
    * method get
    * status 200
    * match response == '#[4]'
    * match each response == { id: '#number', activity_id: '#(act.id)', trip_id: null, lat: '#number', lng: '#number', reported_at: '#string' }
    * match response[*].lat == karate.map(northM, function(n) { return at(n).lat })
    * match response[*].lng == karate.map(northM, function(n) { return at(n).lng })

  Scenario: a driver without an active trip cannot take part
    * set user = 'karate-track-driver-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true)', user, user)
    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * path 'api', 'activities'
    * method post
    * status 409
    * match response.error.code == 'no_active_trip'

  Scenario: reporting before taking part is refused
    * set user = 'karate-track-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', user, user)
    * configure headers = { Authorization: '#("Bearer passenger:" + user)' }
    * path 'api', 'location'
    * request at(10)
    * method post
    * status 409
    * match response.error.code == 'no_activity'

  Scenario: declaring again starts a new activity that later reports follow
    * set user = 'karate-track-passenger-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', user, user)
    * def token = 'passenger:' + user
    * def first = declare(token)
    * match send(token, at(20)).activity_id == first.id
    * def second = declare(token)
    * assert second.id != first.id
    * match send(token, at(30)).activity_id == second.id

  Scenario Outline: an invalid body is rejected: <body>
    # Validation runs before the activity lookup, so a seeded account that never declared will do
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'location'
    * request <body>
    * method post
    * status 400
    * match response.error.code == 'invalid_location'

    Examples:
      | body                       |
      | {}                         |
      | { lat: 25.08 }             |
      | { lat: 91, lng: 121.57 }   |
      | { lat: 25.08, lng: 181 }   |
      | { lat: 'x', lng: 121.57 }  |

  Scenario Outline: position APIs need a token: <method> <resource>
    # the Background left a token configured
    * configure headers = {}
    * path 'api', '<resource>'
    * request { lat: 25.08, lng: 121.57 }
    * method <method>
    * status 401

    Examples:
      | method | resource            |
      | post   | activities          |
      | post   | location            |
      | get    | me/location-reports |
