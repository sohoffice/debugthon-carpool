@api @points
Feature: driver profile and points (REQ-071..REQ-075, DD-34, DD-35)

  # Reads the demo seed only: driver4 and driver5 have no seeded trips, so no other scenario
  # credits them, and the Demo reset puts their points back to the same seed.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')

  Scenario: driver profile carries the name, the vehicle and the point balance
    * path 'api', 'me'
    * header Authorization = 'Bearer driver:driver4'
    * method get
    * def me = response
    * path 'api', 'driver', 'profile'
    * header Authorization = 'Bearer driver:driver4'
    * method get
    * status 200
    # DD-35: the drawer's name, the same as /api/me
    * match response.display_name == me.display_name
    * match response contains { vehicle: { plate: 'ABC-0004', description: '#string' }, point_balance: '#number? _ > 0' }
    * def ledger = Db.queryLong("SELECT COALESCE(sum(delta), 0) FROM driver_point_ledger WHERE driver_id = (SELECT id FROM users WHERE username = 'driver4')")
    * match response.point_balance == ledger

  Scenario: a driver without rides has empty usual data but a name and a balance
    * path 'api', 'me'
    * header Authorization = 'Bearer driver:driver5'
    * method get
    * def me = response
    * path 'api', 'driver', 'profile'
    * header Authorization = 'Bearer driver:driver5'
    * method get
    * status 200
    * match response contains { display_name: '#(me.display_name)', usual_pickup_point: null, usual_destination: null, capacity: null, point_balance: '#number? _ > 0' }

  Scenario: the latest points, 5 by default, newest first
    * path 'api', 'driver', 'points'
    * header Authorization = 'Bearer driver:driver4'
    * method get
    * status 200
    * match response.points == '#[5]'
    * match each response.points == { delta: '#number', reason: '#? _ == "seed" || _ == "ride"', service_record_id: '##number', created_at: '#string' }
    * def times = karate.map(response.points, function(p) { return p.created_at })
    * def sorted = karate.sort(times, function(x) { return x }).reverse()
    * match times == sorted

  Scenario: limit picks how many
    * path 'api', 'driver', 'points'
    * param limit = 2
    * header Authorization = 'Bearer driver:driver4'
    * method get
    * status 200
    * match response.points == '#[2]'

  Scenario: an invalid limit is refused
    * path 'api', 'driver', 'points'
    * param limit = 0
    * header Authorization = 'Bearer driver:driver4'
    * method get
    * status 400
    * match response.error.code == 'invalid_request'

  Scenario Outline: a passenger token is refused - <resource>
    * path 'api', 'driver', '<resource>'
    * header Authorization = 'Bearer passenger:passenger1'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

    Examples:
      | resource |
      | profile  |
      | points   |

  Scenario Outline: no token is refused - <resource>
    * path 'api', 'driver', '<resource>'
    * method get
    * status 401

    Examples:
      | resource |
      | profile  |
      | points   |
