import { useEffect, useState } from 'react'

function fit(width: number, height: number, margin: number): number {
  const available = Math.min((window.innerWidth - margin * 2) / width, (window.innerHeight - margin * 2) / height)
  return Math.min(1, Math.max(available, 0.1))
}

/** Scale (at most 1) that fits a fixed-size box into the window, so the phone never deforms (UD-13, UD-18). */
export function useFitScale(width: number, height: number, margin: number): number {
  const [scale, setScale] = useState(() => fit(width, height, margin))
  useEffect(() => {
    const update = () => setScale(fit(width, height, margin))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [width, height, margin])
  return scale
}
