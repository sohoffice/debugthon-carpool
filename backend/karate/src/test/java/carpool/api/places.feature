@api @places
Feature: place search (GET /api/places)

  Background:
    * url baseUrl

  Scenario Outline: part of the name or the address finds the place, for <token>
    * header Authorization = 'Bearer ' + token
    * path 'api', 'places'
    * param q = '<q>'
    * method get
    * status 200
    * match response contains { id: '#number', name: '仁寶電腦大樓', address: '台北市內湖區瑞光路581號', lat: '#number', lng: '#number' }
    * match each response contains { id: '#number', name: '#string', address: '#string', lat: '#number', lng: '#number' }

    Examples:
      | token                | q            |
      | driver:driver1       | 仁寶         |
      | passenger:passenger1 | 瑞光路581    |

  Scenario: at most 8 places come back
    * header Authorization = 'Bearer driver:driver1'
    * path 'api', 'places'
    # every seeded place has this in its address, and there are more than 8
    * param q = '台北市內湖區'
    * method get
    * status 200
    * assert response.length == 8

  Scenario: a keyword with no match gives an empty list
    * header Authorization = 'Bearer passenger:passenger1'
    * path 'api', 'places'
    * param q = 'no-such-place-xyz'
    * method get
    * status 200
    * match response == []

  Scenario: a missing or blank keyword is rejected
    * header Authorization = 'Bearer driver:driver1'
    * path 'api', 'places'
    * method get
    * status 400
    * match response.error.code == 'invalid_request'

    * header Authorization = 'Bearer driver:driver1'
    * path 'api', 'places'
    * param q = '  '
    * method get
    * status 400
    * match response.error.code == 'invalid_request'

  Scenario: a search needs a token
    * path 'api', 'places'
    * param q = '仁寶'
    * method get
    * status 401
