import type { ReactNode } from 'react'
import { FRAME_HEIGHT, FRAME_WIDTH } from './device'
import { PhoneFrame } from './PhoneFrame'
import { PhoneScreen } from './PhoneScreen'
import type { StatusBarTone } from './StatusBar'
import { useFitScale } from './useFitScale'
import { useShellMode } from './useShellMode'
import { Wordmark } from './Wordmark'

const PAGE_MARGIN = 32
const CAPTION_SPACE = 56

interface PhoneShellProps {
  /** Shown under the phone on desktop, e.g. 駕駛. */
  roleLabel: string
  /** Status bar text colour for the current screen. */
  tone: StatusBarTone
  children: ReactNode
}

/**
 * Wraps an app so it looks like a phone app: full screen on a phone, inside a phone frame on a
 * desktop browser, screen only when the showcase page embeds it (UD-11, UD-13).
 */
export function PhoneShell({ roleLabel, tone, children }: PhoneShellProps) {
  const mode = useShellMode()
  const scale = useFitScale(FRAME_WIDTH, FRAME_HEIGHT + CAPTION_SPACE, PAGE_MARGIN)

  if (mode !== 'framed') {
    return (
      <PhoneScreen simulateSystemBars={mode === 'embed'} tone={tone} className="h-dvh w-full">
        {children}
      </PhoneScreen>
    )
  }

  return (
    <div className="relative flex h-dvh flex-col items-center justify-center overflow-hidden bg-paper">
      <Wordmark className="absolute top-6 left-8 text-lg" />
      <div style={{ width: FRAME_WIDTH * scale, height: FRAME_HEIGHT * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <PhoneFrame>
            <PhoneScreen simulateSystemBars tone={tone} className="h-full w-full">
              {children}
            </PhoneScreen>
          </PhoneFrame>
        </div>
      </div>
      <p className="mt-5 text-base font-semibold tracking-wide text-ink-soft">{roleLabel}</p>
    </div>
  )
}
