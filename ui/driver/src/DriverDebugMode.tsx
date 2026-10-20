import { accountUrl, Button, DebugSheet } from '@carpool/shared'
import { useState } from 'react'
import { account } from './config'
import { SIMULATOR_ROUTES } from './simulatorRoutes'
import { SIMULATED_ACCOUNTS, useSimulator, type SimulatorStatus } from './useSimulator'

function statusText(status: SimulatorStatus | undefined): string {
  if (!status) return '未啟動'
  if (status.kind === 'waiting') return '確認行程中…'
  if (status.kind === 'no_trip') return '沒有進行中的行程'
  if (status.kind === 'moving') return `移動中 ${Math.round(status.progress * 100)}%`
  if (status.kind === 'arrived') return '已到路徑終點'
  return `錯誤：${status.message}`
}

/** `?debug=1` only (DD-14): pick the main screen's driver and run the simulator for any drivers. */
export function DriverDebugMode() {
  const [selected, setSelected] = useState<string[]>(SIMULATED_ACCOUNTS)
  const [running, setRunning] = useState(false)
  const statuses = useSimulator(selected, running)
  const toggle = (name: string) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))

  return (
    <DebugSheet>
      <h2 className="mt-6 text-lg font-semibold text-ink-soft">主畫面的駕駛</h2>
      <div role="radiogroup" aria-label="主畫面的駕駛" className="mt-2 flex flex-wrap gap-2">
        {SIMULATED_ACCOUNTS.map((name) => (
          <a
            key={name}
            role="radio"
            aria-checked={name === account}
            href={accountUrl(name)}
            className={`flex min-h-11 items-center rounded-full px-4 text-base font-medium ${name === account ? 'bg-brand text-white' : 'ring-1 ring-inset ring-rule'}`}
          >
            {name}
          </a>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-soft">模擬器</h2>
      <p className="mt-1 text-base text-ink-soft">
        勾選的駕駛有進行中的行程時，沿預先定義的路徑回報位置，到終點就停止。分頁在背景也會繼續移動；重新整理後要再按開始，從起點重來。
      </p>
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {SIMULATED_ACCOUNTS.map((name) => (
          <li key={name} className="flex min-h-14 items-center gap-3">
            <label className="flex flex-1 items-center gap-3 text-lg">
              <input
                type="checkbox"
                className="size-5 accent-(--color-brand)"
                checked={selected.includes(name)}
                disabled={running}
                onChange={() => toggle(name)}
              />
              <span className="font-semibold">{name}</span>
              <span className="text-sm text-ink-soft">{SIMULATOR_ROUTES[name].speedKmh} km/h</span>
            </label>
            <span className="text-right text-sm text-ink-soft" aria-live="polite">
              {selected.includes(name) ? statusText(statuses[name]) : '不模擬'}
            </span>
          </li>
        ))}
      </ul>
      <Button className="mt-6 w-full" variant={running ? 'secondary' : 'primary'} onClick={() => setRunning((r) => !r)}>
        {running ? '停止模擬' : '開始模擬'}
      </Button>
    </DebugSheet>
  )
}
