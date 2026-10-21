@ignore
Feature: list the pickup points

  Scenario:
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * url baseUrl
    * path 'api', 'pickup-points'
    * method get
    * status 200
