import type { FormEvent, ReactNode } from 'react'

type ApprovalPanelSurfaceProps = {
  testId: string
  className?: string
  children: ReactNode
  onSubmit?: (event: FormEvent) => void
}

export function ApprovalPanelSurface(props: ApprovalPanelSurfaceProps) {
  const { testId, className = '', children, onSubmit } = props
  const panelClassName = `rounded-[24px] border border-border/85 bg-card/95 px-1 py-3 shadow-sm ${className}`.trim()
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
        'w-full rounded-xl px-3 py-[9px] text-left transition',
        selected ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground/90',
      ].join(' ')}
    >
      <div className="text-[13px] leading-snug font-medium">{primaryText}</div>
      {secondaryText ? <div className="mt-0 text-[11px] leading-tight text-muted-foreground">{secondaryText}</div> : null}
    </button>
  )
}
