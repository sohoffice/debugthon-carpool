@api @reference
Feature: reference data and tags

  Background:
    * url baseUrl

  Scenario Outline: reference lists are readable by <token>
    * header Authorization = 'Bearer ' + token
    * path 'api', '<resource>'
    * method get
    * status 200
    * match response == '#[]'

    Examples:
      | token                | resource      |
      | driver:driver1       | pickup-points |
      | passenger:passenger1 | pickup-points |
      | driver:driver1       | bus-stops     |
      | passenger:passenger1 | bus-stops     |
      | driver:driver1       | tags          |
      | passenger:passenger1 | tags          |

  Scenario Outline: reference lists need a token - <resource>
    * path 'api', '<resource>'
    * method get
    * status 401
    * match response.error.code == 'unauthorized'

    Examples:
      | resource      |
      | pickup-points |
      | tags          |

  Scenario: tags can only be chosen from the list
    # a header set with `header` applies to one request only
    * configure headers = { Authorization: 'Bearer driver:driver1' }
    * path 'api', 'tags'
    * method get
    * status 200

    # unknown id is rejected
    * path 'api', 'me', 'tags', '99999999'
    * method put
    * status 404
    * match response.error.code == 'not_found'

    # malformed id is rejected
    * path 'api', 'me', 'tags', 'abc'
    * method put
    * status 400
    * match response.error.code == 'bad_request'

    # no route creates a tag
    * path 'api', 'tags'
    * request { name: 'free-text' }
    * method post
    * status 405
    * match response == { error: { code: 'method_not_allowed', message: '#string' } }

    * path 'api', 'tags'
    * method get
    * status 200
    # compare by name, not by count: other scenarios run in parallel
    * match response[*].name !contains 'free-text'
