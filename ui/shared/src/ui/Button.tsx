import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-dark',
  secondary: 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-100',
  danger: 'bg-danger text-white active:opacity-90',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

/** Large touch target by default (mobile-first; drivers tap it while stopped). */
export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`min-h-12 rounded-xl px-5 text-base font-semibold disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  )
}
