@ignore
Feature: send one position report (arguments: token, lat, lng)

  Scenario:
    * configure headers = { Authorization: '#("Bearer " + token)' }
    * url baseUrl
    * path 'api', 'location'
    * request { lat: '#(lat)', lng: '#(lng)' }
    * method post
