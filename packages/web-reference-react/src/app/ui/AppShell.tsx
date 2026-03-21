import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { PendingInput, ThreadSummary, TranscriptItem } from '../../types'
import type { ThreadViewModel } from '../core/threadViewModel'
import { type UpdateUserSetting, type UserSettings } from '../core/userSettings'
import { useI18n } from '../i18n/I18nProvider'
import type { ReplMode } from '../../semantics'
import { RIGHT_RAIL_MAX_SIZE, RIGHT_RAIL_MIN_SIZE, SIDEBAR_MAX_SIZE, SIDEBAR_MIN_SIZE } from '../core/constants'
import { clampRightRailWidth, clampSidebarWidth } from './usePaneLayout'
import { folderNameFromCwd } from '../../components/left-rail/utils'
import { AppShellHeader } from './AppShellHeader'
import { useDesktopBridge } from './useDesktopBridge'

const MemoLeftRail = memo(LeftRail)
const MemoTranscriptPane = memo(TranscriptPane)
const MemoInputApprovalDock = memo(InputApprovalDock)
const MemoWorktreeDiffPane = memo(WorktreeDiffPane)

const TERMINAL_MIN_SIZE = 18
const TERMINAL_MAX_SIZE = 60
const TERMINAL_DEFAULT_SIZE = 32

