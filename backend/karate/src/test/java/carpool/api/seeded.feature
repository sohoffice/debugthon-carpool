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
