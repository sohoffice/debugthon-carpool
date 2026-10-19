@ignore
Feature: act on a request (arguments: token, role, id, action)

  Scenario:
    * configure headers = { Authorization: '#("Bearer " + token)' }
    * url baseUrl
    * path 'api', role, 'requests', id, action
    * method post
    * def responseStatus = responseStatus
