import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { PanelLeft } from 'lucide-react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { InputApprovalDock } from '../../components/InputApprovalDock'
import { LeftRail } from '../../components/LeftRail'
import { TranscriptPane } from '../../components/TranscriptPane'
import { WorktreeDiffPane, type DiffFilePatchPayload, type DiffSnapshot } from '../../components/WorktreeDiffPane'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../components/ui/resizable'
import { cn } from '../../lib/utils'
import { SettingsPane } from '../../components/SettingsPane'
import type { PendingInput, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadViewModel } from '../core/threadViewModel'
import { DEFAULT_OPEN_TARGET_OPTIONS, type OpenTargetOption, type UpdateUserSetting, type UserSettings } from '../core/userSettings'
import { useI18n } from '../i18n/I18nProvider'
import type { ReplMode } from '../../semantics'
import { RIGHT_RAIL_MAX_SIZE, RIGHT_RAIL_MIN_SIZE, SIDEBAR_MAX_SIZE, SIDEBAR_MIN_SIZE } from '../core/constants'
import { clampRightRailWidth, clampSidebarWidth } from './usePaneLayout'

const MemoLeftRail = memo(LeftRail)
const MemoTranscriptPane = memo(TranscriptPane)
const MemoInputApprovalDock = memo(InputApprovalDock)
const MemoWorktreeDiffPane = memo(WorktreeDiffPane)

type DesktopBridge = NonNullable<Window['formaxDesktop']>
type DesktopWindowAppearanceState = {
  revision: number
  windowTransparencyEnabled: boolean
}

const DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE: DesktopWindowAppearanceState = {
  revision: 0,
  windowTransparencyEnabled: true,
}

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.formaxDesktop ?? null
}

