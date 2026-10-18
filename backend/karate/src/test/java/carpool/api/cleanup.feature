@ignore
Feature: remove the accounts a profiles.feature scenario created (argument: suffix)

  Scenario:
    * def Db = Java.type('carpool.api.Db')
    * def name = function(prefix) { return prefix + suffix }
    # profiles and accepted stops cascade with the user
    * Db.exec('DELETE FROM users WHERE username = ANY (ARRAY[?, ?, ?])', name('karate-driver-'), name('karate-passenger-'), name('karate-dual-'))
