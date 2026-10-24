import { useEffect } from 'react'
import { OFFSTAGE_POLL_MS } from './config'
import type { AddLog } from './log'
import { createOffstage, stageDrivers, type OnRequest } from './offstage'

/** Runs the off-stage rounds (DD-45 steps 2-4) every second while the Demo is started; one at a time. */
export function useOffstage(running: boolean, log: AddLog, onRequest: OnRequest) {
  useEffect(() => {
    if (!running) return
    const tick = createOffstage(stageDrivers(), log, onRequest)
    let busy = false
    const timer = setInterval(() => {
      if (busy) return
      busy = true
      tick().finally(() => {
        busy = false
      })
    }, OFFSTAGE_POLL_MS)
    return () => clearInterval(timer)
  }, [running, log, onRequest])
}
