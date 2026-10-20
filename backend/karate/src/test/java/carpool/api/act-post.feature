@ignore
Feature: POST to an API path as someone (arguments: token, path)

  Scenario:
    * configure headers = token ? { Authorization: '#("Bearer " + token)' } : {}
    * url baseUrl
    * path path
    * method post
    * def responseStatus = responseStatus
