import { memo, useCallback, useMemo, useRef } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { InputApprovalDock } from '../../components/InputApprovalDock'
import { LeftRail } from '../../components/LeftRail'
import { TerminalPane } from '../../components/TerminalPane'
import { TranscriptPane } from '../../components/TranscriptPane'
import { WorktreeDiffPane } from '../../components/WorktreeDiffPane'
import type { DiffFilePatchPayload, DiffFilePreviewPayload, DiffSnapshot, ReviewGitSource } from '../../components/diff/diffTypes'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { cn } from '../../lib/utils'
import { SettingsPane } from '../../components/SettingsPane'
import type { CompactBoundarySummary, ContextMeterView, PendingInput, RequestCollapseSummary, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadViewModel } from '../core/threadViewModel'
import { type UpdateUserSetting, type UserSettings } from '../core/userSettings'
import { useI18n } from '../i18n/I18nProvider'
import type { ReplMode } from '../../semantics'
import type { RuntimeModelTier, RuntimeThinkingEffort } from '../runtime/runtimePreferences'
import { RIGHT_RAIL_MAX_SIZE, RIGHT_RAIL_MIN_SIZE, SIDEBAR_MAX_SIZE, SIDEBAR_MIN_SIZE } from '../core/constants'
import { selectThreadTitle } from '../core/threadViewModel'
import { AppShellHeader } from './AppShellHeader'
import { AppShellPaneToggleIcon } from './AppShellPaneToggleIcon'
import { AppShellTopRightControls } from './AppShellTopRightControls'
import { RightRailWorkspaceHeader } from './RightRailWorkspaceHeader'
import { useDesktopBridge } from './useDesktopBridge'
import { usePanelDragCommit } from './usePanelDragCommit'
import { TERMINAL_MAX_SIZE, TERMINAL_MIN_SIZE, useTerminalVisibility } from './useTerminalVisibility'
import type { VisibleSurface } from '../runtime/newThreadDraft'

const MemoLeftRail = memo(LeftRail)
const MemoTranscriptPane = memo(TranscriptPane)
const MemoInputApprovalDock = memo(InputApprovalDock)
const MemoWorktreeDiffPane = memo(WorktreeDiffPane)
const TOP_RIGHT_CONTROLS_OVERLAY_WIDTH = 104

