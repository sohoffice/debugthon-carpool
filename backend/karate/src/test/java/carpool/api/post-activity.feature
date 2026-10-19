@ignore
Feature: declare taking part today (argument: token)

  Scenario:
    * configure headers = { Authorization: '#("Bearer " + token)' }
    * url baseUrl
    * path 'api', 'activities'
    * method post
    * status 201
