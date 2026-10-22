import { account } from './config'

/** Which demo account this screen belongs to, laid over the map (6.1). */
export function AccountTag() {
  return (
    <p className="absolute top-[calc(var(--safe-top)+12px)] left-4 flex h-9 items-center gap-2 overflow-hidden rounded-[8px] bg-white pr-3 text-base font-semibold text-ink shadow-md shadow-asphalt/20">
      <span aria-hidden className="h-full w-1.5 bg-asphalt" />
      駕駛 <span className="font-medium text-ink-soft">{account}</span>
    </p>
  )
}
