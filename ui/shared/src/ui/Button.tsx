import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-dark disabled:bg-rule disabled:text-ink-soft',
  secondary: 'bg-white text-ink ring-1 ring-inset ring-rule active:bg-paper disabled:text-ink-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/** 56px minimum height, 16px corners (docs/ui-design.md 8.3). */
export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`min-h-14 rounded-control px-5 text-lg font-semibold ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  )
}
