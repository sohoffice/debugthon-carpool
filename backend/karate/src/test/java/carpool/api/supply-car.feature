@ignore
Feature: put one car on the road (arguments: user, pickup, body, tagIds, northM)

  # A fresh driver (or one the caller already created) selects tags, departs through the API and reports a position northM metres
  # north of the pickup point. Returns tripId.
  Scenario:
    * def Db = Java.type('carpool.api.Db')
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true) ON CONFLICT (username) DO NOTHING', user, user)
    * def token = 'driver:' + user
    * karate.forEach(tagIds, function(id) { karate.call('classpath:carpool/api/put-tag.feature', { token: token, id: id }) })
    * def depart = karate.call('classpath:carpool/api/post-trip.feature', { body: body, user: user })
    * match depart.responseStatus == 201
    * def tripId = depart.response.id
    * karate.call('classpath:carpool/api/post-location.feature', { token: token, lat: pickup.lat + northM * 0.000009, lng: pickup.lng })
