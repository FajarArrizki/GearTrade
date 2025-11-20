interface CtaButtonProps {
  label: string
  helper?: string
  variant?: 'primary' | 'secondary'
}

export function CtaButton({ label, helper, variant = 'primary' }: CtaButtonProps) {
  const baseStyles = 'px-6 py-3 border uppercase tracking-[0.3em] text-xs'
  const variantStyles =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-transparent text-foreground border-white/30'

  return (
    <div className="space-y-1">
      <button type="button" className={`${baseStyles} ${variantStyles}`}>
        {label}
      </button>
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  )
}


