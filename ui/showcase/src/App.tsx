import { ConfirmTextButton, FRAME_HEIGHT, FRAME_WIDTH, PhoneFrame, SCREEN_HEIGHT, SCREEN_WIDTH, useFitScale, Wordmark } from '@carpool/shared'
import { useState } from 'react'
import { DRIVER_URL, PASSENGER_URL } from './config'

const GAP = 160
const HEADER = 96
const CAPTION = 64
const MARGIN = 24

function Phone({ src, title, label, reloadKey }: { src: string; title: string; label: string; reloadKey: number }) {
  return (
    <figure className="flex flex-col items-center">
      <PhoneFrame>
        {/* 1px past each edge: when scaled, an edge exactly on the frame's clip shows as a light hairline. */}
        <iframe key={reloadKey} src={src} title={title} width={SCREEN_WIDTH + 2} height={SCREEN_HEIGHT + 2} className="-m-px block border-0" />
      </PhoneFrame>
      <figcaption className="mt-5 text-xl font-semibold tracking-wide text-ink-soft">{label}</figcaption>
    </figure>
  )
}

/**
 * UD-18: the one page shown during the demo and the live stream. The two apps run independently
 * in their frames and only affect each other through the backend.
 */
export function App() {
  const width = FRAME_WIDTH * 2 + GAP
  const height = HEADER + FRAME_HEIGHT + CAPTION
  const scale = useFitScale(width, height, MARGIN)
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setError(null)
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      setReloadKey((k) => k + 1)
    } catch {
      setError('重設失敗，請確認後端有在執行。')
    }
  }

  return (
    <main className="flex h-dvh items-center justify-center overflow-hidden bg-paper">
      <div style={{ width: width * scale, height: height * scale }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <header className="flex items-center justify-between" style={{ height: HEADER }}>
            <Wordmark className="text-[28px]" />
            <span className="flex items-center gap-4">
              {error && <span role="alert" className="text-lg font-medium text-danger">{error}</span>}
              <ConfirmTextButton
                label="重設"
                confirmLabel="再按一次確定重設"
                onConfirm={reset}
                className="h-12 rounded-control bg-white px-6 text-lg ring-1 ring-inset ring-rule"
              />
            </span>
          </header>
          <div className="flex justify-between">
            <Phone src={DRIVER_URL} title="駕駛 App" label="駕駛" reloadKey={reloadKey} />
            <Phone src={PASSENGER_URL} title="乘客 App" label="乘客" reloadKey={reloadKey} />
          </div>
        </div>
      </div>
    </main>
  )
}
