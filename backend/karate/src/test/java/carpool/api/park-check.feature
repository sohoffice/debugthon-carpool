@api @park-check
Feature: park check (GET /api/park/check)

  Background:
    * url baseUrl

  Scenario Outline: a point is answered as inside or outside the park for <who>
    * configure headers = { Authorization: '<token>' }
    * path 'api', 'park', 'check'
    * param lat = <lat>
    * param lng = <lng>
    * method get
    * status 200
    * match response == { inside: <inside> }

    Examples:
      | who               | token                     | lat     | lng      | inside |
      | a driver, inside  | Bearer driver:driver1     | 25.0768 | 121.5738 | true   |
      | a passenger, in   | Bearer passenger:passenger1 | 25.0768 | 121.5738 | true   |
      | a driver, outside | Bearer driver:driver1     | 25.0478 | 121.5170 | false  |
      | a passenger, out  | Bearer passenger:passenger1 | 25.0478 | 121.5170 | false  |

  Scenario Outline: bad coordinates are refused: <why>
    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * path 'api', 'park', 'check'
    * params <params>
    * method get
    * status 400
    * match response.error.code == 'invalid_location'

    Examples:
      | why           | params                    |
      | missing       | {}                        |
      | lng missing   | { lat: 25.07 }            |
      | not a number  | { lat: 'x', lng: 121.5 }  |
      | lat too large | { lat: 91, lng: 121.5 }   |
      | lng too large | { lat: 25, lng: 181 }     |

  Scenario: a park check needs a token
    * path 'api', 'park', 'check'
    * param lat = 25.0768
    * param lng = 121.5738
    * method get
    * status 401
