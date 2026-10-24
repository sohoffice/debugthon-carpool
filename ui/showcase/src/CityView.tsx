import { useFitScale } from '@carpool/shared'
import { CITY_URL } from './config'

/** SC-C1's desktop layout. */
const CITY_WIDTH = 1440
const CITY_HEIGHT = 900
/** The paper bar under the war room that holds the speaker's tools. */
export const TOOL_BAR_HEIGHT = 44

/**
 * UD-30 part 3: the war room, embedded and loaded from the start. Scale = min(1, W ÷ 1440,
 * (H − 44) ÷ 900); the iframe is the space ÷ scale, so it always fills the width. Hidden, not
 * unmounted: it keeps polling and keeps the speaker's tab, date and time slot.
 */
export function CityView({ visible }: { visible: boolean }) {
  const scale = useFitScale(CITY_WIDTH, CITY_HEIGHT, 0, TOOL_BAR_HEIGHT)
  return (
    <div className={`fixed inset-0 z-10 flex flex-col bg-paper ${visible ? '' : 'invisible'}`} inert={!visible}>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <iframe
          src={CITY_URL}
          title="市府儀表板"
          className="absolute top-0 left-0 block origin-top-left border-0"
          style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }}
        />
      </div>
      <div aria-hidden className="shrink-0 bg-paper" style={{ height: TOOL_BAR_HEIGHT }} />
    </div>
  )
}
