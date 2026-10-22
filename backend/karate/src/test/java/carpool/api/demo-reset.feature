@api @demo
Feature: demo reset (POST /api/demo/reset)

  # DD-29. Needs the backend started with DEMO_RESET on, which `just backend up` does by default.
  # The reset swaps the demo accounts' data inside one transaction, so the scenarios reading the
  # seeded profile and defaults in parallel see either side of it, both the seed. To stay out of
  # other scenarios' cars, every request here requires a tag of its own that no car carries, so it
  # ends as no_match and holds no seat. Driver4 does not depart here (seeded.feature reads its
  # defaults); the Go test TestDemoReset covers that.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def other = 'karate-reset-passenger-' + suffix
    * def tagId = Db.queryLong("INSERT INTO tags (name, applies_to, driver_self_label, passenger_filter_label) VALUES (?, 'driver', 'karate', 'karate') RETURNING id", 'karate-reset-' + suffix)
    * Db.exec('INSERT INTO users (username, display_name, is_passenger) VALUES (?, ?, true)', other, other)
    * def afterAll = function() { Db.exec('DELETE FROM request_tag_filters WHERE tag_id = ?', tagId); Db.exec('DELETE FROM tags WHERE id = ?', tagId); karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: other }) }
    * configure afterScenario = afterAll
    * def doGet = function(token, path) { return karate.call('classpath:carpool/api/act-get.feature', { token: token, path: path }) }
    * def doPost = function(token, path) { return karate.call('classpath:carpool/api/act-post.feature', { token: token, path: path }) }
    * def pickups = doGet('passenger:passenger1', 'api/pickup-points').response
    * def pickup = karate.filter(pickups, function(p) { return p.name == '松山車站' })[0]
    * def stop = doGet('passenger:passenger1', 'api/bus-stops').response[0]
    * def body = { pickup_point_id: '#(pickup.id)', location: { lat: '#(pickup.lat)', lng: '#(pickup.lng)' }, destination: { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }, stop_ids: ['#(stop.id)'], tag_filters: [{ tag_id: '#(tagId)', intent: 'required' }] }
    * def submit = function(token) { return karate.call('classpath:carpool/api/submit-request.feature', { token: token, body: body }).response }

  Scenario: the reset needs no token and puts only the demo accounts back to the start
    # start from a reset, so a request left by an earlier demo cannot block passenger1's submission (REQ-069)
    * match doPost(null, 'api/demo/reset').responseStatus == 204

    * def mine = submit('passenger:passenger1')
    * match mine.status == 'no_match'
    * def theirs = submit('passenger:' + other)
    * match theirs.status == 'no_match'
    * def before = doGet('driver:driver1', 'api/driver/trips/current').response

    # no token, like the showcase page
    * path 'api', 'demo', 'reset'
    * method post
    * status 204

    # the demo passenger's request is gone; the non-demo passenger's stays
    * match doGet('passenger:passenger1', 'api/passenger/requests/' + mine.id).responseStatus == 404
    * match doGet('passenger:passenger1', 'api/passenger/requests/current').response == { request: null }
    * def kept = doGet('passenger:' + other, 'api/passenger/requests/' + theirs.id)
    * match kept.responseStatus == 200
    * match kept.response contains { id: '#(theirs.id)', status: 'no_match' }

    # the simulated trip starts again as a new trip with the same settings; the old one is ended
    * def after = doGet('driver:driver1', 'api/driver/trips/current')
    * match after.responseStatus == 200
    * match after.response contains { status: 'active', passed_pickup: false, seats_held: 0, seats_confirmed: 0, settings_locked: true }
    * match after.response contains { destination: '#(before.destination)', capacity: '#(before.capacity)', auto_accept: '#(before.auto_accept)' }
    * assert after.response.id != before.id
    * match doGet('driver:driver1', 'api/trips/' + before.id).response.status == 'cancelled'

    # habitual data is the seed (DD-19)
    * def profile = doGet('passenger:passenger1', 'api/passenger/profile').response
    * match profile.usual_destination == { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }
    * match profile.accepted_stops[*].stop_id contains only [1013, 1106]
    * match doGet('driver:driver4', 'api/driver/trips/defaults').response contains { pickup_point_id: '#(pickup.id)', destination: { name: '瑞光路 513 巷', lat: 25.0765, lng: 121.5742 }, capacity: 3, auto_accept: false }
    * match doGet('driver:driver4', 'api/driver/trips/current').responseStatus == 404
