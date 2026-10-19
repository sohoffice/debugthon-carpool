import { ConfirmTextButton, type PassengerRequest } from '@carpool/shared'
import { StationSign } from './StationSign'

interface WaitingScreenProps {
  request: PassengerRequest
  busy: boolean
  onCancel: () => void
}

/** 7.4 waiting: the only ongoing motion on the site shows the platform is working (8.4, P4). */
export function WaitingScreen({ request, busy, onCancel }: WaitingScreenProps) {
  return (
    <main className="flex h-full flex-col bg-paper pt-[calc(var(--safe-top)+20px)] pb-(--safe-bottom)">
      <StationSign name={request.pickup_point.name} note="在這裡等" />
      <h1 className="mt-10 px-6 text-[36px]/tight font-bold">正在等駕駛確認</h1>
      <div aria-hidden className="mx-6 mt-6 h-[6px] overflow-hidden rounded-full bg-brand-soft">
        <span className="waiting-light block h-full w-1/4 rounded-full bg-brand" />
      </div>
      <p className="mt-4 px-6 text-lg text-ink-soft">駕駛確認後，這裡會顯示車牌和到達時間。</p>
      {request.reassigned && (
        <p className="mx-6 mt-8 border-l-4 border-brand pl-3 text-lg font-semibold">上一位駕駛沒有回應，已改配下一台車。</p>
      )}
      <div className="mt-auto flex justify-end px-3 pb-4">
        {request.can_cancel && <ConfirmTextButton label="取消請求" confirmLabel="再按一次確定取消" disabled={busy} onConfirm={onCancel} />}
      </div>
    </main>
  )
}
