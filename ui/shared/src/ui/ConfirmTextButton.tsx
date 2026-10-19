import { useEffect, useState } from 'react'

const CONFIRM_WINDOW_MS = 3000

interface ConfirmTextButtonProps {
  label: string
  /** Shown after the first tap, e.g. 再按一次確定取消. */
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  className?: string
}

/** A quiet text button that needs a second tap within 3 seconds; no dialog (UD-17, UD-18). */
export function ConfirmTextButton({ label, confirmLabel, onConfirm, disabled = false, className = '' }: ConfirmTextButtonProps) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      className={`min-h-11 px-3 text-base font-semibold disabled:opacity-50 ${armed ? 'text-danger' : 'text-ink-soft'} ${className}`}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
