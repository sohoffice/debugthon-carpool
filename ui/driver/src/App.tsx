import { MapView } from '@carpool/shared'
import { account } from './config'

export function App() {
  return (
    <div className="flex h-dvh flex-col bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between bg-brand px-4 py-3 text-white">
        <h1 className="text-lg font-bold">內科順路共乘 · 駕駛</h1>
        <span className="text-sm opacity-80">{account}</span>
      </header>
      <main className="relative flex-1">
        <MapView />
      </main>
      <section className="border-t border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">出發確認（待實作）</p>
      </section>
    </div>
  )
}
