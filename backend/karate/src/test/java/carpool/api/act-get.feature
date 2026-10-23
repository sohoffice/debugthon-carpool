@ignore
Feature: GET an API path as someone (arguments: token, path, optional query)

  Scenario:
    * configure headers = token ? { Authorization: '#("Bearer " + token)' } : {}
    * url baseUrl
    * path path
    * params karate.get('query', {})
    * method get
    * def responseStatus = responseStatus
