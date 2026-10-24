import { accountUrl, DebugSheet } from '@carpool/shared'
import { account } from './config'

/** The demo driver accounts (UD-14): driver1-3 run seeded simulated trips, driver4 and driver5 depart from this UI. */
const DRIVER_ACCOUNTS = ['driver1', 'driver2', 'driver3', 'driver4', 'driver5']

/** `?debug=1` only (SC-X2): pick the main screen's driver. The simulator runs on the showcase (DD-14). */
export function DriverDebugMode() {
  return (
    <DebugSheet>
      <h2 className="mt-6 text-lg font-semibold text-ink-soft">主畫面的駕駛</h2>
      <div role="radiogroup" aria-label="主畫面的駕駛" className="mt-2 flex flex-wrap gap-2">
        {DRIVER_ACCOUNTS.map((name) => (
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
    </DebugSheet>
  )
}
