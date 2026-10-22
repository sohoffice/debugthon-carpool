import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-action text-on-action active:bg-action-down disabled:bg-line disabled:text-fg-soft',
  secondary: 'bg-transparent text-fg ring-[1.5px] ring-inset ring-line active:bg-sunk disabled:text-fg-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/**
 * 56px minimum height (8.3). A pill on light screens; on asphalt (driver) it becomes a white
 * road-sign button with small corners, through the ground's role colours (UD-21).
 */
export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`min-h-14 rounded-action px-6 text-lg font-semibold ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  )
}
