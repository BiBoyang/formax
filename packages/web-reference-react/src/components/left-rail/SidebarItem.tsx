import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { cn } from '../../lib/utils'
import { buttonVariants } from '../ui/button'
import { DropdownMenuItem } from '../ui/dropdown-menu'

export type SidebarItemKind = 'button' | 'row' | 'static' | 'menu'
export type SidebarItemTone = 'primary' | 'secondary' | 'muted' | 'inherit'

export type SidebarItemProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'onClick'> & {
  kind?: SidebarItemKind
  leading?: ReactNode
  icon?: ReactNode
  iconClassName?: string
  label: ReactNode
  labelClassName?: string
  trailing?: ReactNode
  trailingClassName?: string
  selected?: boolean
  selectable?: boolean
  hoverable?: boolean
  tone?: SidebarItemTone
  className?: string
  ariaLabel?: string
  onActivate?: () => void
  onClick?: ComponentPropsWithoutRef<'button'>['onClick']
}

const sidebarItemToneClass: Record<SidebarItemTone, string> = {
  primary: 'text-foreground',
  secondary: 'ui-sidebar-text-secondary',
  muted: 'ui-sidebar-text-muted',
  inherit: 'text-inherit',
}

export const SidebarItem = forwardRef<HTMLButtonElement, SidebarItemProps>(function SidebarItem(props, ref) {
  const {
    kind = 'button',
    leading,
    icon,
    iconClassName,
    label,
    labelClassName,
    trailing,
    trailingClassName,
    selected = false,
    selectable = false,
    hoverable = true,
    tone = 'secondary',
    className,
    title,
    ariaLabel: ariaLabelProp,
    'aria-label': ariaLabel,
    disabled,
    type = 'button',
    onClick,
    onActivate,
    ...rest
  } = props

  const selectedSurfaceClass = selected && selectable ? 'bg-[var(--sidebar-list-active)]' : null
  const hoverSurfaceClass =
    hoverable ? 'hover:bg-[var(--sidebar-list-hover)] focus-within:bg-[var(--sidebar-list-hover)]' : null

  const content = (
    <>
      {leading ?? (icon ? (
        <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center opacity-70', iconClassName)} aria-hidden>
          {icon}
        </span>
      ) : null)}
      <span className={cn('min-w-0 flex-1 truncate text-left', labelClassName)}>{label}</span>
      {trailing ? (
        <div className={cn('shrink-0 text-right', trailingClassName)}>{trailing}</div>
      ) : null}
    </>
  )

  if (kind === 'menu') {
    return (
      <DropdownMenuItem
        className={cn('gap-2', sidebarItemToneClass[tone], className)}
        disabled={disabled}
        onSelect={() => onActivate?.()}
      >
        {content}
      </DropdownMenuItem>
    )
  }

  const rowClassName = cn(
    'h-8 min-w-0 w-full rounded-md px-3 ui-text-base font-normal ui-sidebar-item',
    'focus:ring-0 focus-visible:ring-0 focus-visible:border-transparent focus-visible:outline-none focus-visible:shadow-none',
    'focus-visible:bg-[var(--sidebar-list-hover)]',
    kind === 'button' ? 'justify-start gap-3' : 'flex items-center gap-3',
    kind === 'row' && 'cursor-pointer',
    disabled && kind === 'row' && 'cursor-not-allowed',
    sidebarItemToneClass[tone],
    hoverSurfaceClass,
    selectedSurfaceClass,
    className,
  )

  if (kind === 'static') {
    return (
      <div
        className={rowClassName}
        data-selected={selected ? 'true' : undefined}
        title={title}
        aria-label={ariaLabelProp ?? ariaLabel}
      >
        {content}
      </div>
    )
  }

  if (kind === 'row') {
    return (
      <div
        className={rowClassName}
        data-selected={selected ? 'true' : undefined}
        title={title}
        aria-label={ariaLabelProp ?? ariaLabel}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled ? 'true' : undefined}
        onClick={(event) => {
          if (disabled) return
          const target = event.target as HTMLElement | null
          const interactiveAncestor = target?.closest('button, a, input, textarea, select, [role="button"], [role="menuitem"]')
          if (interactiveAncestor && interactiveAncestor !== event.currentTarget) return
          onActivate?.()
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onActivate?.()
        }}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant: 'ghost' }), rowClassName)}
      data-selected={selected ? 'true' : undefined}
      title={title}
      aria-label={ariaLabelProp ?? ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        onActivate?.()
      }}
      {...rest}
    >
      {content}
    </button>
  )
})
