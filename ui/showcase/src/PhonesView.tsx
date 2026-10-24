import { FRAME_HEIGHT, FRAME_WIDTH, PhoneFrame, SCREEN_HEIGHT, SCREEN_WIDTH, useFitScale } from '@carpool/shared'
import type { ReactNode } from 'react'
import { DRIVER_URL, PASSENGER_URL } from './config'

const GAP = 160
/** Columns either side of the phones for the title and the Demo button; they scale with the phones so nothing collides. */
const SIDE = 370
const LABEL = 64
const LABEL_GAP = 24
const MARGIN = 24
const LINE = 14
const LINE_OVERHANG = 2000

/**
 * The page title: ink lettering behind the line's white-bar mark, quieter than the two role signs (UD-23).
 * 22px keeps the full name on one line inside the side column.
 */
function Title() {
  return (
    <h1 className="m-0 flex h-16 items-center text-[22px] font-semibold whitespace-nowrap text-ink">
      <span aria-hidden className="mr-4 w-3.5 self-stretch bg-brand" />
      內科上班順起來: 內科順路共乘
    </h1>
  )
}

function Phone({ src, title, caption, reloadKey }: { src: string; title: string; caption: ReactNode; reloadKey: number }) {
  return (
    <figure className="m-0 flex flex-col" style={{ width: FRAME_WIDTH, gap: LABEL_GAP }}>
      <figcaption className="flex" style={{ height: LABEL }}>
        {caption}
      </figcaption>
      <PhoneFrame>
        {/* 1px past each edge: when scaled, an edge exactly on the frame's clip shows as a light hairline. */}
        <iframe key={reloadKey} src={src} title={title} width={SCREEN_WIDTH + 2} height={SCREEN_HEIGHT + 2} className="-m-px block border-0" />
      </PhoneFrame>
    </figure>
  )
}

/** Role names as phone-wide signs above each phone: 駕駛 a road sign, 乘客 a station sign (UD-21). */
const DRIVER_CAPTION = (
  <span className="flex flex-1 items-center justify-center rounded-sign bg-asphalt-plate text-[30px] font-semibold text-white outline-[3px] -outline-offset-[8px] outline-white">
    駕駛
  </span>
)
const PASSENGER_CAPTION = (
  <span className="flex flex-1 items-center bg-brand text-[30px] font-semibold text-white">
    <span aria-hidden className="mr-5 ml-6 w-3.5 self-stretch bg-white" />
    乘客
  </span>
)

/**
 * UD-18, UD-23: one light ground for both phones, with the carpool line running behind them at
 * mid-height: the two apps run independently in their frames and only meet through the backend.
 * Hidden, not unmounted, while the war room is shown, so both phones keep running (UD-30 part 3).
 */
export function PhonesView({ reloadKey, visible, control }: { reloadKey: number; visible: boolean; control: ReactNode }) {
  const width = SIDE * 2 + FRAME_WIDTH * 2 + GAP
  const height = LABEL + LABEL_GAP + FRAME_HEIGHT
  const scale = useFitScale(width, height, MARGIN)

  return (
    <main
      className={`flex h-dvh flex-col items-center justify-center overflow-hidden bg-paper ${visible ? '' : 'invisible'}`}
      inert={!visible}
      style={{ paddingBlock: MARGIN }}
    >
      <div className="shrink-0" style={{ width: width * scale, height: height * scale }}>
        <div className="relative flex" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {/* Past both page edges; main clips it. Same width as a station sign's white bar. */}
          <div aria-hidden className="absolute bg-brand" style={{ height: LINE, top: LABEL + LABEL_GAP + FRAME_HEIGHT / 2 - LINE / 2, left: -LINE_OVERHANG, right: -LINE_OVERHANG }} />
          <div style={{ width: SIDE }}>
            <Title />
          </div>
          <div className="relative flex flex-1 justify-between">
            <Phone src={DRIVER_URL} title="駕駛 App" caption={DRIVER_CAPTION} reloadKey={reloadKey} />
            <Phone src={PASSENGER_URL} title="乘客 App" caption={PASSENGER_CAPTION} reloadKey={reloadKey} />
          </div>
          <div className="relative flex h-16 items-center justify-end" style={{ width: SIDE }}>
            {control}
          </div>
        </div>
      </div>
      {/* Mirrors the label row so the phones, not phones-plus-labels, sit at the window's centre; gives way first when the window is short. */}
      <div aria-hidden className="min-h-0 shrink" style={{ height: (LABEL + LABEL_GAP) * scale }} />
    </main>
  )
}
