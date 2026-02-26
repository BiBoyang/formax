import type { FormEvent, ReactNode } from 'react'

type ApprovalPanelSurfaceProps = {
  testId: string
  className?: string
  children: ReactNode
  onSubmit?: (event: FormEvent) => void
}

export function ApprovalPanelSurface(props: ApprovalPanelSurfaceProps) {
  const { testId, className = '', children, onSubmit } = props
  const panelClassName = `rounded-2xl border border-border/85 bg-card/95 px-2 py-3 shadow-sm ${className}`.trim()
  if (onSubmit) {
    return (
      <form data-testid={testId} onSubmit={onSubmit} className={panelClassName}>
        {children}
      </form>
    )
  }

  return (
    <div data-testid={testId} className={panelClassName}>
      {children}
    </div>
  )
}

type ApprovalOptionButtonProps = {
  selected: boolean
  onClick: () => void
  primaryText: string
  secondaryText?: string | null
}

export function ApprovalOptionButton(props: ApprovalOptionButtonProps) {
  const { selected, onClick, primaryText, secondaryText } = props
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full rounded-xl border px-3 py-2 text-left transition-colors',
        selected ? 'border-border bg-muted text-foreground' : 'border-transparent text-foreground/90 hover:bg-muted/60',
      ].join(' ')}
    >
      <div className="text-[13px] leading-5 font-medium">{primaryText}</div>
      {secondaryText ? <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{secondaryText}</div> : null}
    </button>
  )
}