function clampTerminalHeight(sizePercent: number): number {
  return Math.max(TERMINAL_MIN_SIZE, Math.min(TERMINAL_MAX_SIZE, sizePercent))
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
  const [terminalVisibleByThreadId, setTerminalVisibleByThreadId] = useState<Record<string, boolean>>({})
  const [residentTerminalThreadId, setResidentTerminalThreadId] = useState<string | null>(null)
  const [terminalHeightPercent, setTerminalHeightPercent] = useState(TERMINAL_DEFAULT_SIZE)
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
  const isTerminalDraggingRef = useRef(false)
  const panelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const rightRailPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const terminalPanelGroupRef = useRef<ImperativePanelGroupHandle | null>(null)
  const terminalVisibleByThreadIdRef = useRef<Record<string, boolean>>({})
  const terminalHeightRef = useRef(TERMINAL_DEFAULT_SIZE)
  const knownThreadIdsRef = useRef<Set<string>>(new Set(props.sortedThreads.map((thread) => thread.id)))
  const lastOpenSidebarWidthRef = useRef(clampSidebarWidth(sidebarPercent))
  const lastOpenRightRailWidthRef = useRef(clampRightRailWidth(rightRailPercent))
  const lastOpenTerminalHeightRef = useRef(clampTerminalHeight(TERMINAL_DEFAULT_SIZE))
  const previousSidebarOpenRef = useRef(props.isSidebarOpen)
  const previousRightRailOpenRef = useRef(props.isRightRailOpen)
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
  const activeThreadId = props.activeThreadId
  const activeThreadTerminalVisible = activeThreadId ? terminalVisibleByThreadId[activeThreadId] === true : false
  const showTerminalPane = Boolean(
    isDesktopClient &&
      terminalBridge &&
      activeThreadId &&
      activeThreadTerminalVisible &&
      !props.isSettingsOpen,
  )
  const terminalPaneThreadId = showTerminalPane && activeThreadId ? activeThreadId : residentTerminalThreadId
  const previousTerminalOpenRef = useRef(showTerminalPane)
  const canToggleTerminal = Boolean(isDesktopClient && terminalBridge && activeThreadId)

  useEffect(() => {
    if (!props.isSidebarOpen) return
    lastOpenSidebarWidthRef.current = clampSidebarWidth(props.sidebarWidth)
  }, [props.isSidebarOpen, props.sidebarWidth])

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
    if (!terminalBridge) {
      setResidentTerminalThreadId(null)
      return
    }
    if (!showTerminalPane || !activeThreadId) return
    setResidentTerminalThreadId((previous) => (previous === activeThreadId ? previous : activeThreadId))
  }, [activeThreadId, showTerminalPane, terminalBridge])

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

  useEffect(() => {
    const panelGroup = terminalPanelGroupRef.current
    if (!panelGroup) return
    if (previousTerminalOpenRef.current === showTerminalPane) return
    previousTerminalOpenRef.current = showTerminalPane
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!showTerminalPane) {
      const currentTerminalHeight = currentLayout[1]
      if (typeof currentTerminalHeight === 'number' && Number.isFinite(currentTerminalHeight) && currentTerminalHeight > 0) {
        lastOpenTerminalHeightRef.current = clampTerminalHeight(currentTerminalHeight)
      }
      panelGroup.setLayout([100, 0])
      return
    }

    const restoredTerminalHeight = clampTerminalHeight(lastOpenTerminalHeightRef.current)
    panelGroup.setLayout([Math.max(35, 100 - restoredTerminalHeight), restoredTerminalHeight])
  }, [showTerminalPane])

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

  useEffect(() => {
    terminalVisibleByThreadIdRef.current = terminalVisibleByThreadId
  }, [terminalVisibleByThreadId])

  useEffect(() => {
    terminalHeightRef.current = terminalHeightPercent
  }, [terminalHeightPercent])

  useEffect(() => {
    if (!showTerminalPane) return
    lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightPercent)
  }, [showTerminalPane, terminalHeightPercent])

  const onCloseTerminalPane = useCallback(() => {
    const threadId = props.activeThreadId
    if (!threadId) return
    lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightRef.current)
    setTerminalVisibleByThreadId((previous) => {
      if (previous[threadId] !== true) return previous
      return { ...previous, [threadId]: false }
    })
  }, [props.activeThreadId])

  const onToggleTerminal = useCallback(async () => {
    if (!terminalBridge) return
    const threadId = props.activeThreadId
    if (!threadId) return

    const currentlyVisible = terminalVisibleByThreadIdRef.current[threadId] === true
    if (currentlyVisible) {
      lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightRef.current)
      setTerminalVisibleByThreadId((previous) => ({ ...previous, [threadId]: false }))
      return
    }
    const nextCwd = props.activeThread?.cwd ?? props.selectedCwd ?? undefined
    const result = await terminalBridge.ensureSession(threadId, nextCwd)
    if (!result.exists) return

    const restoredHeight = clampTerminalHeight(lastOpenTerminalHeightRef.current)
    setTerminalHeightPercent(restoredHeight)
    setTerminalVisibleByThreadId((previous) => ({ ...previous, [threadId]: true }))
  }, [props.activeThread?.cwd, props.activeThreadId, props.selectedCwd, terminalBridge])

  const onTerminalDragStateChange = useCallback((isDragging: boolean) => {
    isTerminalDraggingRef.current = isDragging
  }, [])

  const onTerminalResize = useCallback((sizePercent: number) => {
    if (!isTerminalDraggingRef.current) return
    const threadId = props.activeThreadId
    if (!threadId) return
    const activeThreadTerminalVisible = terminalVisibleByThreadIdRef.current[threadId] === true
    if (!activeThreadTerminalVisible || props.isSettingsOpen) return
    if (sizePercent <= 0) return
    const clamped = clampTerminalHeight(sizePercent)
    lastOpenTerminalHeightRef.current = clamped
    setTerminalHeightPercent(clamped)
  }, [props.activeThreadId, props.isSettingsOpen])

  useEffect(() => {
    const currentIds = new Set(props.sortedThreads.map((thread) => thread.id))
    const removedThreadIds = Array.from(knownThreadIdsRef.current).filter((threadId) => !currentIds.has(threadId))
    knownThreadIdsRef.current = currentIds
    if (removedThreadIds.length === 0) return

    if (residentTerminalThreadId && removedThreadIds.includes(residentTerminalThreadId)) {
      setResidentTerminalThreadId(null)
    }

    setTerminalVisibleByThreadId((previous) => {
      let changed = false
      const next: Record<string, boolean> = { ...previous }
      for (const threadId of removedThreadIds) {
        if (threadId in next) {
          delete next[threadId]
          changed = true
        }
      }
      return changed ? next : previous
    })

    if (!terminalBridge) return
    for (const threadId of removedThreadIds) {
      void terminalBridge.destroySession(threadId).catch(() => undefined)
    }
  }, [props.sortedThreads, residentTerminalThreadId, terminalBridge])

  useEffect(() => {
    if (!terminalBridge) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.shiftKey || event.altKey) return
      const isTrigger = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j'
      if (!isTrigger) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        const isEditableTarget =
          target.isContentEditable ||
          tagName === 'input' ||
          tagName === 'textarea' ||
          target.getAttribute('role') === 'textbox'
        if (isEditableTarget) return
      }
      event.preventDefault()
      void onToggleTerminal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onToggleTerminal, terminalBridge])

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
