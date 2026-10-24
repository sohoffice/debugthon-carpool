import { useEffect, useState } from 'react'

/** Same window as ConfirmTextButton's (UD-17, UD-18). */
const CONFIRM_WINDOW_MS = 3000

interface DemoButtonProps {
  started: boolean
  running: boolean
  /** Shown under the button after a failed start or restart (UD-30 part 1). */
  error: string | null
  onStart: () => void
  onRestart: () => void
  /** False while the war room is shown: a pending confirm is dropped (UD-30 part 3). */
  visible: boolean
}

/**
 * UD-30 part 1: 開始 Demo takes one press, 重新開始 two within 3 s. Not ConfirmTextButton: the
 * first state needs no confirm, and while running it stays readable (aria-disabled, not disabled).
 */
export function DemoButton({ started, running, error, onStart, onRestart, visible }: DemoButtonProps) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [armed])
  useEffect(() => {
    if (!visible) setArmed(false)
  }, [visible])

  function press() {
    if (running) return
    if (!started) return onStart()
    if (!armed) return setArmed(true)
    setArmed(false)
    onRestart()
  }

  const label = running ? '執行中…' : armed ? '再按一次確定重新開始' : started ? '重新開始' : '開始 Demo'
  return (
    <>
      <button
        type="button"
        aria-disabled={running}
        onClick={press}
        className={`h-12 rounded-full px-7 text-lg font-semibold ring-2 ring-inset ring-rule ${armed ? 'text-danger' : 'text-ink-soft'} ${running ? 'cursor-default' : 'active:bg-paper'}`}
      >
        {label}
      </button>
      {/* Below the button so a long message never runs into the 乘客 sign. */}
      {error && !armed && (
        <span role="alert" className="absolute top-full right-0 mt-2 text-lg font-semibold whitespace-nowrap text-danger">
          {error}
        </span>
      )}
    </>
  )
}
