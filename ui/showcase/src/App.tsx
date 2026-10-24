import { useState } from 'react'
import { CityView } from './CityView'
import { DemoButton } from './DemoButton'
import { prepareStart, restart } from './demoControl'
import { useLog } from './log'
import { PhonesView } from './PhonesView'
import { SpeakerTools } from './SpeakerTools'
import { useOffstage } from './useOffstage'
import { SIMULATED_ACCOUNTS, useSimulator } from './useSimulator'
import type { View } from './ViewSwitch'

const START_FAILED = '開始失敗，請確認後端有在執行。'
const RESTART_FAILED = '重新開始失敗，請確認後端有在執行。'

/**
 * SC-X1, the one page shown during the demo and the live stream (UD-18, UD-30). It is also the
 * Demo's engine (DD-14, DD-45): 開始 Demo starts the simulator and the off-stage part, which run
 * here until the page is reloaded, whichever view is shown.
 */
export function App() {
  const log = useLog()
  const [view, setView] = useState<View>('phones')
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const simulator = useSimulator(SIMULATED_ACCOUNTS, started)
  // The off-stage part sees driver5's request before declining it; the simulator may not (T63).
  useOffstage(started, log.add, simulator.release)

  async function start() {
    setError(null)
    setRunning(true)
    try {
      await prepareStart(log.add)
      setStarted(true)
      log.add('模擬器開始了')
      setReloadKey((k) => k + 1)
    } catch {
      setError(START_FAILED)
    } finally {
      setRunning(false)
    }
  }

  async function restartDemo() {
    setError(null)
    setRunning(true)
    try {
      await restart(log.add)
      // The phones only: the war room catches up by its own polling (UD-30 part 3).
      setReloadKey((k) => k + 1)
    } catch {
      setError(RESTART_FAILED)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <PhonesView
        reloadKey={reloadKey}
        visible={view === 'phones'}
        control={<DemoButton started={started} running={running} error={error} onStart={start} onRestart={restartDemo} visible={view === 'phones'} />}
      />
      <CityView visible={view === 'city'} />
      <SpeakerTools view={view} onView={setView} entries={log.entries} open={log.open} unseenError={log.unseenError} onOpen={log.show} onClose={log.hide} />
    </>
  )
}
