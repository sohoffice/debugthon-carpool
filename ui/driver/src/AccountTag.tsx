import { account } from './config'

/**
 * Which demo account this screen belongs to (6.1). Tapping it opens the driver drawer (DD-35); it
 * sits only on screens with no running trip (DD-04). Laid over the map unless placed by `className`.
 */
export function AccountTag({ onOpen, className = 'absolute top-[calc(var(--safe-top)+12px)] left-4' }: { onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`駕駛 ${account}，開啟駕駛資訊`}
      onClick={onOpen}
      className={`flex h-9 items-center gap-2 overflow-hidden rounded-[8px] bg-white pr-3 text-base font-semibold text-ink shadow-md shadow-asphalt/20 ${className}`}
    >
      <span aria-hidden className="h-full w-1.5 bg-asphalt" />
      駕駛 <span className="font-medium text-ink-soft">{account}</span>
      <span aria-hidden className="text-ink-soft">›</span>
    </button>
  )
}
