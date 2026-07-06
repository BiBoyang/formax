import { ChevronDown, Code } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import type { CompactBoundarySummary, RequestCollapseSummary } from '../../types'
import { useI18n } from '../i18n/I18nProvider'
import { AppShellPaneToggleIcon } from './AppShellPaneToggleIcon'

const SHARED_HEADER_BTN_GROUP =
  'h-[26px] flex items-center rounded-[6px] border border-border/60 bg-transparent overflow-hidden text-muted-foreground hover:text-foreground transition-colors'
const SHARED_HEADER_BTN_INNER = 'h-full flex items-center justify-center hover:bg-[var(--sidebar-row-hover)] transition-colors'

// Intentionally disabled in both dev/prod.
// Re-enable this single switch to restore the "Load all earlier" header entry
// without re-discovering the runtime wiring (showDevLoadAllButton/onDevLoadAllEarlier).
const ENABLE_DEV_LOAD_ALL_EARLIER_ENTRY = false

export type AppShellHeaderProps = {
  isDesktopClient: boolean
  isSidebarOpen: boolean
  activeThreadTitle: string
  activeThreadLatestCompactBoundary: CompactBoundarySummary | null
  activeThreadLatestRequestCollapse: RequestCollapseSummary | null
  showDevLoadAllButton: boolean
  devLoadAllDisabled: boolean
  devLoadAllRunning?: boolean
  onDevLoadAllEarlier?: () => void
  openFolderCwd: string | null
  onOpenFolderInTarget: (cwd: string) => void
  openFolderActionLabel: string
  onToggleSidebar: () => void
  activeTurnId: string | null
  rightOverlayInset?: number
}

export function AppShellHeader(props: AppShellHeaderProps) {
  const { t } = useI18n()
  const collapsePhaseLabel =
    props.activeThreadLatestRequestCollapse?.phase === 'reactive_retry'
      ? t('appShell.collapsePhase.reactiveRetry')
      : t('appShell.collapsePhase.initial')
  const compactTriggerLabel = props.activeThreadLatestCompactBoundary?.trigger
    ? t(`appShell.compactTrigger.${props.activeThreadLatestCompactBoundary.trigger}`)
    : t('appShell.compactTrigger.unknown')
  const compactSummaryKindLabel = props.activeThreadLatestCompactBoundary?.summaryKind
    ? t(`appShell.compactSummaryKind.${props.activeThreadLatestCompactBoundary.summaryKind}`)
    : t('appShell.compactSummaryKind.unknown')
  return (
    <header
      className={cn(
        'h-[var(--desktop-chrome-height)] flex-none app-shell-right-header',
        'border-b',
        props.isDesktopClient && 'app-shell-drag-region',
      )}
    >
      <div
        className={cn(
          'relative h-full min-w-0 flex items-center px-4 pe-[calc(1rem+76px)] app-shell-header-row-motion',
          props.isDesktopClient && !props.isSidebarOpen && 'app-shell-header-row-shifted',
        )}
        style={props.rightOverlayInset ? { paddingRight: `calc(1rem + ${props.rightOverlayInset}px)` } : undefined}
      >
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground', props.isDesktopClient && 'app-shell-no-drag')}
            onClick={props.onToggleSidebar}
            aria-label={t('appShell.toggleSidebar')}
          >
            <AppShellPaneToggleIcon side="left" isOpen={props.isSidebarOpen} />
          </Button>
          <div className="min-w-0 flex flex-col justify-center gap-0.5 leading-tight">
            <div className="min-w-0 flex items-center gap-2">
              <div className="flex-1 min-w-0 truncate ui-text-base font-semibold text-foreground">{props.activeThreadTitle}</div>
            </div>
            {props.activeThreadLatestRequestCollapse ? (
              <div
                data-testid="app-shell-collapse-summary"
                className="min-w-0 truncate text-[11px] text-muted-foreground/80"
              >
                {t('appShell.collapseSummary', {
                  tokens: String(props.activeThreadLatestRequestCollapse.estimatedTokensSaved),
                  messages: String(props.activeThreadLatestRequestCollapse.collapsedHeadMessageCount),
                  phase: collapsePhaseLabel,
                })}
              </div>
            ) : null}
            {props.activeThreadLatestCompactBoundary ? (
              <div
                data-testid="app-shell-compact-summary"
                className="min-w-0 truncate text-[11px] text-muted-foreground/80"
              >
                {t('appShell.compactSummary', {
                  trigger: compactTriggerLabel,
                  summaryKind: compactSummaryKindLabel,
                  preTokens: String(props.activeThreadLatestCompactBoundary.preTokens ?? 0),
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="absolute top-1/2 flex -translate-y-1/2 items-center gap-2"
          style={{ right: props.rightOverlayInset ? `calc(1rem + ${props.rightOverlayInset}px)` : '1rem' }}
        >
          {ENABLE_DEV_LOAD_ALL_EARLIER_ENTRY && props.showDevLoadAllButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="header-dev-load-all-earlier"
              className={cn(
                'h-8 px-2 ui-text-meta bg-transparent transition-colors',
                'text-muted-foreground hover:bg-[var(--sidebar-row-hover)] hover:text-foreground',
                props.isDesktopClient && 'app-shell-no-drag',
              )}
              onClick={props.onDevLoadAllEarlier}
              disabled={props.devLoadAllDisabled}
            >
              {props.devLoadAllRunning ? t('appShell.loadingAllEarlierDev') : t('appShell.loadAllEarlierDev')}
            </Button>
          ) : null}

          <div className={cn(SHARED_HEADER_BTN_GROUP, props.isDesktopClient && 'app-shell-no-drag')}>
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="app-shell-open-folder-button"
                    className={cn(SHARED_HEADER_BTN_INNER, 'px-2 border-r border-border/40')}
                    disabled={!props.openFolderCwd}
                    onClick={() => {
                      if (props.openFolderCwd) {
                        props.onOpenFolderInTarget(props.openFolderCwd)
                      }
                    }}
                  >
                    <Code className="h-4 w-4 text-blue-500" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[13px]">
                  {t('appShell.openInVsCode')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(SHARED_HEADER_BTN_INNER, 'px-1.5 text-muted-foreground hover:text-foreground')}>
                  <ChevronDown className="h-3.5 w-3.5 leading-none" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 z-[200]">
                <DropdownMenuItem
                  data-testid="app-shell-open-folder-menu-item"
                  className="cursor-pointer gap-2"
                  disabled={!props.openFolderCwd}
                  onClick={() => {
                    if (props.openFolderCwd) {
                      props.onOpenFolderInTarget(props.openFolderCwd)
                    }
                  }}
                >
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13px]">{props.openFolderActionLabel}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {props.activeTurnId ? (
            <div className="rounded-full border border-border bg-background px-2.5 py-1 ui-text-meta font-medium text-muted-foreground">
              {t('appShell.turnBadge', { id: props.activeTurnId.slice(0, 8) })}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
