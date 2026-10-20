@ignore
Feature: submit a ride request as someone (arguments: token, body)

  Scenario:
    * configure headers = { Authorization: '#("Bearer " + token)' }
    * url baseUrl
    * path 'api', 'passenger', 'requests'
    * request body
    * method post
    * status 201
