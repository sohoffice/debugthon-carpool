import { Wordmark } from '@carpool/shared'
import { useEffect, useRef } from 'react'

const SHOW_MS = 5000
const SWIPE_UP_PX = 24

/**
 * UD-12: a phone-style notification slides down when a car is matched, and goes away after about
 * 5 seconds, on a tap, or on a swipe up. Simulated: the PoC never pushes (DD-03). No sound.
 */
export function MatchNotification({ text, onClose }: { text: string; onClose: () => void }) {
  const startY = useRef<number | null>(null)
  useEffect(() => {
    const timer = setTimeout(onClose, SHOW_MS)
    return () => clearTimeout(timer)
  }, [onClose])
  return (
    <div className="absolute inset-x-2 top-[calc(var(--safe-top)+4px)] z-30">
      <button
        type="button"
        role="status"
        onClick={onClose}
        onPointerDown={(e) => (startY.current = e.clientY)}
        onPointerUp={(e) => startY.current !== null && startY.current - e.clientY > SWIPE_UP_PX && onClose()}
        className="notification-in w-full rounded-[22px] bg-white/90 px-4 py-3 text-left shadow-xl shadow-ink/20 ring-1 ring-ink/5 backdrop-blur"
      >
        <span className="flex items-center justify-between text-sm text-ink-soft">
          <Wordmark className="text-sm" />
          <span>現在</span>
        </span>
        <span className="mt-1 block text-base font-bold">配到車了</span>
        <span className="block text-base">{text}</span>
      </button>
    </div>
  )
}
