import type { CSSProperties, ReactNode } from 'react'
import { HOME_INDICATOR_HEIGHT, STATUS_BAR_HEIGHT } from './device'
import { HomeIndicator, StatusBar, type StatusBarTone } from './StatusBar'

interface PhoneScreenProps {
  /** Draw our own status bar and gesture bar (framed or embedded); a real phone has its own. */
  simulateSystemBars: boolean
  tone: StatusBarTone
  className?: string
  children: ReactNode
}

/**
 * The app's screen. Exposes `--safe-top` / `--safe-bottom` so screens clear the status bar and
 * gesture bar in every mode (use e.g. `pt-(--safe-top)`). It is the containing block for
 * absolutely positioned bottom bars, sheets and notifications, so they align with the phone
 * screen and not the browser window (UD-13).
 */
export function PhoneScreen({ simulateSystemBars, tone, className = '', children }: PhoneScreenProps) {
  const insets = simulateSystemBars
    ? { '--safe-top': `${STATUS_BAR_HEIGHT}px`, '--safe-bottom': `${HOME_INDICATOR_HEIGHT}px` }
    : { '--safe-top': 'env(safe-area-inset-top, 0px)', '--safe-bottom': 'env(safe-area-inset-bottom, 0px)' }
  return (
    <div className={`relative overflow-hidden ${className}`} style={insets as CSSProperties}>
      {children}
      {simulateSystemBars && <StatusBar tone={tone} />}
      {simulateSystemBars && <HomeIndicator tone={tone} />}
    </div>
  )
}
