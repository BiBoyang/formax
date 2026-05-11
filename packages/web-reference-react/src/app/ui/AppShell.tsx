import { memo, useCallback, useMemo, useRef } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { PanelLeft } from 'lucide-react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { InputApprovalDock } from '../../components/InputApprovalDock'
import { LeftRail } from '../../components/LeftRail'
import { TerminalPane } from '../../components/TerminalPane'
import { TranscriptPane } from '../../components/TranscriptPane'
import { WorktreeDiffPane, type DiffFilePatchPayload, type DiffSnapshot } from '../../components/WorktreeDiffPane'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { cn } from '../../lib/utils'
import { SettingsPane } from '../../components/SettingsPane'
import type { PendingInput, RequestCollapseSummary, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadViewModel } from '../core/threadViewModel'
import { type UpdateUserSetting, type UserSettings } from '../core/userSettings'
import { useI18n } from '../i18n/I18nProvider'
import type { ReplMode } from '../../semantics'
import { RIGHT_RAIL_MAX_SIZE, RIGHT_RAIL_MIN_SIZE, SIDEBAR_MAX_SIZE, SIDEBAR_MIN_SIZE } from '../core/constants'
import { folderNameFromCwd } from '../../components/left-rail/utils'
import { AppShellHeader } from './AppShellHeader'
import { useDesktopBridge } from './useDesktopBridge'
import { usePanelDragCommit } from './usePanelDragCommit'
import { TERMINAL_MAX_SIZE, TERMINAL_MIN_SIZE, useTerminalVisibility } from './useTerminalVisibility'

const MemoLeftRail = memo(LeftRail)
const MemoTranscriptPane = memo(TranscriptPane)
const MemoInputApprovalDock = memo(InputApprovalDock)
const MemoWorktreeDiffPane = memo(WorktreeDiffPane)

export type AppShellProps = {
  sortedThreads: ThreadViewModel[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, label: string) => void
  onArchiveThread: (threadId: string) => void
  onStartThread: () => void
  onStartThreadInCwd: (cwd: string) => void
  hiddenGroupCwds: string[]
  onHideThreadGroup: (cwd: string) => void
  isThreadActionBusy: boolean
  isSidebarOpen: boolean
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>
  sidebarWidth: number
  isRightRailOpen: boolean
  setIsRightRailOpen: Dispatch<SetStateAction<boolean>>
  rightRailWidth: number
  setSidebarWidth: Dispatch<SetStateAction<number>>
  setRightRailWidth: Dispatch<SetStateAction<number>>
  isSettingsOpen: boolean
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>
  activeThreadTitle: string
  activeThreadLatestRequestCollapse: RequestCollapseSummary | null
  activeTurnId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  activeThread: ThreadSummary | undefined
  transcriptVirtualizationEnabled: boolean
  composerLocked: boolean
  logs: TranscriptItem[]
  inputText: string
  mode: ReplMode
  onModeChange: (nextMode: ReplMode) => void
  onInputTextChange: (value: string) => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  devLoadAllEnabled?: boolean
  devLoadAllRunning?: boolean
  onDevLoadAllEarlier?: () => void
  isSending: boolean
  isInterrupting: boolean
  lastRpcError: { at: string; method: string; message: string; code?: number; data?: unknown } | null
  selectedInput: PendingInput | null
  isSelectedAskOpen: boolean
  selectedAskPageIndex: number
  selectedAskDraft: Record<string, string>
  submitStatus: { status: string; kind: 'success' | 'error'; message?: string } | null
  isSubmittingInput: boolean
  onAskOpen: () => void
  onAskDismiss: () => void
  onAskPageChange: (page: number) => void
  onAskDraftChange: (fieldId: string, value: string) => void
  onSubmitInput: (inputId: string, answers: Record<string, string>) => void
  diffSnapshot: DiffSnapshot | null
  onRefreshDiff: () => void
  onRequestDiffPatch: (filePath: string) => Promise<DiffFilePatchPayload | null>
  isRefreshingDiff: boolean
  noticeMessage: string | null
  userSettings: UserSettings
  onUserSettingChange: UpdateUserSetting
}