function normalizeDesktopWindowAppearanceState(payload: unknown): DesktopWindowAppearanceState {
  if (!payload || typeof payload !== 'object') return DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE
  const candidate = payload as Partial<DesktopWindowAppearanceState>
  const revisionRaw = candidate.revision
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw) && revisionRaw >= 0 ? Math.floor(revisionRaw) : 0
  const windowTransparencyEnabled = candidate.windowTransparencyEnabled === true
  return {
    revision,
    windowTransparencyEnabled,
  }
}

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
  rightRailWidth: number
  setSidebarWidth: Dispatch<SetStateAction<number>>
  setRightRailWidth: Dispatch<SetStateAction<number>>
  isSettingsOpen: boolean
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>
  activeThreadTitle: string
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
  const desktopBridge = useMemo(() => readDesktopBridge(), [])
  const isDesktopClient = desktopBridge != null
  const [desktopWindowAppearanceState, setDesktopWindowAppearanceState] = useState<DesktopWindowAppearanceState>(
    DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE,
  )
  const [availableOpenTargets, setAvailableOpenTargets] = useState<OpenTargetOption[]>(DEFAULT_OPEN_TARGET_OPTIONS)
  const [isWindowTransparencyPending, setIsWindowTransparencyPending] = useState(false)
  const isWindowTransparent = desktopWindowAppearanceState.windowTransparencyEnabled
  const sidebarPercent = props.sidebarWidth
  const sidebarMinPercent = SIDEBAR_MIN_SIZE
  const sidebarMaxPercent = SIDEBAR_MAX_SIZE
  const rightRailPercent = props.rightRailWidth
  const rightRailMinPercent = RIGHT_RAIL_MIN_SIZE
  const rightRailMaxPercent = RIGHT_RAIL_MAX_SIZE
  const centerPercent = Math.max(0, 100 - rightRailPercent)
  const pendingSidebarPercentRef = useRef(sidebarPercent)
  const pendingRightRailPercentRef = useRef(rightRailPercent)
  const isLeftDraggingRef = useRef(false)
  const isRightDraggingRef = useRef(false)
  const windowTransparencyCommandQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingWindowTransparencyCommandsRef = useRef(0)
  const windowTransparencyIntentRef = useRef(isWindowTransparent)
  const latestWindowTransparencyEnabledRef = useRef(isWindowTransparent)
  const panelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const lastOpenSidebarWidthRef = useRef(clampSidebarWidth(sidebarPercent))
  const previousSidebarOpenRef = useRef(props.isSidebarOpen)
  const showDevLoadAllButton = props.devLoadAllEnabled === true
  const sidebarPanelSize = props.isSidebarOpen ? sidebarPercent : 0
  const centerDefaultSize = 100 - sidebarPanelSize
  const devLoadAllDisabled = !props.activeThreadId || !props.onDevLoadAllEarlier || props.devLoadAllRunning
  const shouldKeepSystemAwake =
    props.userSettings.preventSleep && (props.isSending || props.isInterrupting || props.activeTurnId != null)

  useEffect(() => {
    if (!props.isSidebarOpen) return
    lastOpenSidebarWidthRef.current = clampSidebarWidth(props.sidebarWidth)
  }, [props.isSidebarOpen, props.sidebarWidth])

  useEffect(() => {
    latestWindowTransparencyEnabledRef.current = isWindowTransparent
    if (pendingWindowTransparencyCommandsRef.current === 0) {
      windowTransparencyIntentRef.current = isWindowTransparent
    }
  }, [isWindowTransparent])

  useEffect(() => {
    const panelGroup = panelGroupRef.current
    if (!panelGroup) return
    if (previousSidebarOpenRef.current === props.isSidebarOpen) return
    previousSidebarOpenRef.current = props.isSidebarOpen
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!props.isSidebarOpen) {
      panelGroup.setLayout([0, 100])
      return
    }

    const restoredSidebarWidth = clampSidebarWidth(lastOpenSidebarWidthRef.current)
    panelGroup.setLayout([restoredSidebarWidth, Math.max(0, 100 - restoredSidebarWidth)])
  }, [props.isSidebarOpen])

  const commitSidebarWidth = useCallback((nextSidebarWidth: number) => {
    props.setSidebarWidth((previous) => (Math.abs(nextSidebarWidth - previous) >= 1 ? nextSidebarWidth : previous))
  }, [props.setSidebarWidth])

  const commitRightRailWidth = useCallback((nextRightRailWidth: number) => {
    props.setRightRailWidth((previous) =>
      Math.abs(nextRightRailWidth - previous) >= 1 ? nextRightRailWidth : previous,
    )
  }, [props.setRightRailWidth])

  const onLeftResize = useCallback((sidebarSizePercent: number) => {
    if (!props.isSidebarOpen) return
    const clampedSidebar = clampSidebarWidth(sidebarSizePercent)
    pendingSidebarPercentRef.current = clampedSidebar
    if (!isLeftDraggingRef.current && Math.abs(clampedSidebar - props.sidebarWidth) >= 1) {
      commitSidebarWidth(clampedSidebar)
    }
  }, [commitSidebarWidth, props.isSidebarOpen, props.sidebarWidth])

  const onRightResize = useCallback((rightSizePercent: number) => {
    const clampedRight = clampRightRailWidth(rightSizePercent)
    pendingRightRailPercentRef.current = clampedRight
    if (!isRightDraggingRef.current && Math.abs(clampedRight - props.rightRailWidth) >= 1) {
      commitRightRailWidth(clampedRight)
    }
  }, [commitRightRailWidth, props.rightRailWidth])

  const onLeftDragStateChange = useCallback((isDragging: boolean) => {
    isLeftDraggingRef.current = isDragging
    if (isDragging) return
    if (!props.isSidebarOpen) return
    const clampedSidebar = pendingSidebarPercentRef.current
    if (Math.abs(clampedSidebar - props.sidebarWidth) >= 1) {
      commitSidebarWidth(clampedSidebar)
    }
  }, [commitSidebarWidth, props.isSidebarOpen, props.sidebarWidth])

  const onRightDragStateChange = useCallback((isDragging: boolean) => {
    isRightDraggingRef.current = isDragging
    if (isDragging) return
    const clampedRight = pendingRightRailPercentRef.current
    if (Math.abs(clampedRight - props.rightRailWidth) >= 1) {
      commitRightRailWidth(clampedRight)
    }
  }, [commitRightRailWidth, props.rightRailWidth])

  const onToggleSidebar = useCallback(() => {
    if (props.isSidebarOpen) {
      lastOpenSidebarWidthRef.current = clampSidebarWidth(props.sidebarWidth)
      props.setIsSidebarOpen(false)
      return
    }

    const restoredSidebarWidth = clampSidebarWidth(lastOpenSidebarWidthRef.current)
    props.setSidebarWidth(restoredSidebarWidth)
    props.setIsSidebarOpen(true)
  }, [props.isSidebarOpen, props.setIsSidebarOpen, props.setSidebarWidth, props.sidebarWidth])

  const onDevLoadAllEarlier = useCallback(() => {
    props.onDevLoadAllEarlier?.()
  }, [props.onDevLoadAllEarlier])

  const onOpenSettings = useCallback(() => {
    props.setIsSettingsOpen(true)
  }, [props.setIsSettingsOpen])

  const onCloseSettings = useCallback(() => {
    props.setIsSettingsOpen(false)
  }, [props.setIsSettingsOpen])

  const commitHostWindowAppearanceState = useCallback((payload: unknown) => {
    const normalizedState = normalizeDesktopWindowAppearanceState(payload)
    setDesktopWindowAppearanceState((previous) =>
      normalizedState.revision >= previous.revision ? normalizedState : previous,
    )
    if (pendingWindowTransparencyCommandsRef.current === 0) {
      windowTransparencyIntentRef.current = normalizedState.windowTransparencyEnabled
    }
  }, [])

  const onToggleWindowTransparency = useCallback(() => {
    if (!isDesktopClient) return
    const setWindowTransparency = desktopBridge?.windowAppearance?.setWindowTransparency
    if (!setWindowTransparency) return
    const nextEnabled = !windowTransparencyIntentRef.current
    windowTransparencyIntentRef.current = nextEnabled

    pendingWindowTransparencyCommandsRef.current += 1
    setIsWindowTransparencyPending(true)

    const nextCommand = windowTransparencyCommandQueueRef.current
      .then(async () => {
        const nextState = await setWindowTransparency(nextEnabled)
        commitHostWindowAppearanceState(nextState)
      })
      .catch(() => {
        // Ignore transient desktop-bridge failures and keep latest known host state.
      })
      .finally(() => {
        pendingWindowTransparencyCommandsRef.current = Math.max(0, pendingWindowTransparencyCommandsRef.current - 1)
        if (pendingWindowTransparencyCommandsRef.current === 0) {
          setIsWindowTransparencyPending(false)
          windowTransparencyIntentRef.current = latestWindowTransparencyEnabledRef.current
        }
      })

    windowTransparencyCommandQueueRef.current = nextCommand.then(() => undefined, () => undefined)
  }, [commitHostWindowAppearanceState, desktopBridge, isDesktopClient])

  useEffect(() => {
    if (!isDesktopClient) return
    const windowAppearance = desktopBridge?.windowAppearance
    if (!windowAppearance) return
    let isDisposed = false

    const syncInitialState = async () => {
      if (!windowAppearance.getState) return
      try {
        const state = await windowAppearance.getState()
        if (isDisposed) return
        commitHostWindowAppearanceState(state)
      } catch {
        // Keep renderer fallback state when desktop bridge get-state is unavailable.
      }
    }

    void syncInitialState()

    const unsubscribe = windowAppearance.subscribe?.((state) => {
      if (isDisposed) return
      commitHostWindowAppearanceState(state)
    })

    return () => {
      isDisposed = true
      unsubscribe?.()
    }
  }, [commitHostWindowAppearanceState, desktopBridge, isDesktopClient])

  useEffect(() => {
    if (!isDesktopClient) return
    const root = document.documentElement
    root.dataset.windowTransparency = isWindowTransparent ? 'on' : 'off'
  }, [isDesktopClient, isWindowTransparent])

  useEffect(() => {
    if (!isDesktopClient) return
    const root = document.documentElement
    return () => {
      delete root.dataset.windowTransparency
    }
  }, [isDesktopClient])

  useEffect(() => {
    if (!isDesktopClient) return
    const setPreventSleep = desktopBridge?.powerManagement?.setPreventSleep
    if (!setPreventSleep) return
    void setPreventSleep(shouldKeepSystemAwake).catch(() => {
      // Keep UI responsive if desktop power-management bridge is unavailable.
    })
  }, [desktopBridge, isDesktopClient, shouldKeepSystemAwake])

  useEffect(() => {
    if (!isDesktopClient) return
    const listAvailableOpenTargets = desktopBridge?.openTargets?.listAvailable
    if (!listAvailableOpenTargets) return
    let cancelled = false
    void listAvailableOpenTargets()
      .then((targets) => {
        if (cancelled) return
        if (!Array.isArray(targets) || targets.length === 0) {
          setAvailableOpenTargets(DEFAULT_OPEN_TARGET_OPTIONS)
          return
        }
        setAvailableOpenTargets(
          targets
            .filter((target): target is OpenTargetOption => Boolean(target?.id) && Boolean(target?.label))
            .map((target) => ({ id: target.id, label: target.label })),
        )
      })
      .catch(() => {
        if (cancelled) return
        setAvailableOpenTargets(DEFAULT_OPEN_TARGET_OPTIONS)
      })
    return () => {
      cancelled = true
    }
  }, [desktopBridge, isDesktopClient])

  useEffect(() => {
    if (availableOpenTargets.length === 0) return
    const hasConfiguredTarget = availableOpenTargets.some((target) => target.id === props.userSettings.defaultOpenTarget)
    if (hasConfiguredTarget) return
    props.onUserSettingChange('defaultOpenTarget', availableOpenTargets[0]!.id)
  }, [availableOpenTargets, props.onUserSettingChange, props.userSettings.defaultOpenTarget])

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
      onRefreshDiff: props.onRefreshDiff,
      onRequestPatch: props.onRequestDiffPatch,
      isRefreshingDiff: props.isRefreshingDiff,
      showHeader: true as const,
    }),
    [
      props.diffSnapshot,
      props.isRefreshingDiff,
      props.onRefreshDiff,
      props.onRequestDiffPatch,
    ],
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
            {!props.isSettingsOpen && (
              <header
                className={cn(
                  'h-[var(--desktop-chrome-height)] flex-none border-b app-shell-right-header',
                  isDesktopClient && 'app-shell-drag-region',
                )}
              >
              <div
                className={cn(
                  'h-full min-w-0 flex items-center px-4 app-shell-header-row-motion',
                  isDesktopClient && !props.isSidebarOpen && 'app-shell-header-row-shifted',
                )}
              >
                <div className="flex-1 min-w-0 flex items-center gap-3">
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
                  <div className="min-w-0 flex flex-col leading-tight">
                    <div className="truncate ui-text-base font-semibold text-foreground">{props.activeThreadTitle}</div>
                    <div className="ui-text-meta text-muted-foreground/80 truncate">
                      {isDesktopClient ? t('appShell.desktopWorkspace') : t('appShell.webWorkspace')}
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {isDesktopClient ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('appShell.toggleWindowTransparency')}
                      aria-pressed={isWindowTransparent}
                      aria-busy={isWindowTransparencyPending ? 'true' : undefined}
                      className="h-8 px-2 ui-text-meta text-muted-foreground hover:text-foreground app-shell-no-drag"
                      onClick={onToggleWindowTransparency}
                    >
                      {isWindowTransparencyPending
                        ? t('appShell.updatingWindow')
                        : (isWindowTransparent ? t('appShell.windowSolid') : t('appShell.windowTransparent'))}
                    </Button>
                  ) : null}
                  {showDevLoadAllButton ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="header-dev-load-all-earlier"
                      className={cn(
                        'h-8 px-2 ui-text-meta text-muted-foreground hover:text-foreground',
                        isDesktopClient && 'app-shell-no-drag',
                      )}
                      onClick={onDevLoadAllEarlier}
                      disabled={devLoadAllDisabled}
                    >
                      {props.devLoadAllRunning ? t('appShell.loadingAllEarlierDev') : t('appShell.loadAllEarlierDev')}
                    </Button>
                  ) : null}
                  {props.activeTurnId ? (
                    <div className="rounded-full border border-border bg-background px-2.5 py-1 ui-text-meta font-medium text-muted-foreground">
                      {t('appShell.turnBadge', { id: props.activeTurnId.slice(0, 8) })}
                    </div>
                  ) : null}
                  <div className="rounded-full bg-muted px-2.5 py-1 ui-text-meta font-medium text-muted-foreground">
                    {props.connectionStatus}
                  </div>
                </div>
              </div>
              </header>
            )}

            {props.isSettingsOpen ? (
              <div className="flex-1 min-h-0 min-w-0 flex flex-col pt-10">
                <SettingsPane
                  settings={props.userSettings}
                  onSettingChange={props.onUserSettingChange}
                  availableOpenTargets={availableOpenTargets}
                />
              </div>
            ) : (
              <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 min-w-0">
                <ResizablePanel defaultSize={centerPercent} minSize={35}>
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
                className="relative z-[120] w-0 after:left-0 after:w-3 after:translate-x-0"
                onDragging={onRightDragStateChange}
              />

              <ResizablePanel
                defaultSize={rightRailPercent}
                minSize={rightRailMinPercent}
                maxSize={rightRailMaxPercent}
                onResize={onRightResize}
              >
                <div
                  data-testid="right-rail"
                  className="h-full min-w-0 app-shell-right-rail overflow-hidden overflow-x-hidden"
                >
                  <MemoWorktreeDiffPane {...worktreeDiffPaneProps} />
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
