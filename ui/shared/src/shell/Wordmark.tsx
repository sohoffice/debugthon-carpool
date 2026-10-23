/** App name with the route-strip symbol (pickup ring → line → destination square). */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-bold tracking-wide text-ink ${className}`}>
      <svg aria-hidden width="30" height="12" viewBox="0 0 30 12" className="text-brand">
        <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <rect x="10" y="4.75" width="12" height="2.5" fill="currentColor" />
        <rect x="21" y="1.5" width="9" height="9" rx="1" fill="currentColor" />
      </svg>
      內科上班順起來: 內科順路共乘
    </span>
  )
}
