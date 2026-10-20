import { accountUrl, DebugSheet, type LatLng } from '@carpool/shared'
import { account } from './config'
import { POSITION_PRESETS } from './position'

const ACCOUNTS = ['passenger1', 'passenger2']

interface PassengerDebugModeProps {
  presetId: string
  position: LatLng | null
  reporting: boolean
  onPreset: (id: string) => void
}

/** `?debug=1` only (DD-26): stands in for the phone's location in the PoC. */
export function PassengerDebugMode({ presetId, position, reporting, onPreset }: PassengerDebugModeProps) {
  return (
    <DebugSheet>
      <h2 className="mt-6 text-lg font-semibold text-ink-soft">目前位置</h2>
      <p className="mt-1 text-base text-ink-soft">送出請求時附上這個位置；參與後每 10 秒回報一次。換位置會立即用在下一次回報。</p>
      <div role="radiogroup" aria-label="目前位置" className="mt-3 flex flex-col">
        {POSITION_PRESETS.map((p) => {
          const on = p.id === presetId
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onPreset(p.id)} className="flex h-12 items-center gap-3 text-left text-lg">
              <span className={`size-5 rounded-full border-[3.5px] ${on ? 'border-brand bg-brand' : 'border-rule bg-white'}`} />
              <span className={on ? 'font-semibold' : ''}>{p.label}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-sm text-ink-soft tabular-nums">
        {position ? `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}` : '等上車點資料載入'} · {reporting ? '回報中' : '還沒參與，不回報'}
      </p>

      <h2 className="mt-8 text-lg font-semibold text-ink-soft">帳號</h2>
      <div className="mt-2 flex gap-2">
        {ACCOUNTS.map((name) => (
          <a
            key={name}
            href={accountUrl(name)}
            aria-current={name === account}
            className={`flex min-h-11 items-center rounded-full px-4 text-base font-medium ${name === account ? 'bg-brand text-white' : 'ring-1 ring-inset ring-rule'}`}
          >
            {name}
          </a>
        ))}
      </div>
    </DebugSheet>
  )
}
