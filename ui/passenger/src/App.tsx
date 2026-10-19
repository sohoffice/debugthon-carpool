import { PhoneShell, SimulatedBadge } from '@carpool/shared'
import { account } from './config'

export function App() {
  return (
    <PhoneShell roleLabel="乘客" tone="dark">
      <main className="flex h-full flex-col bg-paper pt-(--safe-top) pb-(--safe-bottom)">
        <p className="mt-6 px-6 text-base text-ink-soft">到 瑞光路 513 巷 · {account}</p>
        <div className="mt-6 flex h-16 items-center bg-brand pr-6 text-white">
          <span className="h-full w-3 bg-white/90" />
          <span className="ml-4 text-3xl font-bold">松山車站</span>
          <span className="ml-auto text-base font-semibold">你在這裡</span>
        </div>
        <h1 className="mt-8 flex items-end gap-3 px-6">
          <span className="pb-3 text-lg font-semibold">最快</span>
          <span className="font-board text-board font-semibold tabular-nums">3</span>
          <span className="pb-3 text-lg font-semibold">分鐘到</span>
        </h1>
        <p className="mt-6 flex items-center gap-2 px-6 text-sm text-ink-soft">
          <SimulatedBadge label="模擬車輛" /> 車輛位置與到站時間由模擬器產生
        </p>
      </main>
    </PhoneShell>
  )
}