export type AppShellProps = {
  sortedThreads: ThreadViewModel[]
  selectedCwd: string | null
  onSelectCwd: (cwd: string) => void
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, label: string) => void
  onArchiveThread: (threadId: string) => void
  onEnterNewThreadDraft: () => void
  onEnterNewThreadDraftInCwd: (cwd: string) => void
  onEnterAddProjectDraft: () => void
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
  activeThreadLatestCompactBoundary: CompactBoundarySummary | null
  activeThreadLatestRequestCollapse: RequestCollapseSummary | null
  activeContextMeter: ContextMeterView
  showContextMeter: boolean
  activeTurnId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  activeThread: ThreadSummary | undefined
  transcriptVirtualizationEnabled: boolean
  composerLocked: boolean
  visibleSurface: VisibleSurface
  draftCwd: string | null
  draftCwdOptions: string[]
  onDraftCwdChange: (cwd: string) => void
  logs: TranscriptItem[]
  inputText: string
  mode: ReplMode
  modelTier: RuntimeModelTier
  thinkingMode: boolean
  thinkingEffort: RuntimeThinkingEffort
  thinkingEffortSupported: boolean
  onModeChange: (nextMode: ReplMode) => void
  onModelTierChange: (modelTier: RuntimeModelTier) => void
  onThinkingModeChange: (thinkingMode: boolean) => void
  onThinkingEffortChange: (thinkingEffort: RuntimeThinkingEffort) => void
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
  onRefreshDiff: (source?: ReviewGitSource | null) => void
  onRequestDiffPatch: (filePath: string, source?: ReviewGitSource | null) => Promise<DiffFilePatchPayload | null>
  onRequestDiffPreview: (filePath: string, source?: ReviewGitSource | null) => Promise<DiffFilePreviewPayload | null>
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
  const isThreadSurface = props.visibleSurface === 'thread' && props.activeThreadId != null
  const isDraftSurface = props.visibleSurface === 'newThreadDraft'
  const headerWorkspaceCwd = isThreadSurface
    ? props.activeThread?.cwd ?? null
    : isDraftSurface
      ? props.draftCwd
      : null
  const leftRailCurrentGroupCwd = isDraftSurface
    ? props.draftCwd
    : props.selectedCwd ?? props.activeThread?.cwd ?? null
  const headerOpenFolderCwd = headerWorkspaceCwd
  const showThreadRightRail = isThreadSurface && props.isRightRailOpen
  const showDevLoadAllButton = isThreadSurface && props.devLoadAllEnabled === true
  const sidebarPanelSize = props.isSidebarOpen ? sidebarPercent : 0
  const centerDefaultSize = 100 - sidebarPanelSize
  const devLoadAllDisabled = !props.activeThreadId || !props.onDevLoadAllEarlier || props.devLoadAllRunning === true
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
    activeThreadCwd: isThreadSurface ? props.activeThread?.cwd : null,
    activeThreadId: isThreadSurface ? props.activeThreadId : null,
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

  const onDraftAddProject = useCallback(async () => {
    if (!desktopBridge?.pickProjectFolder) return
    const nextCwd = await desktopBridge.pickProjectFolder()
    if (!nextCwd) return
    props.onDraftCwdChange(nextCwd)
  }, [desktopBridge, props])

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
      currentGroupCwd: leftRailCurrentGroupCwd,
      selectedCwd: props.visibleSurface === 'newThreadDraft' ? null : props.selectedCwd,
      onSelectCwd: props.onSelectCwd,
      activeThreadId: isThreadSurface ? props.activeThreadId : null,
      onSelectThread: props.onSelectThread,
      onRenameThread: props.onRenameThread,
      onArchiveThread: props.onArchiveThread,
      onEnterNewThreadDraft: props.onEnterNewThreadDraft,
      onEnterNewThreadDraftInCwd: props.onEnterNewThreadDraftInCwd,
      hiddenGroupCwds: props.hiddenGroupCwds,
      onHideThreadGroup: props.onHideThreadGroup,
      isBusy: props.isThreadActionBusy,
      isDesktopClient,
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
      props.onEnterNewThreadDraft,
      props.onEnterNewThreadDraftInCwd,
      props.onHideThreadGroup,
      props.onRenameThread,
      props.onSelectCwd,
      props.onSelectThread,
      props.selectedCwd,
      props.sortedThreads,
      props.visibleSurface,
      props.isSettingsOpen,
      isDesktopClient,
      isWindowTransparent,
      leftRailCurrentGroupCwd,
      onOpenFolderInTarget,
      openFolderActionLabel,
      onOpenSettings,
      onCloseSettings,
      onToggleWindowTransparency,
    ],
  )

  const transcriptPaneProps = useMemo(
    () => ({
      activeThread: isThreadSurface ? props.activeThread : undefined,
      activeThreadId: isThreadSurface ? props.activeThreadId : null,
      activeTurnId: isThreadSurface ? props.activeTurnId : null,
      composerLocked: isThreadSurface ? props.composerLocked : false,
      surfaceKind: props.visibleSurface,
      draftCwd: props.draftCwd,
      draftCwdOptions: props.draftCwdOptions,
      onDraftCwdChange: props.onDraftCwdChange,
      onDraftAddProject: desktopBridge?.pickProjectFolder ? onDraftAddProject : undefined,
      virtualizationEnabled: props.transcriptVirtualizationEnabled,
      logs: props.logs,
      inputText: props.inputText,
      mode: props.mode,
      modelTier: props.modelTier,
      thinkingMode: props.thinkingMode,
      thinkingEffort: props.thinkingEffort,
      thinkingEffortSupported: props.thinkingEffortSupported,
      onModeChange: props.onModeChange,
      onModelTierChange: props.onModelTierChange,
      onThinkingModeChange: props.onThinkingModeChange,
      onThinkingEffortChange: props.onThinkingEffortChange,
      connectionStatus: props.connectionStatus,
      onInputTextChange: props.onInputTextChange,
      onSend: props.onSend,
      onInterrupt: props.onInterrupt,
      historyMore: isThreadSurface ? props.historyMore : false,
      historyLoading: isThreadSurface ? props.historyLoading : false,
      onLoadEarlier: props.onLoadEarlier,
      devLoadAllActive: isThreadSurface && props.devLoadAllRunning === true,
      isSending: props.isSending,
      isInterrupting: props.isInterrupting,
      lastRpcError: props.lastRpcError,
      longTextRequireCmdEnter: props.userSettings.longTextRequireCmdEnter,
      activeContextMeter: props.activeContextMeter,
      showContextMeter: isThreadSurface && props.showContextMeter,
    }),
    [
      props.activeThread,
      props.activeThreadId,
      props.activeTurnId,
      props.composerLocked,
      props.connectionStatus,
      isThreadSurface,
      props.draftCwd,
      props.draftCwdOptions,
      props.onDraftCwdChange,
      props.devLoadAllRunning,
      props.historyLoading,
      props.historyMore,
      props.inputText,
      props.isInterrupting,
      props.isSending,
      props.lastRpcError,
      props.logs,
      props.mode,
      props.modelTier,
      props.thinkingMode,
      props.thinkingEffort,
      props.thinkingEffortSupported,
      props.onInputTextChange,
      props.onInterrupt,
      props.onLoadEarlier,
      props.onModeChange,
      props.onModelTierChange,
      props.onThinkingModeChange,
      props.onThinkingEffortChange,
      props.onSend,
      props.visibleSurface,
      props.userSettings.longTextRequireCmdEnter,
      props.activeContextMeter,
      props.showContextMeter,
      props.transcriptVirtualizationEnabled,
      desktopBridge,
      onDraftAddProject,
    ],
  )

  const inputApprovalDockProps = useMemo(
    () => ({
      input: isThreadSurface ? props.selectedInput : null,
      isAskOpen: isThreadSurface ? props.isSelectedAskOpen : false,
      askPageIndex: props.selectedAskPageIndex,
      askDraftValues: props.selectedAskDraft,
      submitStatus: isThreadSurface ? props.submitStatus : null,
      isSubmitting: isThreadSurface ? props.isSubmittingInput : false,
      onAskOpen: props.onAskOpen,
      onAskDismiss: props.onAskDismiss,
      onAskPageChange: props.onAskPageChange,
      onAskDraftChange: props.onAskDraftChange,
      onSubmitInput: props.onSubmitInput,
    }),
    [
      isThreadSurface,
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
      activeThreadId: isThreadSurface ? props.activeThreadId : null,
      diffSnapshot: isThreadSurface ? props.diffSnapshot : null,
      latestRequestCollapse: isThreadSurface ? props.activeThreadLatestRequestCollapse : null,
      onRefreshDiff: props.onRefreshDiff,
      onRequestPatch: props.onRequestDiffPatch,
      onRequestPreview: props.onRequestDiffPreview,
      isRefreshingDiff: isThreadSurface ? props.isRefreshingDiff : false,
      showHeader: true as const,
    }),
    [
      props.activeThreadId,
      isThreadSurface,
      props.activeThreadLatestRequestCollapse,
      props.diffSnapshot,
      props.isRefreshingDiff,
      props.onRefreshDiff,
      props.onRequestDiffPatch,
      props.onRequestDiffPreview,
    ],
  )

  const transcriptAndDiffPanels = (
    <ResizablePanelGroup ref={rightRailPanelGroupRef} direction="horizontal" className="flex-1 min-h-0 min-w-0">
      <ResizablePanel defaultSize={props.isRightRailOpen ? centerPercent : 100} minSize={35}>
        <div data-testid="center-pane-host" className="h-full min-w-0 relative flex flex-col">
          <AppShellHeader
            isDesktopClient={isDesktopClient}
            isSidebarOpen={props.isSidebarOpen}
            activeThreadTitle={isThreadSurface ? props.activeThreadTitle : selectThreadTitle(undefined)}
            activeThreadLatestCompactBoundary={isThreadSurface ? props.activeThreadLatestCompactBoundary : null}
            activeThreadLatestRequestCollapse={isThreadSurface ? props.activeThreadLatestRequestCollapse : null}
            showDevLoadAllButton={showDevLoadAllButton}
            devLoadAllDisabled={devLoadAllDisabled}
            devLoadAllRunning={props.devLoadAllRunning}
            onDevLoadAllEarlier={onDevLoadAllEarlier}
            openFolderCwd={headerOpenFolderCwd}
            onOpenFolderInTarget={onOpenFolderInTarget}
            openFolderActionLabel={openFolderActionLabel}
            onToggleSidebar={onToggleSidebar}
            activeTurnId={isThreadSurface ? props.activeTurnId : null}
            rightOverlayInset={isThreadSurface && !showThreadRightRail ? TOP_RIGHT_CONTROLS_OVERLAY_WIDTH : 0}
          />
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
          !showThreadRightRail && 'pointer-events-none opacity-0',
        )}
        onDragging={onRightDragStateChange}
      />

      <ResizablePanel
        defaultSize={rightRailPercent}
        size={showThreadRightRail ? rightRailPercent : 0}
        minSize={showThreadRightRail ? rightRailMinPercent : 0}
        maxSize={showThreadRightRail ? rightRailMaxPercent : 0}
        onResize={onRightResize}
        className={cn(
          'app-shell-panel-motion',
          !showThreadRightRail && 'pointer-events-none',
        )}
      >
        <div
          data-testid="right-rail"
          className={cn(
            'h-full min-w-0 flex flex-col overflow-hidden overflow-x-hidden app-shell-sidebar-content-motion',
            showThreadRightRail && 'app-shell-right-rail',
            showThreadRightRail ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4',
          )}
        >
          {isThreadSurface && showThreadRightRail ? (
            <>
              <RightRailWorkspaceHeader
                isDesktopClient={isDesktopClient}
                controls={
                  <AppShellTopRightControls
                    isRightRailOpen={showThreadRightRail}
                    isTerminalOpen={showTerminalPane}
                    isDesktopClient={isDesktopClient}
                    onToggleRightRail={onToggleRightRail}
                    onToggleTerminal={onToggleTerminal}
                    canToggleTerminal={canToggleTerminal}
                  />
                }
              />
              <div className="min-h-0 min-w-0 flex-1">
                <MemoWorktreeDiffPane {...worktreeDiffPaneProps} />
              </div>
            </>
          ) : null}
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
              'relative h-full min-w-0 flex flex-col',
              props.isSidebarOpen
                ? 'rounded-tl-[22px] rounded-bl-[22px] app-shell-right-surface overflow-hidden'
                : 'app-shell-right-surface',
            )}
          >
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
                      <AppShellPaneToggleIcon side="left" isOpen={props.isSidebarOpen} />
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
      {!props.isSettingsOpen && isThreadSurface && !showThreadRightRail ? (
        <div
          className={cn(
            'absolute right-0 top-0 z-[300] h-[var(--desktop-chrome-height)]',
            isDesktopClient && 'app-shell-drag-region',
          )}
          style={{ width: TOP_RIGHT_CONTROLS_OVERLAY_WIDTH }}
        >
          <AppShellTopRightControls
            isRightRailOpen={showThreadRightRail}
            isTerminalOpen={showTerminalPane}
            isDesktopClient={isDesktopClient}
            onToggleRightRail={onToggleRightRail}
            onToggleTerminal={onToggleTerminal}
            canToggleTerminal={canToggleTerminal}
            className="h-full px-4"
          />
        </div>
      ) : null}
    </div>
  )
}
