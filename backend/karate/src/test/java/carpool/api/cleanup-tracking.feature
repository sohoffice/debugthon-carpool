@ignore
Feature: tidy up after a tracking scenario (argument: user)

  # location_reports is append-only (DD-06) and hangs off activities, which reference users
  # without cascade, so an account that has taken part can never be deleted. Such accounts stay,
  # but their trip is ended so no later supply query sees it; an account that never took part
  # is removed.
  Scenario:
    * def Db = Java.type('carpool.api.Db')
    * Db.exec("UPDATE trips SET status = 'completed', ended_at = now() WHERE status = 'active' AND driver_id = (SELECT id FROM users WHERE username = ?)", user)
    * Db.exec('DELETE FROM users WHERE username = ? AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.user_id = users.id) AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = users.id)', user)
