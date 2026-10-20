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
    * def pickup = response[0]
    * def inPark = { name: '瑞光路 內科大樓 A', lat: 25.0768, lng: 121.5738 }
    * def depart = function(body) { return karate.call('classpath:carpool/api/post-trip.feature', { body: body, user: user }) }

  Scenario: a preview creates no trip and the departure that follows has the same route and bus stops
    * path 'api', 'driver', 'route-preview'
    * request { pickup_point_id: '#(pickup.id)', destination: { lat: '#(inPark.lat)', lng: '#(inPark.lng)' } }
    * method post
    * status 200
    * match response.route == { polyline: '#string', distance_m: '#number', duration_s: '#number', simulated: '#boolean', bus_stops: '#array' }
    * def previewed = response.route

    # no trip was created
    * path 'api', 'driver', 'trips', 'current'
    * method get
    * status 404
    * path 'api', 'driver', 'trips', 'defaults'
    * method get
    * status 200
    * match response.pickup_point_id == null

    # a different name for the same pickup point and destination still uses the preview
    * def r = depart({ pickup_point_id: pickup.id, destination: { name: '另一個名稱', lat: 25.0768, lng: 121.5738 }, capacity: 3, auto_accept: true })
    * match r.responseStatus == 201
    * assert previewed.bus_stops.length > 0
    * match r.response.route == previewed

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