export function AppShell(props: AppShellProps) {
  const { t } = useI18n()
  const shouldKeepSystemAwake =
    props.userSettings.preventSleep && (props.isSending || props.isInterrupting || props.activeTurnId != null)
  const { availableOpenTargets, desktopBridge, isDesktopClient, isWindowTransparent, onToggleWindowTransparency, terminalBridge } =
    useDesktopBridge({
      shouldKeepSystemAwake,
      defaultOpenTarget: props.userSettings.defaultOpenTarget,
      onUserSettingChange: props.onUserSettingChange,
    })
  const sidebarPercent = props.sidebarWidth
  const sidebarMinPercent = SIDEBAR_MIN_SIZE
  const sidebarMaxPercent = SIDEBAR_MAX_SIZE
  const rightRailPercent = props.rightRailWidth
  const rightRailMinPercent = RIGHT_RAIL_MIN_SIZE
  const rightRailMaxPercent = RIGHT_RAIL_MAX_SIZE
  const centerPercent = Math.max(0, 100 - rightRailPercent)
  const panelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const rightRailPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const terminalPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const showDevLoadAllButton = props.devLoadAllEnabled === true
  const sidebarPanelSize = props.isSidebarOpen ? sidebarPercent : 0
  const centerDefaultSize = 100 - sidebarPanelSize
  const devLoadAllDisabled = !props.activeThreadId || !props.onDevLoadAllEarlier || props.devLoadAllRunning === true
  const activeWorkspaceLabel = useMemo(() => {
    const cwd = props.activeThread?.cwd ?? props.selectedCwd
    if (cwd) {
      return folderNameFromCwd(cwd)
    }
    return isDesktopClient ? t('appShell.desktopWorkspace') : t('appShell.webWorkspace')
  }, [isDesktopClient, props.activeThread?.cwd, props.selectedCwd, t])
  const {
    canToggleTerminal,
    onCloseTerminalPane,
    onTerminalDragStateChange,
    onTerminalResize,
    onToggleTerminal,
    showTerminalPane,
    terminalHeightPercent,
    terminalPaneThreadId,
  } = useTerminalVisibility({
    activeThreadCwd: props.activeThread?.cwd,
    activeThreadId: props.activeThreadId,
    isSettingsOpen: props.isSettingsOpen,
    selectedCwd: props.selectedCwd,
    sortedThreads: props.sortedThreads,
    terminalBridge: isDesktopClient ? terminalBridge : null,
    terminalPanelGroupRef,
  })

  const {
    onLeftDragStateChange,
    onLeftResize,
    onRightDragStateChange,
    onRightResize,
    onToggleRightRail,
    onToggleSidebar,
  } = usePanelDragCommit({
    isRightRailOpen: props.isRightRailOpen,
    isSidebarOpen: props.isSidebarOpen,
    panelGroupRef,
    rightRailPanelGroupRef,
    rightRailWidth: props.rightRailWidth,
    setIsRightRailOpen: props.setIsRightRailOpen,
    setIsSidebarOpen: props.setIsSidebarOpen,
    setRightRailWidth: props.setRightRailWidth,
    setSidebarWidth: props.setSidebarWidth,
    sidebarWidth: props.sidebarWidth,
  })

  const onDevLoadAllEarlier = useCallback(() => {
    props.onDevLoadAllEarlier?.()
  }, [props.onDevLoadAllEarlier])

  const onOpenSettings = useCallback(() => {
    props.setIsSettingsOpen(true)
  }, [props.setIsSettingsOpen])

  const onCloseSettings = useCallback(() => {
    props.setIsSettingsOpen(false)
  }, [props.setIsSettingsOpen])

  const onCreateProject = useCallback(async () => {
    if (!desktopBridge?.pickProjectFolder) return
    const nextCwd = await desktopBridge.pickProjectFolder()
    if (!nextCwd) return
    const openWithTarget = desktopBridge?.openTargets?.openPath
    if (openWithTarget) {
      void openWithTarget(props.userSettings.defaultOpenTarget, nextCwd).catch(() => undefined)
    }
    props.onStartThreadInCwd(nextCwd)
  }, [desktopBridge, props.onStartThreadInCwd, props.userSettings.defaultOpenTarget])

  const onOpenFolderInTarget = useCallback((cwd: string) => {
    if (!isDesktopClient) return
    const openWithTarget = desktopBridge?.openTargets?.openPath
    if (!openWithTarget) return
    if (!cwd.trim()) return
    void openWithTarget(props.userSettings.defaultOpenTarget, cwd).catch(() => undefined)
  }, [desktopBridge, isDesktopClient, props.userSettings.defaultOpenTarget])

  const openFolderActionLabel = useMemo(() => {
    const selectedTarget = availableOpenTargets.find((target) => target.id === props.userSettings.defaultOpenTarget)
    const label = selectedTarget?.label ?? 'Finder'
    return t('leftRail.openInTarget', { target: label })
  }, [availableOpenTargets, props.userSettings.defaultOpenTarget, t])

  const leftRailProps = useMemo(
    () => ({
      threads: props.sortedThreads,
      selectedCwd: props.selectedCwd,
      onSelectCwd: props.onSelectCwd,
      activeThreadId: props.activeThreadId,
      onSelectThread: props.onSelectThread,
      onRenameThread: props.onRenameThread,
      onArchiveThread: props.onArchiveThread,
      onStartThread: props.onStartThread,
      onStartThreadInCwd: props.onStartThreadInCwd,
      hiddenGroupCwds: props.hiddenGroupCwds,
      onHideThreadGroup: props.onHideThreadGroup,
      isBusy: props.isThreadActionBusy,
      isDesktopClient,
      onCreateProject: desktopBridge?.pickProjectFolder ? onCreateProject : undefined,
      isWindowTransparent,
      onToggleWindowTransparency: isDesktopClient ? onToggleWindowTransparency : undefined,
      isSettingsOpen: props.isSettingsOpen,
      onOpenSettings,
      onCloseSettings,
      onOpenFolderInTarget: isDesktopClient ? onOpenFolderInTarget : undefined,
      openFolderActionLabel,
    }),
    [
      props.activeThreadId,
      props.hiddenGroupCwds,
      props.isThreadActionBusy,
      props.onArchiveThread,
      props.onHideThreadGroup,
      props.onRenameThread,
      props.onSelectCwd,
      props.onSelectThread,
      props.onStartThread,
      props.onStartThreadInCwd,
      props.selectedCwd,
      props.sortedThreads,
      props.isSettingsOpen,
      isDesktopClient,
      isWindowTransparent,
      desktopBridge,
      onCreateProject,
      onOpenFolderInTarget,
      openFolderActionLabel,
      onOpenSettings,
      onCloseSettings,
      onToggleWindowTransparency,
    ],
  )

  const transcriptPaneProps = useMemo(
    () => ({
      activeThread: props.activeThread,
      activeThreadId: props.activeThreadId,
      activeTurnId: props.activeTurnId,
      composerLocked: props.composerLocked,
      virtualizationEnabled: props.transcriptVirtualizationEnabled,
      logs: props.logs,
      inputText: props.inputText,
      mode: props.mode,
      onModeChange: props.onModeChange,
      connectionStatus: props.connectionStatus,
      onInputTextChange: props.onInputTextChange,
      onSend: props.onSend,
      onInterrupt: props.onInterrupt,
      historyMore: props.historyMore,
      historyLoading: props.historyLoading,
      onLoadEarlier: props.onLoadEarlier,
      devLoadAllActive: props.devLoadAllRunning === true,
      isSending: props.isSending,
      isInterrupting: props.isInterrupting,
      lastRpcError: props.lastRpcError,
      longTextRequireCmdEnter: props.userSettings.longTextRequireCmdEnter,
    }),
    [
      props.activeThread,
      props.activeThreadId,
      props.activeTurnId,
      props.composerLocked,
      props.connectionStatus,
      props.devLoadAllRunning,
      props.historyLoading,
      props.historyMore,
      props.inputText,
      props.isInterrupting,
      props.isSending,
      props.lastRpcError,
      props.logs,
      props.mode,
      props.onInputTextChange,
      props.onInterrupt,
      props.onLoadEarlier,
      props.onModeChange,
      props.onSend,
      props.userSettings.longTextRequireCmdEnter,
      props.transcriptVirtualizationEnabled,
    ],
  )

  const inputApprovalDockProps = useMemo(
    () => ({
      input: props.selectedInput,
      isAskOpen: props.isSelectedAskOpen,
      askPageIndex: props.selectedAskPageIndex,
      askDraftValues: props.selectedAskDraft,
      submitStatus: props.submitStatus,
      isSubmitting: props.isSubmittingInput,
      onAskOpen: props.onAskOpen,
      onAskDismiss: props.onAskDismiss,
      onAskPageChange: props.onAskPageChange,
      onAskDraftChange: props.onAskDraftChange,
      onSubmitInput: props.onSubmitInput,
    }),
    [
      props.isSelectedAskOpen,
      props.isSubmittingInput,
      props.onAskDismiss,
      props.onAskDraftChange,
      props.onAskOpen,
      props.onAskPageChange,
      props.onSubmitInput,
      props.selectedAskDraft,
      props.selectedAskPageIndex,
      props.selectedInput,
      props.submitStatus,
    ],
  )

  const worktreeDiffPaneProps = useMemo(
    () => ({
      diffSnapshot: props.diffSnapshot,
      latestRequestCollapse: props.activeThreadLatestRequestCollapse,
      onRefreshDiff: props.onRefreshDiff,
      onRequestPatch: props.onRequestDiffPatch,
      isRefreshingDiff: props.isRefreshingDiff,
      showHeader: true as const,
    }),
    [
      props.activeThreadLatestRequestCollapse,
      props.diffSnapshot,
      props.isRefreshingDiff,
      props.onRefreshDiff,
      props.onRequestDiffPatch,
    ],
  )

  const transcriptAndDiffPanels = (
    <ResizablePanelGroup ref={rightRailPanelGroupRef} direction="horizontal" className="flex-1 min-h-0 min-w-0">
      <ResizablePanel defaultSize={props.isRightRailOpen ? centerPercent : 100} minSize={35}>
        <div data-testid="center-pane-host" className="h-full min-w-0 relative flex flex-col">
          {props.noticeMessage ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-40 w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2">
              <Alert className="pointer-events-auto border-border/70 bg-background/95 shadow-sm backdrop-blur">
                <AlertTitle>{t('appShell.sessionArchived')}</AlertTitle>
                <AlertDescription>{props.noticeMessage}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <MemoTranscriptPane {...transcriptPaneProps} />
          <MemoInputApprovalDock {...inputApprovalDockProps} />
        </div>
      </ResizablePanel>

      <ResizableHandle
        className={cn(
          'relative z-[120] w-0 after:left-0 after:w-3 after:translate-x-0',
          !props.isRightRailOpen && 'pointer-events-none opacity-0',
        )}
        onDragging={onRightDragStateChange}
      />

      <ResizablePanel
        defaultSize={rightRailPercent}
        size={props.isRightRailOpen ? rightRailPercent : 0}
        minSize={props.isRightRailOpen ? rightRailMinPercent : 0}
        maxSize={props.isRightRailOpen ? rightRailMaxPercent : 0}
        onResize={onRightResize}
        className={cn(
          'app-shell-panel-motion',
          !props.isRightRailOpen && 'pointer-events-none',
        )}
      >
        <div
          data-testid="right-rail"
          className={cn(
            'h-full min-w-0 app-shell-right-rail overflow-hidden overflow-x-hidden app-shell-sidebar-content-motion',
            props.isRightRailOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4',
          )}
        >
          <MemoWorktreeDiffPane {...worktreeDiffPaneProps} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )

  return (
    <div
      data-testid="app-shell"
      data-window-transparency={isDesktopClient && isWindowTransparent ? 'on' : 'off'}
      className={cn(
        'h-screen w-screen min-w-0 overflow-hidden ui-text-base relative app-shell-root-surface',
        isDesktopClient && 'app-shell-desktop',
      )}
    >
      <ResizablePanelGroup
        ref={panelGroupRef}
        direction="horizontal"
        className="h-full w-full"
      >
        <ResizablePanel
          defaultSize={sidebarPanelSize}
          size={sidebarPanelSize}
          minSize={props.isSidebarOpen ? sidebarMinPercent : 0}
          maxSize={props.isSidebarOpen ? sidebarMaxPercent : 0}
          onResize={onLeftResize}
          className={cn(
            'relative z-10 overflow-hidden app-shell-panel-motion app-shell-sidebar-panel',
            !props.isSidebarOpen && 'pointer-events-none',
          )}
        >
          <div
            data-testid="left-rail"
            className={cn(
              'h-full w-full overflow-hidden app-shell-sidebar-host app-shell-sidebar-content-motion',
              props.isSidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4',
            )}
          >
            <MemoLeftRail {...leftRailProps} />
          </div>
        </ResizablePanel>

        <ResizableHandle
          className={cn(
            'app-shell-left-resize-handle relative z-[120] !w-0 bg-transparent after:left-0 after:w-3 after:translate-x-0',
            !props.isSidebarOpen && 'pointer-events-none opacity-0',
          )}
          onDragging={onLeftDragStateChange}
        />

        <ResizablePanel defaultSize={centerDefaultSize} minSize={35} className="relative z-20 app-shell-panel-motion">
              <div
                className={cn(
                  'h-full min-w-0 flex flex-col',
                  props.isSidebarOpen
                    ? 'rounded-tl-[22px] rounded-bl-[22px] app-shell-right-surface overflow-hidden'
                    : 'app-shell-right-surface',
                )}
              >
            {!props.isSettingsOpen ? (
              <AppShellHeader
                isRightRailOpen={props.isRightRailOpen}
                isDesktopClient={isDesktopClient}
                isSidebarOpen={props.isSidebarOpen}
                activeThreadTitle={props.activeThreadTitle}
                activeThreadLatestRequestCollapse={props.activeThreadLatestRequestCollapse}
                activeWorkspaceLabel={activeWorkspaceLabel}
                showDevLoadAllButton={showDevLoadAllButton}
                devLoadAllDisabled={devLoadAllDisabled}
                devLoadAllRunning={props.devLoadAllRunning}
                onDevLoadAllEarlier={onDevLoadAllEarlier}
                onOpenSettings={onOpenSettings}
                selectedCwd={props.selectedCwd}
                onOpenFolderInTarget={onOpenFolderInTarget}
                openFolderActionLabel={openFolderActionLabel}
                onToggleTerminal={onToggleTerminal}
                canToggleTerminal={canToggleTerminal}
                onToggleRightRail={onToggleRightRail}
                onToggleSidebar={onToggleSidebar}
                activeTurnId={props.activeTurnId}
              />
            ) : null}

            {props.isSettingsOpen ? (
              <div className="flex-1 min-h-0 min-w-0 flex flex-col">
                <header
                  className={cn(
                    'h-[var(--desktop-chrome-height)] flex-none app-shell-right-header',
                    isDesktopClient && 'app-shell-drag-region',
                  )}
                >
                  <div
                    className={cn(
                      'h-full min-w-0 flex items-center px-4 app-shell-header-row-motion',
                      isDesktopClient && !props.isSidebarOpen && 'app-shell-header-row-shifted',
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground',
                        isDesktopClient && 'app-shell-no-drag',
                      )}
                      onClick={onToggleSidebar}
                      aria-label={t('appShell.toggleSidebar')}
                    >
                      <PanelLeft
                        className={cn(
                          'h-4 w-4 app-shell-header-icon-motion',
                          !props.isSidebarOpen && 'rotate-180',
                        )}
                      />
                    </Button>
                  </div>
                </header>
                <SettingsPane
                  settings={props.userSettings}
                  onSettingChange={props.onUserSettingChange}
                  availableOpenTargets={availableOpenTargets}
                />
              </div>
            ) : (
              <ResizablePanelGroup
                ref={terminalPanelGroupRef}
                direction="vertical"
                className="flex-1 min-h-0 min-w-0"
              >
                <ResizablePanel
                  defaultSize={showTerminalPane ? Math.max(35, 100 - terminalHeightPercent) : 100}
                  size={showTerminalPane ? Math.max(35, 100 - terminalHeightPercent) : 100}
                  minSize={35}
                  className="app-shell-panel-motion"
                >
                  {transcriptAndDiffPanels}
                </ResizablePanel>
                <ResizableHandle
                  className={cn(
                    'h-0 after:top-0 after:h-3 after:translate-y-0 transition-opacity',
                    !showTerminalPane && 'pointer-events-none opacity-0',
                  )}
                  onDragging={onTerminalDragStateChange}
                />
                <ResizablePanel
                  defaultSize={terminalHeightPercent}
                  size={showTerminalPane ? terminalHeightPercent : 0}
                  minSize={showTerminalPane ? TERMINAL_MIN_SIZE : 0}
                  maxSize={showTerminalPane ? TERMINAL_MAX_SIZE : 0}
                  onResize={onTerminalResize}
                  className={cn(
                    'app-shell-panel-motion',
                    !showTerminalPane && 'pointer-events-none',
                  )}
                >
                  <div
                    className={cn(
                      'h-full min-h-0 w-full app-shell-sidebar-content-motion',
                      showTerminalPane ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
                    )}
                  >
                    {terminalBridge && terminalPaneThreadId ? (
                      <TerminalPane
                        threadId={terminalPaneThreadId}
                        bridge={terminalBridge}
                        visible={showTerminalPane}
                        onClose={onCloseTerminalPane}
                      />
                    ) : null}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
