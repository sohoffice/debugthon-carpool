import { ErrorNote, type CityHistory, type CityLive, type CityToday } from '@carpool/shared'
import { oneDecimal } from './format'
import { pickupRows } from './pickupRows'
import { SectionTitle } from './SectionTitle'

interface PickupTableProps {
  history: CityHistory | undefined
  live: CityLive | undefined
  today: CityToday | undefined
  error: boolean
}

/** Bottom right: now and today per pickup point, then the past 10 workdays' averages per day (REQ-078, REQ-080). */
export function PickupTable({ history, live, today, error }: PickupTableProps) {
  const mixed = history?.simulated || live?.simulated || today?.simulated
  const th = 'px-2 py-1 text-right font-medium'
  return (
    <section aria-label="各上車點" className="flex min-h-0 min-w-0 flex-col gap-2 border-l border-rule bg-white p-5">
      <SectionTitle mark={mixed && '含模擬'}>各上車點</SectionTitle>
      {error && <ErrorNote>上車點資料讀取失敗，顯示上一次的資料</ErrorNote>}
      {history && (
        <table className="w-full text-base">
          <thead>
            <tr className="text-sm text-ink-soft">
              <th rowSpan={2} className="px-2 py-1 text-left align-bottom font-medium">上車點</th>
              <th rowSpan={2} className={`${th} align-bottom`}>現在等待</th>
              <th rowSpan={2} className={`${th} align-bottom`}>今日完成</th>
              <th colSpan={4} className="border-b border-rule px-2 py-1 text-center font-medium">平均每天（過去 10 個上班日）</th>
            </tr>
            <tr className="text-sm text-ink-soft">
              <th className={th}>駕駛</th>
              <th className={th}>乘客</th>
              <th className={th}>載客</th>
              <th className={th}>沒搭到</th>
            </tr>
          </thead>
          <tbody>
            {pickupRows(history, live, today).map((r) => (
              <tr key={r.id} className={`border-t border-rule tabular-nums ${r.worst ? 'font-bold text-danger' : ''}`}>
                <td className="px-2 py-1.5 font-bold">{r.name}</td>
                <td className="px-2 py-1.5 text-right">{r.waiting ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">{r.completedToday ?? '—'}</td>
                <td className="px-2 py-1.5 text-right">{oneDecimal(r.drivers)}</td>
                <td className="px-2 py-1.5 text-right">{oneDecimal(r.passengers)}</td>
                <td className="px-2 py-1.5 text-right">{oneDecimal(r.rides)}</td>
                <td className="px-2 py-1.5 text-right" data-testid="missed">{oneDecimal(r.missed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
