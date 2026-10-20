@api @seeded
Feature: tag selection and seeded reference data

  # Relies on the seeded tags, pickup points and bus stops. State is changed only through the
  # REST API, and each scenario puts it back as it found it.

  Background:
    * url baseUrl

  Scenario Outline: select and deselect a tag from the list - <token>
    # Pick a tag that neither user has selected, so ending deselected restores the seeded state
    # and the "other user" check cannot be affected by seed selections. The rows run in
    # parallel, so each takes tags from its own half of the list (by position parity).
    * configure headers = { Authorization: 'Bearer <token>' }
    * path 'api', 'tags'
    * method get
    * status 200
    * def mine = response
    * configure headers = { Authorization: 'Bearer <other>' }
    * path 'api', 'tags'
    * method get
    * status 200
    * def theirs = response
    * def pick =
      """
      function(mine, theirs, parity) {
        for (var i = parity; i < mine.length; i += 2) {
          if (!mine[i].selected && !theirs[i].selected) return mine[i].id;
        }
        return null;
      }
      """
    * def tagId = pick(mine, theirs, <parity>)
    * assert tagId != null
    * configure headers = { Authorization: 'Bearer <token>' }

    * path 'api', 'tags'
    * method get
    * match response contains deep { id: '#(tagId)', issuer: 'self', selected: false }

    # select twice: both succeed
    * path 'api', 'me', 'tags', tagId
    * method put
    * status 204
    * path 'api', 'me', 'tags', tagId
    * method put
    * status 204

    * path 'api', 'tags'
    * method get
    * match response contains deep { id: '#(tagId)', selected: true }

    # the selection belongs to the caller only
    * configure headers = { Authorization: 'Bearer <other>' }
    * path 'api', 'tags'
    * method get
    * match response contains deep { id: '#(tagId)', selected: false }

    # deselect twice: both succeed
    * configure headers = { Authorization: 'Bearer <token>' }
    * path 'api', 'me', 'tags', tagId
    * method delete
    * status 204
    * path 'api', 'me', 'tags', tagId
    * method delete
    * status 204

    * path 'api', 'tags'
    * method get
    * match response contains deep { id: '#(tagId)', selected: false }

    Examples:
      | token                | other                | parity |
      | driver:driver1       | passenger:passenger1 | 0      |
      | passenger:passenger1 | driver:driver1       | 1      |

  Scenario: pickup points and bus stops are listed from the seed data
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }

    * path 'api', 'pickup-points'
    * method get
    * status 200
    * assert response.length > 0
    * match each response == { id: '#number', name: '#string', lat: '#number', lng: '#number', radius_m: '#number' }

    * path 'api', 'bus-stops'
    * method get
    * status 200
    * assert response.length > 0
    * match each response == { id: '#number', stop_id: '##number', name: '#string', lat: '#number', lng: '#number' }

  # The Demo pre-filled data (DD-19, REQ-016, REQ-025). A manual demo changes it, so these two
  # scenarios expect a database just after `just backend db-reset` or `just demo-reset`.
  Scenario: passenger1 starts with the seeded usual destination and accepted stops
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'passenger', 'profile'
    * method get
    * status 200
    * match response.usual_arrival_time == null
    * match response.usual_destination == { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
    * match response.accepted_stops[*].stop_id contains only [1013, 1106]

  Scenario: passenger2 and driver5 start with nothing
    * configure headers = { Authorization: 'Bearer passenger:passenger2' }
    * path 'api', 'passenger', 'profile'
    * method get
    * status 200
    * match response == { usual_arrival_time: null, usual_destination: null, accepted_stops: [] }

    * configure headers = { Authorization: 'Bearer driver:driver5' }
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response == { pickup_point_id: null, destination: null, capacity: null, auto_accept: false, tag_filters: [] }

  Scenario: driver4's defaults are the seeded ended trip
    * configure headers = { Authorization: 'Bearer driver:driver4' }
    * path 'api', 'pickup-points'
    * method get
    * def pickup = karate.filter(response, function(p) { return p.name == '松山車站' })[0]
    * path 'api', 'tags'
    * method get
    * def tag = karate.filter(response, function(g) { return g.name == '不抽菸' })[0]

    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response == { pickup_point_id: '#(pickup.id)', destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }, capacity: 3, auto_accept: false, tag_filters: [{ tag_id: '#(tag.id)', intent: 'preferred' }] }

    # the seeded trip is over: nothing is running
    * path 'api', 'driver', 'trips', 'current'
    * method get
    * status 404

  Scenario Outline: the profile endpoints refuse the wrong role and no token
    * url baseUrl + '/<path>'
    * method get
    * status 401
    * configure headers = { Authorization: 'Bearer <token>' }
    * method get
    * status 403

    Examples:
      | path                       | token                |
      | api/passenger/profile      | driver:driver4       |
      | api/driver/trips/defaults  | passenger:passenger1 |
