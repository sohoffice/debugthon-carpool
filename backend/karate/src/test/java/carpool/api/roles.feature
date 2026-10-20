@api @roles
Feature: role-restricted APIs

  Background:
    * url baseUrl

  Scenario: passenger token cannot call the driver API
    * path 'api', 'driver', 'profile'
    * header Authorization = 'Bearer passenger:passenger1'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

  Scenario: driver token cannot call the passenger API
    * path 'api', 'passenger', 'profile'
    * header Authorization = 'Bearer driver:driver1'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

  Scenario: driver profile for a driver
    * path 'api', 'driver', 'profile'
    * header Authorization = 'Bearer driver:driver1'
    * method get
    * status 200
    * match response contains { usual_pickup_point: '#null', usual_destination: '#null', capacity: '#null' }

  Scenario: passenger profile for a passenger
    * path 'api', 'passenger', 'profile'
    # passenger2: passenger1 starts with the Demo profile (DD-19, see seeded.feature)
    * header Authorization = 'Bearer passenger:passenger2'
    * method get
    * status 200
    * match response contains { usual_arrival_time: '#null', usual_destination: '#null', accepted_stops: '#[]' }

  Scenario: driver profile without a token
    * path 'api', 'driver', 'profile'
    * method get
    * status 401

  Scenario: unknown route uses the error format
    * path 'api', 'nope'
    * header Authorization = 'Bearer driver:driver1'
    * method get
    * status 404
    * match response == { error: { code: 'not_found', message: '#string' } }

  # Habitual data is accumulated from rides, never filled in by users (DD-19).
  Scenario Outline: profile is read-only - <method> <resource>
    * configure headers = { Authorization: '<token>' }
    * path 'api', '<resource>', 'profile'
    * request { capacity: 9 }
    * method <method>
    * status 405
    * match response == { error: { code: 'method_not_allowed', message: '#string' } }

    Examples:
      | method | resource  | token                       |
      | put    | driver    | Bearer driver:driver1       |
      | post   | driver    | Bearer driver:driver1       |
      | patch  | driver    | Bearer driver:driver1       |
      | delete | driver    | Bearer driver:driver1       |
      | put    | passenger | Bearer passenger:passenger1 |
      | post   | passenger | Bearer passenger:passenger1 |
      | patch  | passenger | Bearer passenger:passenger1 |
      | delete | passenger | Bearer passenger:passenger1 |
