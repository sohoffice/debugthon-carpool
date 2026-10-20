import type { ReactNode } from 'react'

/** Short error with a red rule on the left; the screen keeps showing the last good data (8.3). */
export function ErrorNote({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  const text = tone === 'light' ? 'text-danger' : 'text-white'
  return (
    <p role="alert" className={`border-l-4 border-danger py-1 pl-3 text-base font-medium ${text}`}>
      {children}
    </p>
  )
}
