import { useCallback, useEffect, useRef, useState } from 'react'
import { FAST_FORWARD } from './config'
import { createSimulator, SEEDED_TRIP_ACCOUNTS, type SimulatorEngine, type SimulatorStatus } from './simulator'

export { SEEDED_TRIP_ACCOUNTS, SIMULATED_ACCOUNTS, TRIP_CHECK_MS, type SimulatorStatus } from './simulator'

/** The simulator's statuses, and `release` for a request seen elsewhere (the off-stage decline, DD-45). */
export interface Simulator {
  statuses: Record<string, SimulatorStatus>
  release: (account: string, tripId: number) => void
}

/**
 * The showcase's simulator (DD-14, T08), run from 開始 Demo (DD-45): a thin wrapper that starts the
 * engine in ./simulator while `running` and keeps its statuses in state. It confirms for the seeded
 * trips (DD-33). Stopping forgets every track; the next start begins at each path's start again.
 */
export function useSimulator(accounts: string[], running: boolean, fastForward = FAST_FORWARD): Simulator {
  const [statuses, setStatuses] = useState<Record<string, SimulatorStatus>>({})
  const engine = useRef<SimulatorEngine | null>(null)
  const key = accounts.join(',')

  const release = useCallback((account: string, tripId: number) => engine.current?.release(account, tripId), [])

  useEffect(() => {
    if (!running) {
      setStatuses({})
      return
    }
    const sim = createSimulator({
      accounts,
      fastForward,
      confirmFor: SEEDED_TRIP_ACCOUNTS,
      onStatus: (name, status) => setStatuses((s) => ({ ...s, [name]: status })),
    })
    engine.current = sim
    sim.start()
    return () => {
      sim.stop()
      if (engine.current === sim) engine.current = null
    }
    // `key` stands for the account list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, key, fastForward])

  return { statuses, release }
}
