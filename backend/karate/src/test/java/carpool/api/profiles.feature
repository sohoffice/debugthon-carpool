@api @profiles
Feature: habitual profiles and multi-role accounts

  # No REST endpoint writes accounts or habitual data (DD-19): accounts come from SQL and
  # profiles from completed rides. So these fixtures are inserted with SQL through Db.java,
  # referencing the seeded pickup points and bus stops, and removed in afterScenario.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup.feature', { suffix: suffix }) }

  Scenario: driver profile shows accumulated habitual data
    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * path 'api', 'pickup-points'
    * method get
    * def pickup = response[0]

    * def user = 'karate-driver-' + suffix
    * def userId = Db.queryLong('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true) RETURNING id', user, user)
    * Db.exec('INSERT INTO driver_profiles (user_id, usual_pickup_point_id, usual_destination_name, usual_destination_lat, usual_destination_lng, capacity) VALUES (?, ?, ?, 24.9, 121.4, 3)', userId, pickup.id, 'Home')

    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * path 'api', 'driver', 'profile'
    * method get
    * status 200
    # No vehicle row and no points for this account: vehicle is null and the balance 0 (DD-34)
    * match response == { usual_pickup_point: '#(pickup)', usual_destination: { name: 'Home', lat: 24.9, lng: 121.4 }, capacity: 3, vehicle: null, point_balance: 0 }

  Scenario: passenger profile shows accumulated habitual data
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'bus-stops'
    * method get
    * def stop = response[0]

    * def user = 'karate-passenger-' + suffix
    * def userId = Db.queryLong('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true) RETURNING id', user, user)
    * Db.exec("INSERT INTO passenger_profiles (user_id, usual_arrival_time, usual_destination_name, usual_destination_lat, usual_destination_lng) VALUES (?, '09:30', 'Office', 25.2, 121.7)", userId)
    * Db.exec('INSERT INTO passenger_accepted_stops (user_id, bus_stop_id) VALUES (?, ?)', userId, stop.id)

    * configure headers = { Authorization: '#("Bearer passenger:" + user)' }
    * path 'api', 'passenger', 'profile'
    * method get
    * status 200
    * match response == { usual_arrival_time: '09:30', usual_destination: { name: 'Office', lat: 25.2, lng: 121.7 }, accepted_stops: ['#(stop)'] }

  Scenario: an account with both roles can act as either
    * def user = 'karate-dual-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver, is_passenger) VALUES (?, ?, true, true)', user, user)

    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * path 'api', 'me'
    * method get
    * status 200
    * match response contains { role: 'driver', roles: ['driver', 'passenger'], simulated: false }

    * configure headers = { Authorization: '#("Bearer passenger:" + user)' }
    * path 'api', 'me'
    * method get
    * status 200
    * match response contains { role: 'passenger', roles: ['driver', 'passenger'] }
