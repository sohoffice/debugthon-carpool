@ignore
Feature: select one of my tags (arguments: token, id)

  Scenario:
    * configure headers = { Authorization: '#("Bearer " + token)' }
    * url baseUrl
    * path 'api', 'me', 'tags', id
    * method put
    * status 204
