@api @route-preview
Feature: route preview (POST /api/driver/route-preview)

  # The departure at the end of the happy-path scenario creates an activity, so it uses its own
  # fresh karate-trip- driver like trips.feature; cleanup-tracking.feature ends its trip.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * def suffix = java.util.UUID.randomUUID().toString().substring(0, 8)
    * def user = 'karate-trip-driver-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true)', user, user)
    * configure afterScenario = function() { karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: user }) }
    * configure headers = { Authorization: '#("Bearer driver:" + user)' }
    * path 'api', 'pickup-points'
    * method get
    * def pickups = response
    * def pickup = response[0]
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def preview = function() { return karate.call('classpath:carpool/api/post-preview.feature', { user: user, pickupId: pickup.id, dest: inPark }).response }
    * def depart = function(body) { return karate.call('classpath:carpool/api/post-trip.feature', { body: body, user: user }) }

  Scenario: a preview returns an id and the route, and creates no trip
    * path 'api', 'driver', 'route-preview'
    * request { pickup_point_id: '#(pickup.id)', destination: { lat: '#(inPark.lat)', lng: '#(inPark.lng)' } }
    * method post
    * status 200
    * match response == { preview_id: '#number', route: { polyline: '#string', distance_m: '#number', duration_s: '#number', simulated: '#boolean', bus_stops: '#array' } }

    * path 'api', 'driver', 'trips', 'current'
    * method get
    * status 404
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response.pickup_point_id == null

  Scenario: departing with the preview id gives the previewed route and uses up the preview
    * def previewed = preview()
    # a different name for the same pickup point and destination is fine
    * def r = depart({ pickup_point_id: pickup.id, destination: { name: '另一個名稱', lat: 25.0768, lng: 121.5738 }, capacity: 3, auto_accept: true, preview_id: '#(previewed.preview_id)' })
    * match r.responseStatus == 201
    * match r.response.route == previewed.route
    # the preview is used: departing again with it is refused, and no trip is created
    * Db.exec("UPDATE trips SET status = 'completed', ended_at = now() WHERE status = 'active' AND driver_id = (SELECT id FROM users WHERE username = ?)", user)
    * def again = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: '#(previewed.preview_id)' })
    * match again.responseStatus == 400
    * match again.response.error.code == 'invalid_route_preview'
    * match Db.queryLong('SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id WHERE u.username = ?', user) == 1

  Scenario: the trip takes the stored preview, not a new plan
    * def previewed = preview()
    * Db.exec("UPDATE route_previews SET route_polyline = 'rewritten', route_distance_m = 4242 WHERE id = ?", previewed.preview_id)
    * def r = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: '#(previewed.preview_id)' })
    * match r.responseStatus == 201
    * match r.response.route contains { polyline: 'rewritten', distance_m: 4242 }

  Scenario: a failed departure leaves the preview usable
    * def previewed = preview()
    * def first = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true })
    * match first.responseStatus == 201
    * def blocked = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: '#(previewed.preview_id)' })
    * match blocked.responseStatus == 409
    * match blocked.response.error.code == 'already_active'
    * Db.exec("UPDATE trips SET status = 'completed', ended_at = now() WHERE status = 'active' AND driver_id = (SELECT id FROM users WHERE username = ?)", user)
    * def retry = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: '#(previewed.preview_id)' })
    * match retry.responseStatus == 201

  Scenario: departing without a preview id plans at departure
    * def r = depart({ pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true })
    * match r.responseStatus == 201
    * match r.response.route == { polyline: '#string', distance_m: '#number', duration_s: '#number', simulated: '#boolean', bus_stops: '#array' }

  Scenario Outline: a departure with an unusable preview is refused: <why>
    * def previewed = preview()
    * def other = 'karate-trip-other-' + suffix
    * Db.exec('INSERT INTO users (username, display_name, is_driver) VALUES (?, ?, true)', other, other)
    * def otherPickup = pickups.filter(function(p) { return p.id != pickup.id })[0]
    * def id = <id>
    * def who = <who>
    * def r = karate.call('classpath:carpool/api/post-trip.feature', { user: who, body: <body> })
    * match r.responseStatus == 400
    * match r.response.error.code == 'invalid_route_preview'
    * match Db.queryLong('SELECT count(*) FROM trips t JOIN users u ON u.id = t.driver_id WHERE u.username = ?', who) == 0
    * match Db.queryLong('SELECT count(*) FROM route_previews WHERE id = ? AND used_at IS NOT NULL', previewed.preview_id) == 0
    * karate.call('classpath:carpool/api/cleanup-tracking.feature', { user: other })

    Examples:
      | why                         | id                         | who   | body                                                                                                                                |
      | id does not exist           | 999999999                  | user  | { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: id }                                |
      | belongs to another driver   | previewed.preview_id       | other | { pickup_point_id: pickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: id }                                |
      | different pickup point      | previewed.preview_id       | user  | { pickup_point_id: otherPickup.id, destination: inPark, capacity: 3, auto_accept: true, preview_id: id }                           |
      | different destination       | previewed.preview_id       | user  | { pickup_point_id: pickup.id, destination: { name: 'x', lat: 25.0770, lng: 121.5738 }, capacity: 3, auto_accept: true, preview_id: id } |

  Scenario Outline: a preview is refused: <why>
    * path 'api', 'driver', 'route-preview'
    * request <body>
    * method post
    * status 400
    * match response.error.code == '<code>'

    Examples:
      | why                         | body                                                                       | code                     |
      | pickup point not in list    | { pickup_point_id: 99999999, destination: { lat: 25.0768, lng: 121.5738 } } | invalid_pickup_point     |
      | destination outside the park| { pickup_point_id: '#(pickup.id)', destination: { lat: 25.0478, lng: 121.5170 } }        | destination_outside_park |
      | destination missing         | { pickup_point_id: '#(pickup.id)' }                                                      | invalid_request          |

  Scenario: a passenger may not preview
    * configure headers = { Authorization: 'Bearer passenger:passenger1' }
    * path 'api', 'driver', 'route-preview'
    * request { pickup_point_id: '#(pickup.id)', destination: { lat: 25.0768, lng: 121.5738 } }
    * method post
    * status 403

  Scenario: a preview needs a token
    * configure headers = {}
    * path 'api', 'driver', 'route-preview'
    * request { pickup_point_id: '#(pickup.id)', destination: { lat: 25.0768, lng: 121.5738 } }
    * method post
    * status 401
