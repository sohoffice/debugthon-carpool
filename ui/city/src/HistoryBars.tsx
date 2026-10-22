import { ErrorNote, WeatherIcon, weatherKind, type CityHistory, type CityToday } from '@carpool/shared'
import { monthDay, weekdayOf } from './format'
import { SectionTitle } from './SectionTitle'

interface HistoryBarsProps {
  history: CityHistory | undefined
  historyError: boolean
  today: CityToday | undefined
}

/** Rides per day over the past 10 workdays, oldest on the left, today last in board ink (REQ-082, UD-26). */
export function HistoryBars({ history, historyError, today }: HistoryBarsProps) {
  const days = history ? [...history.days].reverse() : []
  const max = Math.max(1, ...days.map((d) => d.rides), today?.completed ?? 0)
  const height = (n: number) => `${Math.max((n / max) * 100, 2)}%`
  return (
    <section aria-label="過去 10 個上班日的共乘數" className="flex min-h-0 min-w-0 flex-col gap-2 bg-white p-5">
      <SectionTitle mark={(history?.simulated || today?.simulated) && '含模擬'}>過去 10 個上班日的共乘數</SectionTitle>
      {historyError && <ErrorNote>歷史資料讀取失敗，顯示上一次的資料</ErrorNote>}
      <ol className="flex min-h-0 flex-1 items-end gap-2">
        {days.map((d) => (
          <li key={d.date} data-testid="history-day" className="flex h-full min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full flex-1 flex-col justify-end">
              <span className="text-center text-sm font-bold tabular-nums">{d.rides}</span>
              <div className="w-full rounded-t-[4px] bg-brand" style={{ height: height(d.rides) }} />
            </div>
            <span className="mt-1 text-sm tabular-nums">{monthDay(d.date)}</span>
            <span className="text-sm text-ink-soft">{weekdayOf(d.date)}</span>
            {d.weather ? (
              <span title={`${d.weather.weather} ${d.weather.air_temperature}°C`}>
                <WeatherIcon kind={weatherKind(d.weather.weather)} className="size-5 text-ink-soft" />
              </span>
            ) : (
              <span className="text-sm text-ink-soft">—</span>
            )}
          </li>
        ))}
        {today && history && (
          <li data-testid="history-today" className="flex h-full min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full flex-1 flex-col justify-end">
              <span className="text-center text-sm font-bold tabular-nums">{today.completed}</span>
              <div className="w-full rounded-t-[4px] bg-ink" style={{ height: height(today.completed) }} />
            </div>
            <span className="mt-1 text-sm font-bold">今天</span>
            <span className="text-sm text-ink-soft">{weekdayOf(today.today)}</span>
            <span className="size-5" />
          </li>
        )}
      </ol>
    </section>
  )
}
