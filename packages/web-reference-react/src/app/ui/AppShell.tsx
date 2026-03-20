import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  PanelLeft,
  ChevronDown,
  Code,
  Settings,
  ArrowRightLeft,
  GitCommitHorizontal,
  SquareTerminal,
  PlusSquare,
  Copy,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../../components/ui/tooltip'
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
  isRightRailOpen: boolean
  setIsRightRailOpen: Dispatch<SetStateAction<boolean>>
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

const SHARED_HEADER_BTN_ICON = 'h-[26px] w-[26px] px-0 flex items-center justify-center text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground transition-colors rounded-[6px]'
const SHARED_HEADER_BTN_GROUP = 'h-[26px] flex items-center rounded-[6px] border border-border/60 bg-transparent overflow-hidden text-muted-foreground hover:text-foreground transition-colors'
const SHARED_HEADER_BTN_INNER = 'h-full flex items-center justify-center hover:bg-[var(--sidebar-list-hover)] transition-colors'

export function AppShell(props: AppShellProps) {
  const { t } = useI18n()
  const desktopBridge = useMemo(() => readDesktopBridge(), [])
  const isDesktopClient = desktopBridge != null
  const [desktopWindowAppearanceState, setDesktopWindowAppearanceState] = useState<DesktopWindowAppearanceState>(
    DEFAULT_DESKTOP_WINDOW_APPEARANCE_STATE,
  )
  const [availableOpenTargets, setAvailableOpenTargets] = useState<OpenTargetOption[]>(DEFAULT_OPEN_TARGET_OPTIONS)
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
  const rightRailPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const lastOpenSidebarWidthRef = useRef(clampSidebarWidth(sidebarPercent))
  const lastOpenRightRailWidthRef = useRef(clampRightRailWidth(rightRailPercent))
  const previousSidebarOpenRef = useRef(props.isSidebarOpen)
  const previousRightRailOpenRef = useRef(props.isRightRailOpen)
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

  useEffect(() => {
    if (!props.isRightRailOpen) return
    lastOpenRightRailWidthRef.current = clampRightRailWidth(props.rightRailWidth)
  }, [props.isRightRailOpen, props.rightRailWidth])

  useEffect(() => {
    const panelGroup = rightRailPanelGroupRef.current
    if (!panelGroup) return
    if (previousRightRailOpenRef.current === props.isRightRailOpen) return
    previousRightRailOpenRef.current = props.isRightRailOpen
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!props.isRightRailOpen) {
      panelGroup.setLayout([100, 0])
      return
    }

    const restoredRightRailWidth = clampRightRailWidth(lastOpenRightRailWidthRef.current)
    panelGroup.setLayout([Math.max(0, 100 - restoredRightRailWidth), restoredRightRailWidth])
  }, [props.isRightRailOpen])

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
  }, [props.isSidebarOpen])

  const onRightResize = useCallback((rightSizePercent: number) => {
    if (!props.isRightRailOpen) return
    const clampedRight = clampRightRailWidth(rightSizePercent)
    pendingRightRailPercentRef.current = clampedRight
  }, [props.isRightRailOpen])

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
    if (!props.isRightRailOpen) return
    const clampedRight = pendingRightRailPercentRef.current
    if (Math.abs(clampedRight - props.rightRailWidth) >= 1) {
      commitRightRailWidth(clampedRight)
    }
  }, [commitRightRailWidth, props.isRightRailOpen, props.rightRailWidth])

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

  const onToggleRightRail = useCallback(() => {
    if (props.isRightRailOpen) {
      lastOpenRightRailWidthRef.current = clampRightRailWidth(props.rightRailWidth)
      props.setIsRightRailOpen(false)
      return
    }

    const restoredRightRailWidth = clampRightRailWidth(lastOpenRightRailWidthRef.current)
    props.setRightRailWidth(restoredRightRailWidth)
    props.setIsRightRailOpen(true)
  }, [props.isRightRailOpen, props.setIsRightRailOpen, props.setRightRailWidth, props.rightRailWidth])

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
                  'h-[var(--desktop-chrome-height)] flex-none app-shell-right-header',
                  props.isRightRailOpen && 'border-b',
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
                  {showDevLoadAllButton ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="header-dev-load-all-earlier"
                      className={cn(
                        'h-8 px-2 ui-text-meta bg-transparent transition-colors',
                        'text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground',
                        isDesktopClient && 'app-shell-no-drag',
                      )}
                      onClick={onDevLoadAllEarlier}
                      disabled={devLoadAllDisabled}
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
                          className={cn(SHARED_HEADER_BTN_ICON, isDesktopClient && 'app-shell-no-drag')}
                          onClick={onOpenSettings}
                          aria-label="Settings"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[13px]">
                        Settings
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <div className={cn(SHARED_HEADER_BTN_GROUP, isDesktopClient && "app-shell-no-drag")}>
                    <TooltipProvider>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={cn(SHARED_HEADER_BTN_INNER, "px-2 border-r border-border/40")}
                            onClick={() => {
                              if (props.selectedCwd) {
                                onOpenFolderInTarget(props.selectedCwd)
                              }
                            }}
                          >
                            <Code className="h-4 w-4 text-blue-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[13px]">
                          Open in VS Code
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={cn(SHARED_HEADER_BTN_INNER, "px-1.5 text-muted-foreground hover:text-foreground")}>
                          <ChevronDown className="h-3.5 w-3.5 leading-none" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 z-[200]">
                        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => {
                          if (props.selectedCwd) {
                            onOpenFolderInTarget(props.selectedCwd)
                          }
                        }}>
                          <Code className="h-4 w-4 text-muted-foreground" />
                          <span className="text-[13px]">{openFolderActionLabel}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <button
                    type="button"
                    className={cn(
                      SHARED_HEADER_BTN_GROUP,
                      "px-2 gap-1 hover:bg-[var(--sidebar-list-hover)] border-border/60",
                      isDesktopClient && "app-shell-no-drag"
                    )}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    <span className="text-[12px]">移至工作树</span>
                  </button>

                  <div className={cn(SHARED_HEADER_BTN_GROUP, isDesktopClient && "app-shell-no-drag")}>
                    <button
                      type="button"
                      className={cn(SHARED_HEADER_BTN_INNER, "px-2 gap-1 border-r border-border/40")}
                    >
                      <GitCommitHorizontal className="h-3.5 w-3.5" />
                      <span className="text-[12px]">提交</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={cn(SHARED_HEADER_BTN_INNER, "px-1.5")}>
                          <ChevronDown className="h-3.5 w-3.5 leading-none" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 z-[200]">
                        <DropdownMenuItem className="text-[13px] cursor-pointer">
                          Placeholder Action
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="w-px h-4 bg-border/60 mx-1" />

                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(SHARED_HEADER_BTN_ICON, isDesktopClient && "app-shell-no-drag")}
                        >
                          <SquareTerminal className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[13px]">
                        切换终端 ⌘J
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <button
                    type="button"
                    className={cn(
                      'flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] transition-colors select-none',
                      props.isRightRailOpen
                        ? 'bg-[var(--sidebar-list-hover)] text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-[var(--sidebar-list-hover)] hover:text-foreground',
                      isDesktopClient && 'app-shell-no-drag',
                    )}
                    onClick={onToggleRightRail}
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
                          className={cn(SHARED_HEADER_BTN_ICON, isDesktopClient && "app-shell-no-drag")}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[13px]">
                        Open in Popout Window
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
            )}

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
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
