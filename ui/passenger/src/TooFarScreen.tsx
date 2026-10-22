import { Button } from '@carpool/shared'
import { StationSign } from './StationSign'

interface TooFarScreenProps {
  pickupName: string
  /** The backend's explanation, with the distance; the UI does not know the allowed distance (DD-25). */
  message: string
  onBack: () => void
}

/** 7.8 rejected: where the passenger was and the pickup point, joined by a dotted walk (REQ-034). */
export function TooFarScreen({ pickupName, message, onBack }: TooFarScreenProps) {
  return (
    <main className="flex h-full flex-col bg-canvas pt-[calc(var(--safe-top)+16px)] pb-(--safe-bottom)">
      <StationSign name={pickupName} />
      <div className="px-6 pt-8">
        <h1 className="text-[34px]/tight font-semibold">還不能送出</h1>
        <p className="mt-3 text-xl text-fg-soft">{message}</p>
      </div>
      <ol aria-label="你和上車點" className="mx-6 mt-10">
        <li className="flex items-center gap-4">
          <span aria-hidden className="size-6 shrink-0 rounded-full border-[5px] border-ink-soft" />
          <span className="text-lg font-semibold">送出時的位置</span>
        </li>
        <li aria-hidden className="flex h-24">
          <span className="ml-[9px] border-l-[6px] border-dotted border-ink-soft" />
        </li>
        <li className="flex items-center gap-4">
          <span aria-hidden className="size-6 shrink-0 rounded-full border-[5px] border-brand bg-white" />
          <span className="text-lg font-semibold">{pickupName}</span>
        </li>
      </ol>
      <div className="mt-auto px-6 pb-4">
        <Button className="h-16 w-full text-xl" onClick={onBack}>
          回去看接近的車
        </Button>
      </div>
    </main>
  )
}
