import { SquareTerminal } from 'lucide-react'
import { cn } from '../../lib/utils'
import { AppShellPaneToggleIcon } from './AppShellPaneToggleIcon'

export type AppShellTopRightControlsProps = {
  isRightRailOpen: boolean
  isTerminalOpen: boolean
  isDesktopClient: boolean
  onToggleRightRail: () => void
  onToggleTerminal: () => void | Promise<void>
  canToggleTerminal: boolean
  className?: string
}

export function AppShellTopRightControls(props: AppShellTopRightControlsProps) {
  return (
    <div
      data-testid="app-shell-top-right-controls"
      className={cn('flex shrink-0 items-center justify-end gap-2', props.className)}
    >
      <button
        type="button"
        data-testid="app-shell-terminal-toggle"
        aria-pressed={props.isTerminalOpen}
        className={cn(
          'inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-muted-foreground transition-colors select-none hover:bg-[var(--sidebar-row-hover)] hover:text-foreground disabled:opacity-50',
          props.isTerminalOpen && 'bg-[var(--sidebar-row-hover)] text-foreground',
          props.isDesktopClient && 'app-shell-no-drag',
        )}
        disabled={!props.canToggleTerminal}
        onClick={() => {
          void props.onToggleTerminal()
        }}
      >
        <SquareTerminal className="h-4 w-4" />
      </button>

      <button
        type="button"
        data-testid="app-shell-right-rail-toggle"
        aria-pressed={props.isRightRailOpen}
        className={cn(
          'inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-muted-foreground transition-colors select-none hover:bg-[var(--sidebar-row-hover)] hover:text-foreground',
          props.isRightRailOpen && 'bg-[var(--sidebar-row-hover)] text-foreground',
          props.isDesktopClient && 'app-shell-no-drag',
        )}
        onClick={props.onToggleRightRail}
      >
        <AppShellPaneToggleIcon side="right" isOpen={props.isRightRailOpen} />
      </button>
    </div>
  )
}
