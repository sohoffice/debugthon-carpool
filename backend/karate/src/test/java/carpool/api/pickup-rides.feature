@api @commute
Feature: pickup-point rides (REQ-056, REQ-063, REQ-083, REQ-084, DD-37, DD-40, DD-41)

  # Like commute.feature, every scenario first regenerates the simulated data for today, as a reset
  # would (SQL: no API for it apart from the reset, which demo-reset.feature owns). The generator
  # takes a lock and, seeded by today's date, produces the same rows when run in parallel.

  Background:
    * url baseUrl
    * def Db = Java.type('carpool.api.Db')
    * Db.query('SELECT generate_commute_simulation(commute_now(now()))')
    * def pickupId = Db.queryLong('SELECT min(id) FROM pickup_points')
    * def slotShape = { slot_start: '#string', ride_count: '#number? _ >= 0', weather: '##object', simulated: '#boolean' }

  Scenario Outline: rides for the past 10 workdays and today - <token>
    * path 'api', 'commute', 'pickup-rides'
    * params { pickup_point_id: '#(pickupId)', from: '07:45', to: '08:45' }
    * header Authorization = 'Bearer <token>'
    * method get
    * status 200
    * match response contains { now: '#string', pickup_point_id: '#(pickupId)', simulated: true }
    * match response.days == '#[10]'
    * match each response.days contains { date: '#string', weekday: '#? _ >= 1 && _ <= 5', slots: '#[12]' }
    * match each response.days[0].slots == { slot_start: '#string', ride_count: '#number? _ >= 0', weather: '#object', simulated: true }
    * match response.today contains { date: '#string', weekday: '#number' }
    * match each response.today.slots == slotShape
    * match response.summary == { from: '07:45', to: '08:45', daily_avg: '#number', weekday: '#number', same_weekday_avg: '##number' }
    # drivers and passengers see rides only (DD-37)
    * match response !contains { driver_count: '#notnull' }
    * match each response.days[0].slots !contains { driver_count: '#notnull', passenger_count: '#notnull' }
    # the daily average is the 10 days' rides in 07:45-08:45 over 10
    * def inWindow = function(s) { var h = s.slot_start.substring(11, 16); return h >= '07:45' && h < '08:45' }
    * def total = 0
    * karate.forEach(response.days, function(d) { karate.forEach(d.slots, function(s) { if (inWindow(s)) total += s.ride_count }) })
    * match response.summary.daily_avg == total / 10

    Examples:
      | token                |
      | driver:driver1       |
      | passenger:passenger1 |

  Scenario: an unknown pickup point is not found
    * def missing = Db.queryLong('SELECT max(id) + 1000 FROM pickup_points')
    * path 'api', 'commute', 'pickup-rides'
    * params { pickup_point_id: '#(missing)', from: '07:45', to: '08:45' }
    * header Authorization = 'Bearer passenger:passenger1'
    * method get
    * status 404
    * match response.error.code == 'not_found'

  Scenario Outline: an invalid slot is refused - from <from> to <to>
    * path 'api', 'commute', 'pickup-rides'
    * params { pickup_point_id: '#(pickupId)', from: '<from>', to: '<to>' }
    * header Authorization = 'Bearer passenger:passenger1'
    * method get
    * status 400
    * match response.error.code == 'invalid_request'

    Examples:
      | from  | to    |
      | 08:45 | 07:45 |
      | 08:00 | 08:00 |
      | 06:45 | 08:00 |
      | 09:45 | 10:15 |
      | 07:50 | 08:30 |
      |       | 08:30 |
      | 7:45  | 08:30 |

  Scenario: an account without the role is refused
    * path 'api', 'commute', 'pickup-rides'
    * params { pickup_point_id: '#(pickupId)', from: '07:45', to: '08:45' }
    * header Authorization = 'Bearer driver:passenger1'
    * method get
    * status 403
    * match response.error.code == 'forbidden'

  Scenario: no token is refused
    * path 'api', 'commute', 'pickup-rides'
    * params { pickup_point_id: '#(pickupId)', from: '07:45', to: '08:45' }
    * method get
    * status 401
