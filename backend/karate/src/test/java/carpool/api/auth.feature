@api @auth
Feature: bearer token identification (DD-18)

  Background:
    * url baseUrl

  Scenario Outline: valid token <token>
    * path 'api', 'me'
    * header Authorization = 'Bearer ' + token
    * method get
    * status 200
    * match response == { username: '#string', display_name: '#string', role: '#string', roles: '#[1]', simulated: true }
    * match response.role == role

    Examples:
      | token                | role      |
      | driver:driver1       | driver    |
      | driver:driver5       | driver    |
      | passenger:passenger1 | passenger |
      | passenger:passenger2 | passenger |

  Scenario: ping needs no token
    * path 'api', 'ping'
    * method get
    * status 200
    * match response == { status: 'ok' }

  Scenario: rejected with 401 - missing header
    * path 'api', 'me'
    * method get
    * status 401
    * match response == { error: { code: 'unauthorized', message: '#string' } }

  Scenario Outline: rejected with 401 - <name>
    * path 'api', 'me'
    * header Authorization = header
    * method get
    * status 401
    * match response == { error: { code: 'unauthorized', message: '#string' } }

    Examples:
      | name             | header                  |
      | no Bearer prefix | driver:driver1          |
      | no colon         | Bearer driver1          |
      | unknown role     | Bearer admin:driver1    |
      | unknown account  | Bearer driver:nobody    |
      | empty account    | Bearer driver:          |

  Scenario Outline: rejected with 403 when the account lacks the role - <token>
    * path 'api', 'me'
    * header Authorization = 'Bearer ' + token
    * method get
    * status 403
    * match response == { error: { code: 'forbidden', message: '#string' } }

    Examples:
      | token                |
      | passenger:driver1    |
      | driver:passenger1    |
