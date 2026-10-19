@ignore
Feature: depart (arguments: body, user)

  Scenario:
    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * url baseUrl
    * path 'api', 'driver', 'trips'
    * request body
    * method post
    * def responseStatus = responseStatus
