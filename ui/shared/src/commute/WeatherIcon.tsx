import type { WeatherKind } from './slots'

const PATHS: Record<WeatherKind, React.ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </>
  ),
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.6 4.5 4.5 0 0 0 7 18.5Z" />,
  rain: (
    <>
      <path d="M7 14.5h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 5.6 4.5 4.5 0 0 0 7 14.5Z" />
      <path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" />
    </>
  ),
}

const NAMES: Record<WeatherKind, string> = { sun: '晴', cloud: '多雲', rain: '雨' }

/** Sun, cloud or rain (UD-25). Labelled, so a row's weather is read out with its date. */
export function WeatherIcon({ kind, className = '' }: { kind: WeatherKind; className?: string }) {
  return (
    <svg
      role="img"
      aria-label={NAMES[kind]}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[kind]}
    </svg>
  )
}
