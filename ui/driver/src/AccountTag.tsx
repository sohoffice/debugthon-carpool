import type { DriverProfile } from '@carpool/shared'
import { useEffect, useState } from 'react'
import { account, api } from './config'
import { personName } from './driverName'

/**
 * Which driver this screen belongs to: "▌駕駛 名稱 ≡" (SC-D5). Tapping it opens the driver drawer
 * (DD-35); it sits only on screens with no running trip (DD-04). The name is the profile's; while it
 * loads or when it fails, the account stands in. Laid over the map unless placed by `className`.
 */
export function AccountTag({ onOpen, className = 'absolute top-[calc(var(--safe-top)+12px)] left-4' }: { onOpen: () => void; className?: string }) {
  const [name, setName] = useState(account)

  useEffect(() => {
    let current = true
    api.get<DriverProfile>('/driver/profile').then(
      (profile) => current && setName(personName(profile.display_name)),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [])

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`駕駛 ${name}，開啟駕駛資訊`}
      onClick={onOpen}
      className={`flex h-9 items-center gap-2 overflow-hidden rounded-[8px] bg-white pr-2.5 text-base font-semibold text-ink shadow-md shadow-asphalt/20 ${className}`}
    >
      <span aria-hidden className="h-full w-1.5 bg-asphalt" />
      駕駛 <span className="max-w-[10em] truncate font-medium text-ink-soft">{name}</span>
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="size-[18px] text-ink-soft">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  )
}
