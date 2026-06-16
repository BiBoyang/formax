import { CornerDownLeft } from 'lucide-react'
import type { ButtonHTMLAttributes, FormEvent, ReactNode } from 'react'
import { Button } from '../ui/button'

export const approvalPanelPrimaryActionClass = 'h-7 gap-1 rounded-full px-2 py-0 text-[13px] leading-[18px] font-medium shadow-none'
export const approvalPanelGhostActionClass = 'h-[25px] gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[13px] leading-[18px] font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground'
export const approvalPanelHeaderClass = 'flex items-start justify-between gap-2 pl-4 pr-3 pt-4 pb-2'
export const approvalPanelTitleClass = 'text-sm leading-6 font-semibold tracking-tight text-foreground'
export const approvalPanelBodyClass = 'px-2 py-1'
export const approvalPanelFooterClass = 'flex items-center gap-2 px-2 pb-2 pt-0'

type ApprovalPanelSurfaceProps = {
  testId: string
  className?: string
  children: ReactNode
  onSubmit?: (event: FormEvent) => void
}

export function ApprovalPanelSurface(props: ApprovalPanelSurfaceProps) {
  const { testId, className = '', children, onSubmit } = props
  const panelClassName = `overflow-hidden rounded-3xl border border-border/75 bg-card shadow-sm ${className}`.trim()
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

type ApprovalActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: ReactNode
}

export function ApprovalDismissButton(props: ApprovalActionButtonProps) {
  const { label, className = '', ...buttonProps } = props
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={`${approvalPanelGhostActionClass} ${className}`.trim()}
      {...buttonProps}
    >
      <span>{label}</span>
      <kbd
        aria-hidden="true"
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-foreground/10 px-1.5 font-sans text-xs leading-4 text-foreground shadow-none"
      >
        ESC
      </kbd>
    </Button>
  )
}

export function ApprovalPrimaryButton(props: ApprovalActionButtonProps) {
  const { label, className = '', ...buttonProps } = props
  return (
    <Button
      type="button"
      className={`${approvalPanelPrimaryActionClass} ${className}`.trim()}
      {...buttonProps}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className="inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-primary-foreground/15 px-1.5 text-primary-foreground"
      >
        <CornerDownLeft className="size-3.5" />
      </span>
    </Button>
  )
}

type ApprovalOptionButtonProps = {
  selected: boolean
  onClick: () => void
  primaryText: string
  secondaryText?: string | null
  ordinal?: number
}

export function ApprovalOptionButton(props: ApprovalOptionButtonProps) {
  const { selected, onClick, primaryText, secondaryText, ordinal } = props
  const ariaLabel = `${ordinal ? `${ordinal}. ` : ''}${primaryText}${secondaryText ? ` (${secondaryText})` : ''}`

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        'flex min-h-8 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[13px] transition-colors',
        'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
        selected ? 'bg-muted/70 text-foreground' : 'text-foreground/90 hover:bg-muted/45',
      ].join(' ')}
    >
      {ordinal ? (
        <span
          aria-hidden="true"
          className={[
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs leading-none font-medium tabular-nums',
            selected
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-muted/40 text-muted-foreground',
          ].join(' ')}
        >
          {ordinal}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium">
        <span>{primaryText}</span>
        {secondaryText ? (
          <span className="ml-1 font-normal text-muted-foreground">
            ({secondaryText})
          </span>
        ) : null}
      </span>
    </button>
  )
}
