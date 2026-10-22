import { ConfirmTextButton, FRAME_HEIGHT, FRAME_WIDTH, PhoneFrame, SCREEN_HEIGHT, SCREEN_WIDTH, useFitScale } from '@carpool/shared'
import { useState, type ReactNode } from 'react'
import { DRIVER_URL, PASSENGER_URL } from './config'

const GAP = 160
const HEADER = 120
const CAPTION = 88
const MARGIN = 24

/** The page title as a station sign: the line-colour band with its white bar (UD-23). */
function TitleSign() {
  return (
    <h1 className="flex h-16 items-center bg-brand pr-7 text-[34px] font-semibold text-white">
      <span aria-hidden className="ml-5 w-3.5 self-stretch bg-white" />
      <span className="ml-4">內科順路共乘</span>
    </h1>
  )
}

function Phone({ src, title, caption, reloadKey }: { src: string; title: string; caption: ReactNode; reloadKey: number }) {
  return (
    <figure className="m-0 flex flex-col items-center">
      <PhoneFrame>
        {/* 1px past each edge: when scaled, an edge exactly on the frame's clip shows as a light hairline. */}
        <iframe key={reloadKey} src={src} title={title} width={SCREEN_WIDTH + 2} height={SCREEN_HEIGHT + 2} className="-m-px block border-0" />
      </PhoneFrame>
      <figcaption className="mt-7">{caption}</figcaption>
    </figure>
  )
}

/** 駕駛 as a road sign on the asphalt half, 乘客 as a station sign on the white half. */
const DRIVER_CAPTION = (
  <span className="flex h-14 items-center rounded-[12px] bg-asphalt-plate px-9 text-2xl font-semibold text-white outline-[3px] -outline-offset-[7px] outline-white">駕駛</span>
)
const PASSENGER_CAPTION = (
  <span className="flex h-14 items-center bg-brand pr-9 text-2xl font-semibold text-white">
    <span aria-hidden className="mr-4 ml-5 w-3 self-stretch bg-white" />
    乘客
  </span>
)

/**
 * UD-18, UD-23: the one page shown during the demo and the live stream. Asphalt behind the driver,
 * the white station wall behind the passenger; the two apps run independently in their frames and
 * only affect each other through the backend.
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
    <main className="relative flex h-dvh items-center justify-center overflow-hidden bg-[linear-gradient(90deg,var(--color-asphalt)_50%,var(--color-white)_50%)]">
      <div className="absolute top-12 left-24">
        <TitleSign />
      </div>
      <div className="absolute top-12 right-24 flex h-16 items-center gap-4">
        {error && (
          <span role="alert" className="text-lg font-semibold text-danger">
            {error}
          </span>
        )}
        <ConfirmTextButton
          label="重設"
          confirmLabel="再按一次確定重設"
          onConfirm={reset}
          className="h-12 rounded-full px-7 text-lg ring-2 ring-inset ring-rule active:bg-paper"
        />
      </div>
      <div style={{ width: width * scale, height: height * scale }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div className="flex justify-between" style={{ paddingTop: HEADER }}>
            <Phone src={DRIVER_URL} title="駕駛 App" caption={DRIVER_CAPTION} reloadKey={reloadKey} />
            <Phone src={PASSENGER_URL} title="乘客 App" caption={PASSENGER_CAPTION} reloadKey={reloadKey} />
          </div>
        </div>
      </div>
    </main>
  )
}
