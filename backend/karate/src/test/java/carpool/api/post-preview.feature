@ignore
Feature: preview a route (arguments: user, pickupId, dest)

  Scenario:
    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * url baseUrl
    * path 'api', 'driver', 'route-preview'
    * request { pickup_point_id: '#(pickupId)', destination: { lat: '#(dest.lat)', lng: '#(dest.lng)' } }
    * method post
    * status 200
