@ignore
Feature: tidy up after a requests.feature scenario (arguments: driver, passenger)

  # Requests and service records can go; the accounts have reported positions, so like
  # cleanup-tracking.feature they stay and their trip is ended.
  Scenario:
    * def Db = Java.type('carpool.api.Db')
    * Db.exec('DELETE FROM service_records WHERE passenger_id = (SELECT id FROM users WHERE username = ?)', passenger)
    * Db.exec('DELETE FROM ride_requests WHERE passenger_id = (SELECT id FROM users WHERE username = ?)', passenger)
    * Db.exec('DELETE FROM passenger_profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', passenger)
    * Db.exec('DELETE FROM driver_profiles WHERE user_id = (SELECT id FROM users WHERE username = ?)', driver)
    * Db.exec('DELETE FROM user_tags WHERE user_id = (SELECT id FROM users WHERE username = ?)', driver)
    * Db.exec("UPDATE trips SET status = 'completed', ended_at = now() WHERE status = 'active' AND driver_id = (SELECT id FROM users WHERE username = ?)", driver)
    * Db.exec('DELETE FROM users WHERE username = ANY (ARRAY[?, ?]) AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.user_id = users.id) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = users.id)', driver, passenger)
