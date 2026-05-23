import {
  ArrowRightLeft,
  ChevronDown,
  Code,
  Copy,
  GitCommitHorizontal,
  Gauge,
  PanelLeft,
  PlusSquare,
  Settings,
  SquareTerminal,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import { cn } from '../../lib/utils'
import type { CompactBoundarySummary, ContextMeterView, RequestCollapseSummary } from '../../types'
import { useI18n } from '../i18n/I18nProvider'

const SHARED_HEADER_BTN_ICON =
  'h-[26px] w-[26px] px-0 flex items-center justify-center text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground transition-colors rounded-[6px]'
const SHARED_HEADER_BTN_GROUP =
  'h-[26px] flex items-center rounded-[6px] border border-border/60 bg-transparent overflow-hidden text-muted-foreground hover:text-foreground transition-colors'
const SHARED_HEADER_BTN_INNER = 'h-full flex items-center justify-center hover:bg-[var(--sidebar-list-hover)] transition-colors'

export type AppShellHeaderProps = {
  isRightRailOpen: boolean
  isDesktopClient: boolean
  isSidebarOpen: boolean
  activeThreadTitle: string
  activeThreadLatestCompactBoundary: CompactBoundarySummary | null
  activeThreadLatestRequestCollapse: RequestCollapseSummary | null
  activeContextMeter: ContextMeterView
  showContextMeter: boolean
  activeWorkspaceLabel: string
  showDevLoadAllButton: boolean
  devLoadAllDisabled: boolean
  devLoadAllRunning?: boolean
  onDevLoadAllEarlier?: () => void
  onOpenSettings: () => void
  selectedCwd: string | null
  onOpenFolderInTarget: (cwd: string) => void
  openFolderActionLabel: string
  onToggleTerminal: () => void | Promise<void>
  canToggleTerminal: boolean
  onToggleRightRail: () => void
  onToggleSidebar: () => void
  activeTurnId: string | null
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
        props.isRightRailOpen && 'border-b',
        props.isDesktopClient && 'app-shell-drag-region',
      )}
    >
      <div
        className={cn(
          'h-full min-w-0 flex items-center px-4 app-shell-header-row-motion',
          props.isDesktopClient && !props.isSidebarOpen && 'app-shell-header-row-shifted',
        )}
      >
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground', props.isDesktopClient && 'app-shell-no-drag')}
            onClick={props.onToggleSidebar}
            aria-label={t('appShell.toggleSidebar')}
          >
            <PanelLeft className={cn('h-4 w-4 app-shell-header-icon-motion', !props.isSidebarOpen && 'rotate-180')} />
          </Button>
          <div className="min-w-0 flex flex-col justify-center gap-0.5 leading-tight">
            <div className="min-w-0 flex items-center gap-2">
              <div className="flex-1 min-w-0 truncate ui-text-base font-semibold text-foreground">{props.activeThreadTitle}</div>
              {props.showContextMeter && props.activeContextMeter.available && props.activeContextMeter.label ? (
                <div
                  data-testid="app-shell-context-meter"
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1 truncate text-[11px]',
                    props.activeContextMeter.tone === 'danger'
                      ? 'text-red-500'
                      : props.activeContextMeter.tone === 'warning'
                        ? 'text-amber-500'
                        : 'text-muted-foreground/80',
                  )}
                >
                  <Gauge className="h-3 w-3" />
                  <span className="max-w-[180px] truncate">{props.activeContextMeter.label}</span>
                </div>
              ) : null}
              <div className="min-w-0 max-w-[40%] truncate ui-text-meta text-muted-foreground/80">{props.activeWorkspaceLabel}</div>
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
        <div className="ml-3 flex shrink-0 items-center gap-2">
          {props.showDevLoadAllButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="header-dev-load-all-earlier"
              className={cn(
                'h-8 px-2 ui-text-meta bg-transparent transition-colors',
                'text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground',
                props.isDesktopClient && 'app-shell-no-drag',
              )}
              onClick={props.onDevLoadAllEarlier}
              disabled={props.devLoadAllDisabled}
            >
              {props.devLoadAllRunning ? t('appShell.loadingAllEarlierDev') : t('appShell.loadAllEarlierDev')}
            </Button>
          ) : null}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(SHARED_HEADER_BTN_ICON, props.isDesktopClient && 'app-shell-no-drag')}
                  onClick={props.onOpenSettings}
                  aria-label={t('appShell.settings')}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[13px]">
                {t('appShell.settings')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className={cn(SHARED_HEADER_BTN_GROUP, props.isDesktopClient && 'app-shell-no-drag')}>
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(SHARED_HEADER_BTN_INNER, 'px-2 border-r border-border/40')}
                    onClick={() => {
                      if (props.selectedCwd) {
                        props.onOpenFolderInTarget(props.selectedCwd)
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
                  className="cursor-pointer gap-2"
                  onClick={() => {
                    if (props.selectedCwd) {
                      props.onOpenFolderInTarget(props.selectedCwd)
                    }
                  }}
                >
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13px]">{props.openFolderActionLabel}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            type="button"
            className={cn(
              SHARED_HEADER_BTN_GROUP,
              'px-2 gap-1 hover:bg-[var(--sidebar-list-hover)] border-border/60',
              props.isDesktopClient && 'app-shell-no-drag',
            )}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span className="text-[12px]">{t('appShell.moveToWorktree')}</span>
          </button>

          <div className={cn(SHARED_HEADER_BTN_GROUP, props.isDesktopClient && 'app-shell-no-drag')}>
            <button type="button" className={cn(SHARED_HEADER_BTN_INNER, 'px-2 gap-1 border-r border-border/40')}>
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              <span className="text-[12px]">{t('appShell.commit')}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(SHARED_HEADER_BTN_INNER, 'px-1.5')}>
                  <ChevronDown className="h-3.5 w-3.5 leading-none" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 z-[200]">
                <DropdownMenuItem className="text-[13px] cursor-pointer">{t('appShell.placeholderAction')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="w-px h-4 bg-border/60 mx-1" />

          {props.isDesktopClient ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn('inline-flex', props.isDesktopClient && 'app-shell-no-drag')}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(SHARED_HEADER_BTN_ICON)}
                      onClick={() => {
                        void props.onToggleTerminal()
                      }}
                      disabled={!props.canToggleTerminal}
                      aria-label={t('appShell.toggleTerminal')}
                    >
                      <SquareTerminal className="h-4 w-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[13px]">
                  {props.canToggleTerminal ? `${t('appShell.toggleTerminal')} ⌘J` : t('appShell.terminalUnavailable')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          <button
            type="button"
            className={cn(
              'flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] transition-colors select-none',
              props.isRightRailOpen
                ? 'bg-[var(--sidebar-list-hover)] text-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground',
              props.isDesktopClient && 'app-shell-no-drag',
            )}
            onClick={props.onToggleRightRail}
          >
            <PlusSquare className="h-3.5 w-3.5" />
            <div className="flex items-center gap-1 text-[12px] font-medium tracking-tight mt-[1px]">
              <span className="text-green-600 dark:text-green-500">+210</span>
              <span className="text-red-600 dark:text-red-500">-88</span>
            </div>
          </button>

          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(SHARED_HEADER_BTN_ICON, props.isDesktopClient && 'app-shell-no-drag')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[13px]">
                {t('appShell.openInPopoutWindow')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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
