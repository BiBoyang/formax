import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { appReducer, initialAppState } from '../store'
import type { RpcClientQueueMetrics } from '../rpcClient'
import {
  resetSequencedNotificationOwner,
  shouldAcceptSequencedNotification,
  type SequencedNotificationOwner,
} from '../turnEventCursor'
import {
  DEFAULT_BRIDGE_URL,
  SEEN_EVENT_CAP,
} from './core/constants'
import { resolveRpcQueueRuntimeConfig } from './core/rpcQueueConfig'
import { parseRuntimeDefaultsResponse, parseThreadGroupHideResponse } from './core/rpcContracts'
import {
  toRpcError,
} from './core/threadTransforms'
import { isTranscriptVirtualizationEnabled } from './core/transcriptVirtualization'
import type { AppShellProps } from './ui/AppShell'
import { usePaneLayout } from './ui/usePaneLayout'
import { createDefaultRuntimePorts, type RuntimePorts } from './ports'
import { applyRpcQueueMetricsDelta } from './runtime/rpcQueueMetrics'
import type { SelectThreadOptions } from './runtime/threadActions'
import { usePendingInputUiState } from './runtime/usePendingInputUiState'
import { createThreadDataOps } from './runtime/threadDataOps'
import { createDiffDataOps } from './runtime/diffDataOps'
import { createThreadUiHandlers } from './runtime/threadUiHandlers'
import { createComposerUiHandlers } from './runtime/composerUiHandlers'
import { createDiffUiHandlers } from './runtime/diffUiHandlers'
import { runAsyncSafely } from './runtime/runAsyncSafely'
import { useRuntimeViewState } from './runtime/useRuntimeViewState'
import { useRuntimeEventOrchestrator } from './runtime/useRuntimeEventOrchestrator'
import { useRuntimeActionsBundle } from './runtime/useRuntimeActionsBundle'
import { buildAppShellProps, type BuildAppShellPropsArgs } from './runtime/buildAppShellProps'
import { selectActiveContextMeterView } from './core/contextMeterSelectors'
import { useRpcConnectionEffect } from './runtime/useRpcConnectionEffect'
import { useThreadSelection } from './runtime/useThreadSelection'
import { useRuntimeRefSync } from './runtime/useRuntimeRefSync'
import { useRpcRequest } from './runtime/useRpcRequest'
import {
  useRpcRefs,
  useThreadSnapshotRefs,
  useHistoryRefs,
  useThreadCacheRefs,
  useThreadRuntimeRefs,
} from './runtime/useRuntimeRefs'
import { useThreadModeCache } from './runtime/useThreadModeCache'
import { useInitializeHandshake } from './runtime/useInitializeHandshake'
import { pruneThreadScopedRefs } from './runtime/threadScopedRefs'
import { useDevRuntimeApi } from './runtime/useDevRuntimeApi'
import { useDevLoadAllHistory } from './runtime/useDevLoadAllHistory'
import { useTranscriptDisplayState } from './runtime/useTranscriptDisplayState'
import { useThreadUrlSync } from './runtime/useThreadUrlSync'
import { useUserSettings } from './runtime/useUserSettings'
import {
  type ArchiveThreadLike,
} from '../semantics'
import {
  isDevPerformanceEnabled,
} from './core/devPerformance'
import { deriveVisibleSurface } from './runtime/newThreadDraft'
import {
  DEFAULT_RUNTIME_PREFERENCES,
  preferenceTargetKey,
  resolvePreferenceWriteTarget,
  resolveRuntimePreferenceView,
  resolveThreadPreferencePatchForDefaults,
  type RuntimeModelTier,
  type RuntimePreferenceView,
  type RuntimeThinkingEffort,
  type RuntimePreferenceWriteTarget,
} from './runtime/runtimePreferences'
import type { ThreadRuntimePreferences } from '../semantics'

function resolveBridgeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_BRIDGE_URL
  const fromRuntimeConfig = (window as Window & { __FORMAX_BRIDGE_URL__?: unknown }).__FORMAX_BRIDGE_URL__
  if (typeof fromRuntimeConfig === 'string' && fromRuntimeConfig.trim()) {
    return fromRuntimeConfig
  }
  const envBridgeUrl = import.meta.env.VITE_FORMAX_BRIDGE_URL
  if (typeof envBridgeUrl === 'string' && envBridgeUrl.trim()) return envBridgeUrl
  const desktopBridgePort = window.formaxDesktop?.bridgePort
  if (typeof desktopBridgePort === 'number' && Number.isInteger(desktopBridgePort) && desktopBridgePort >= 1 && desktopBridgePort <= 65535) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const hostname = window.location.hostname || '127.0.0.1'
    return `${protocol}//${hostname}:${desktopBridgePort}`
  }
  return DEFAULT_BRIDGE_URL
}

function applyDraftRuntimePreferencePatch(
  previous: Partial<RuntimePreferenceView>,
  patch: Partial<RuntimePreferenceView>,
  defaults: RuntimePreferenceView,
): Partial<RuntimePreferenceView> {
  const next = { ...previous }
  if (patch.modelTier !== undefined) {
    if (patch.modelTier === defaults.modelTier) delete next.modelTier
    else next.modelTier = patch.modelTier
  }
  if (patch.thinkingMode !== undefined) {
    if (patch.thinkingMode === defaults.thinkingMode) delete next.thinkingMode
    else next.thinkingMode = patch.thinkingMode
  }
  if (patch.thinkingEffort !== undefined) {
    if (patch.thinkingEffort === defaults.thinkingEffort) delete next.thinkingEffort
    else next.thinkingEffort = patch.thinkingEffort
  }
  return next
}

function isDevRuntime(): boolean {
  return import.meta.env.DEV
}

function parseEffectiveProfileProvider(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const root = value as { effectiveProfile?: unknown }
  const profile = root.effectiveProfile
  if (!profile || typeof profile !== 'object') return null
  const provider = (profile as { provider?: unknown }).provider
  return typeof provider === 'string' ? provider : null
}

export function useAppRuntime(ports?: RuntimePorts): AppShellProps {
  const runtimePorts = useMemo(() => ports ?? createDefaultRuntimePorts(), [ports])
  const devRuntime = useMemo(() => isDevRuntime(), [])
  const [bridgeUrl] = useState(resolveBridgeUrl)
  const [rpcQueueConfig] = useState(resolveRpcQueueRuntimeConfig)
  const [runtimeUi, setRuntimeUi] = useState({ showContextMeter: true })
  const [runtimeDefaults, setRuntimeDefaults] = useState<RuntimePreferenceView>(DEFAULT_RUNTIME_PREFERENCES)
  const [runtimeDefaultProvider, setRuntimeDefaultProvider] = useState<string | null>(null)
  const [thinkingEffortCapabilityProvider, setThinkingEffortCapabilityProvider] = useState<string | null>(null)
  const [threadRuntimeProviderByThreadId, setThreadRuntimeProviderByThreadId] = useState<Record<string, string>>({})
  const [newThreadDraftRuntimePreferences, setNewThreadDraftRuntimePreferences] = useState<Partial<RuntimePreferenceView>>({})
  const [runtimePreferenceRevision, setRuntimePreferenceRevision] = useState(0)
  const [state, dispatch] = useReducer(appReducer, initialAppState)
  const { isSidebarOpen, setIsSidebarOpen, sidebarWidth, setSidebarWidth, isRightRailOpen, setIsRightRailOpen, rightRailWidth, setRightRailWidth, isSettingsOpen, setIsSettingsOpen } =
    usePaneLayout()
  const { userSettings, updateUserSetting } = useUserSettings()
  const {
    inputText,
    diffSnapshot,
    isThreadActionBusy,
    isSendingTurn,
    isInterruptingTurn,
    isSubmittingInput,
    isRefreshingDiff,
    noticeMessage,
    mode,
    selectedCwd,
    newThreadDraft,
    hiddenGroupCwds,
    logsByThreadId,
    latestCompactBoundaryByThreadId,
    durableSnipByThreadId,
    latestRequestCollapseByThreadId,
    pendingSessionMemoryRestoreByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    setDiffSnapshot,
    setHistoryLoadingByThreadId,
    setInputTextStable,
    setIsThreadActionBusyStable,
    setIsSendingTurnStable,
    setIsInterruptingTurnStable,
    setIsSubmittingInputStable,
    setIsRefreshingDiffStable,
    setModeStable,
    setSelectedCwdStable,
    enterNewThreadDraft: enterNewThreadDraftState,
    leaveNewThreadDraft,
    setNewThreadDraftCwdStable,
    setNoticeMessageStable,
    setHiddenGroupCwdsStable,
    setLogsByThreadId,
    setHistoryCursorByThreadId,
    setTranscriptSourceByThreadId,
    setLatestCompactBoundaryByThreadId,
    setDurableSnipByThreadId,
    setLatestRequestCollapseByThreadId,
    setPendingSessionMemoryRestoreByThreadId,
  } = useRuntimeViewState()

  // Refs 分组（130+ 行 → 6 行）
  const rpcRefs = useRpcRefs()
  const threadSnapshotRefs = useThreadSnapshotRefs(
    state.activeThreadId,
    state.threads,
    selectedCwd,
    state.selectedInputId,
    state.logs
  )
  const historyRefs = useHistoryRefs(historyCursorByThreadId)
  const threadCacheRefs = useThreadCacheRefs(
    logsByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    durableSnipByThreadId,
    latestRequestCollapseByThreadId,
    pendingSessionMemoryRestoreByThreadId,
  )
  const threadRuntimeRefs = useThreadRuntimeRefs()

  // 展开使用（如果需要）
  const { clientRef, eventCursorRef, commandByTurnRef } = rpcRefs
  const { activeThreadIdRef, threadsRef, selectedCwdRef, selectedInputIdRef, stateLogsRef } = threadSnapshotRefs
  const { historyLoadTokenRef, historyLoadSeqByThreadRef, historyLoadingRef, historyCursorByThreadIdRef } = historyRefs
  const {
    logsByThreadIdRef,
    transcriptSourceByThreadRef,
    latestCompactBoundaryByThreadIdRef,
    durableSnipByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    pendingSessionMemoryRestoreByThreadIdRef,
  } = threadCacheRefs
  const { replayCursorByThreadRef, replayAnomalyCountSeenByThreadRef, runtimeStateByThreadRef } = threadRuntimeRefs

  // 其他 Refs（不在分组中）
  const pendingArchiveOpsRef = useRef<Map<string, { threadId: string; thread: ArchiveThreadLike | null }>>(new Map())
  const createdThreadCwdByIdRef = useRef<Record<string, string | null>>({})
  const rpcQueueMetricsRef = useRef<RpcClientQueueMetrics | null>(null)
  const pendingPreferenceUpdateByTargetRef = useRef<Map<string, Promise<void>>>(new Map())
  const threadRuntimeHydrationEpochByThreadRef = useRef<Record<string, number>>({})
  const threadRuntimePreferencesRef = useRef<Record<string, ThreadRuntimePreferences>>({})
  const selectThreadRef = useRef<(threadId: string, options?: SelectThreadOptions) => void>(() => undefined)
  const seenStaleInputIdRef = useRef<Set<string>>(new Set())
  const activeTurnIdRef = useRef<string | null>(state.activeTurnId)
  const pendingInputsRef = useRef(state.pendingInputs)
  const diffRequestSeqRef = useRef(0)
  const transcriptVirtualizationEnabled = useMemo(
    () => isTranscriptVirtualizationEnabled({ isDevRuntime: devRuntime }),
    [devRuntime],
  )
  const devPerfEnabled = useMemo(() => isDevPerformanceEnabled({ isDevRuntime: devRuntime }), [devRuntime])
  const visibleSurface = useMemo(
    () => deriveVisibleSurface({ activeThreadId: state.activeThreadId, newThreadDraft }),
    [newThreadDraft, state.activeThreadId],
  )
  const newThreadDraftRef = useRef(newThreadDraft)
  newThreadDraftRef.current = newThreadDraft
  const newThreadDraftRuntimePreferencesRef = useRef(newThreadDraftRuntimePreferences)
  newThreadDraftRuntimePreferencesRef.current = newThreadDraftRuntimePreferences
  const replaceNewThreadDraftRuntimePreferences = useCallback((next: Partial<RuntimePreferenceView>) => {
    newThreadDraftRuntimePreferencesRef.current = next
    setNewThreadDraftRuntimePreferences(next)
  }, [])
  const resolveThreadOwnedDiffCwd = useCallback(() => {
    const activeThreadId = activeThreadIdRef.current
    if (!activeThreadId) return null
    const activeThread = threadsRef.current.find((thread) => thread.id === activeThreadId)
    return activeThread?.cwd ?? createdThreadCwdByIdRef.current[activeThreadId] ?? null
  }, [activeThreadIdRef, threadsRef])
  const clearThreadOnlySurfaceState = useCallback(() => {
    diffRequestSeqRef.current += 1
    setDiffSnapshot(null)
    setIsRefreshingDiffStable(false)
  }, [setIsRefreshingDiffStable])
  const {
    activeHistoryLoading,
    activeLogs,
    activeThread,
    activeThreadTitle,
    activeThreadLatestCompactBoundary,
    activeThreadLatestRequestCollapse,
    historyMore,
  } = useTranscriptDisplayState({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    logs: state.logs,
    logsByThreadId,
    historyCursorByThreadId,
    historyLoadingByThreadId,
    transcriptSourceByThreadId,
    latestCompactBoundaryByThreadId,
    latestRequestCollapseByThreadId,
    displayPolicy: 'debug',
  })

  const pruneThreadScopedRuntimeRefs = useCallback(
    (threads: Array<{ id: string }>) => {
      const preservedThreadIds = Array.from(
        new Set(
          Array.from(pendingArchiveOpsRef.current.values())
            .map((entry) => entry.threadId)
            .filter((threadId) => threadId.length > 0),
        ),
      )
      pruneThreadScopedRefs({
        threadIds: threads.map((thread) => thread.id),
        preservedThreadIds,
        replayCursorByThreadRef,
        replayAnomalyCountSeenByThreadRef,
        runtimeStateByThreadRef,
      })
      const validThreadIds = new Set(threads.map((thread) => thread.id))
      for (const threadId of preservedThreadIds) {
        validThreadIds.add(threadId)
      }
      threadRuntimePreferencesRef.current = Object.fromEntries(
        Object.entries(threadRuntimePreferencesRef.current).filter(([threadId]) => validThreadIds.has(threadId)),
      )
    },
    [],
  )

  useEffect(() => {
    pruneThreadScopedRuntimeRefs(state.threads)
  }, [pruneThreadScopedRuntimeRefs, state.threads])

  const log = useCallback((text: string, level: 'info' | 'warn' | 'error' = 'info', turnId?: string) => {
    dispatch({ type: 'push_log', text, level, turnId })
  }, [])

  const onRpcQueueMetrics = useCallback(
    (metrics: RpcClientQueueMetrics) => {
      applyRpcQueueMetricsDelta({ metrics, metricsRef: rpcQueueMetricsRef, log })
    },
    [log],
  )
  const { lastRpcError, captureError, request } = useRpcRequest({ clientRef, log })
  const { cacheThreadMode } = useThreadModeCache({
    runtimeStateByThreadRef,
    nowIso: runtimePorts.nowIso,
  })
  const onInitializeResult = useCallback((result: { ui: { showContextMeter: boolean } }) => {
    setRuntimeUi((previous) =>
      previous.showContextMeter === result.ui.showContextMeter
        ? previous
        : { showContextMeter: result.ui.showContextMeter },
    )
  }, [])
  const { initializeHandshake } = useInitializeHandshake({ clientRef, onInitializeResult })

  const setThreadRuntimePreferences = useCallback(
    (threadId: string, preferences: ThreadRuntimePreferences | undefined) => {
      if (preferences === undefined) return
      const existing = runtimeStateByThreadRef.current[threadId]
      threadRuntimePreferencesRef.current[threadId] = preferences
      if (existing) {
        runtimeStateByThreadRef.current[threadId] = {
          ...existing,
          preferences,
        }
      }
      setRuntimePreferenceRevision((revision) => revision + 1)
    },
    [runtimeStateByThreadRef],
  )

  const loadRuntimeDefaults = useCallback(async () => {
    try {
      const result = await request('config/runtimeDefaults/read')
      const parsed = parseRuntimeDefaultsResponse(result)
      setRuntimeDefaults(resolveRuntimePreferenceView({
        globalDefaults: DEFAULT_RUNTIME_PREFERENCES,
        threadPreferences: parsed.effective,
      }))
      setRuntimeDefaultProvider(parsed.profile?.provider ?? null)
      setThinkingEffortCapabilityProvider(parsed.capabilities?.thinkingEffort?.provider ?? null)
    } catch {
      // Keep local startup defaults when the server does not expose runtime defaults.
    }
  }, [request])

  const rememberThreadRuntimeProvider = useCallback((threadId: string, provider: string | null) => {
    if (!provider) return
    setThreadRuntimeProviderByThreadId((previous) =>
      previous[threadId] === provider
        ? previous
        : { ...previous, [threadId]: provider },
    )
  }, [])

  const bumpThreadRuntimeHydrationEpoch = useCallback((threadId: string): number => {
    const next = (threadRuntimeHydrationEpochByThreadRef.current[threadId] ?? 0) + 1
    threadRuntimeHydrationEpochByThreadRef.current[threadId] = next
    return next
  }, [])

  useEffect(() => {
    const threadId = state.activeThreadId
    if (!threadId) return
    const hydrationEpoch = bumpThreadRuntimeHydrationEpoch(threadId)
    let cancelled = false
    void (async () => {
      try {
        const result = await request('thread/runtimeState/read', { threadId })
        if (
          cancelled ||
          threadRuntimeHydrationEpochByThreadRef.current[threadId] !== hydrationEpoch
        ) return
        const preferences = (result && typeof result === 'object' && 'state' in result)
          ? (result as { state?: { preferences?: ThreadRuntimePreferences } }).state?.preferences
          : undefined
        setThreadRuntimePreferences(threadId, preferences)
        rememberThreadRuntimeProvider(threadId, parseEffectiveProfileProvider(result))
      } catch {
        // Best-effort runtime profile hydration; existing preferences remain usable.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bumpThreadRuntimeHydrationEpoch, rememberThreadRuntimeProvider, request, setThreadRuntimePreferences, state.activeThreadId])

  const shouldProcessSequencedNotification = useCallback(
    (params: unknown, owner: SequencedNotificationOwner): boolean => {
      return shouldAcceptSequencedNotification(eventCursorRef.current, params, owner)
    },
    [],
  )
  const resetSequencedNotificationOwnerState = useCallback(
    (owner: SequencedNotificationOwner): void => {
      resetSequencedNotificationOwner(eventCursorRef.current, owner)
    },
    [],
  )

  const {
    selectedInput,
    selectedAskDraft,
    selectedAskPageIndex,
    isSelectedAskOpen,
    composerLocked,
    submitStatus,
    setSubmitStatusByInputId,
    setAskDockOpenByInputId,
    setAskDraftByInputId,
    setAskPageIndexByInputId,
    onAskOpen,
    onAskPageChange,
    onAskDraftChange,
    syncPendingInputsFromReplayState,
  } = usePendingInputUiState({
    pendingInputs: state.pendingInputs,
    selectedInputId: state.selectedInputId,
    dispatch,
    activeThreadIdRef,
    selectedInputIdRef,
  })

  const {
    refreshThreads,
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    loadThreadHistory,
    resumeThreadInputs,
    loadEarlierHistory: loadEarlierHistoryAction,
  } = useMemo(
    () =>
      createThreadDataOps({
        request,
        dispatch,
        log,
        activeThreadIdRef,
        historyLoadTokenRef,
        historyLoadSeqByThreadRef,
        historyLoadingRef,
        historyCursorByThreadIdRef,
        transcriptSourceByThreadRef,
        latestCompactBoundaryByThreadIdRef,
        durableSnipByThreadIdRef,
        latestRequestCollapseByThreadIdRef,
        pendingSessionMemoryRestoreByThreadIdRef,
        logsByThreadIdRef,
        stateLogsRef,
        seenStaleInputIdRef,
        cacheThreadRuntimePreferences: setThreadRuntimePreferences,
        setHistoryLoadingByThreadId,
        setHistoryCursorByThreadId,
        setTranscriptSourceByThreadId,
        setLatestCompactBoundaryByThreadId,
        setDurableSnipByThreadId,
        setLatestRequestCollapseByThreadId,
        setPendingSessionMemoryRestoreByThreadId,
        setLogsByThreadId,
        setHiddenGroupCwds: setHiddenGroupCwdsStable,
      }),
    [log, request, setDurableSnipByThreadId, setHiddenGroupCwdsStable, setLatestRequestCollapseByThreadId],
  )

  const { refreshWorkspaceDiff, requestDiffFilePatch } = useMemo(
    () =>
      createDiffDataOps({
        request,
        setIsRefreshingDiff: setIsRefreshingDiffStable,
        setDiffSnapshot,
        canRefreshDiff: () =>
          newThreadDraftRef.current.status !== 'active' && activeThreadIdRef.current != null,
        resolveDiffCwd: resolveThreadOwnedDiffCwd,
        beginDiffRequest: () => {
          diffRequestSeqRef.current += 1
          return diffRequestSeqRef.current
        },
        isCurrentDiffRequest: (requestId) => requestId === diffRequestSeqRef.current,
        shouldAcceptDiffResult: ({ requestId, cwd }) => {
          if (requestId !== diffRequestSeqRef.current) return false
          if (newThreadDraftRef.current.status === 'active') return false
          const currentCwd = resolveThreadOwnedDiffCwd()
          return currentCwd === cwd
        },
      }),
    [request, resolveThreadOwnedDiffCwd, setIsRefreshingDiffStable],
  )

  const hideThreadGroup = useCallback(
    async (cwd: string) => {
      const nextCwd = cwd.trim()
      if (!nextCwd) return
      const result = await request('thread/group/hide', { cwd: nextCwd })
      setHiddenGroupCwdsStable(parseThreadGroupHideResponse(result))
    },
    [request, setHiddenGroupCwdsStable],
  )

  const { handleNotification, replayThreadEvents } = useRuntimeEventOrchestrator({
    devPerfEnabled,
    request,
    dispatch,
    log,
    cacheThreadMode,
    onThreadRuntimePreferencesChanged: setThreadRuntimePreferences,
    refreshThreads,
    refreshWorkspaceDiff,
    setMode: setModeStable,
    setAskDockOpenByInputId,
    setAskPageIndexByInputId,
    setAskDraftByInputId,
    setSubmitStatusByInputId,
    shouldProcessSequencedNotification,
    resetSequencedNotificationOwner: resetSequencedNotificationOwnerState,
    runtimeStateByThreadRef,
    replayCursorByThreadRef,
    replayAnomalyCountSeenByThreadRef,
    activeThreadIdRef,
    commandByTurnRef,
    logsByThreadIdRef,
    stateLogsRef,
    transcriptSourceByThreadRef,
    historyCursorByThreadIdRef,
    latestCompactBoundaryByThreadIdRef,
    durableSnipByThreadIdRef,
    latestRequestCollapseByThreadIdRef,
    pendingSessionMemoryRestoreByThreadIdRef,
    setLatestCompactBoundaryByThreadId,
    setDurableSnipByThreadId,
    setLatestRequestCollapseByThreadId,
    setPendingSessionMemoryRestoreByThreadId,
    setLogsByThreadId,
    setHistoryCursorByThreadId,
    setThreadTranscriptSource,
    clearThreadHistoryCursor,
    syncPendingInputsFromReplayState,
    loadThreadHistory,
    archivedHandlerDeps: {
      pruneThreadScopedRuntimeRefs,
      setNoticeMessage: setNoticeMessageStable,
      setSelectedCwd: setSelectedCwdStable,
      selectThreadRef,
      threadsRef,
      pendingArchiveOpsRef,
    },
  })
  const { sortedThreads, cwdOptions } = useThreadSelection({
    threads: state.threads,
    activeThreadId: state.activeThreadId,
    selectedCwd,
    setSelectedCwd: setSelectedCwdStable,
    suspendAutoSelection: newThreadDraft.status === 'active',
  })
  const sortedThreadsRef = useRef(sortedThreads)
  const activeContextMeter = useMemo(() => selectActiveContextMeterView(state), [state])

  useRuntimeRefSync({
    activeThreadId: state.activeThreadId,
    activeTurnId: state.activeTurnId,
    activeTurnIdRef,
    pendingInputs: state.pendingInputs,
    pendingInputsRef,
    sortedThreads,
    sortedThreadsRef,
    logs: state.logs,
    logsByThreadId,
    logsByThreadIdRef,
    setLogsByThreadId,
  })

  const activeRuntimePreferences = useMemo(() => {
    const threadPreferences =
      visibleSurface === 'thread' && state.activeThreadId
        ? threadRuntimePreferencesRef.current[state.activeThreadId]
        : visibleSurface === 'newThreadDraft'
          ? newThreadDraftRuntimePreferences
        : null
    return resolveRuntimePreferenceView({
      globalDefaults: runtimeDefaults,
      threadPreferences: threadPreferences as ThreadRuntimePreferences | null,
    })
  }, [newThreadDraftRuntimePreferences, runtimeDefaults, runtimePreferenceRevision, runtimeStateByThreadRef, state.activeThreadId, visibleSurface])

  const activeRuntimeProvider =
    visibleSurface === 'thread' && state.activeThreadId
      ? threadRuntimeProviderByThreadId[state.activeThreadId] ?? null
      : runtimeDefaultProvider
  const thinkingEffortSupported =
    thinkingEffortCapabilityProvider !== null &&
    activeRuntimeProvider === thinkingEffortCapabilityProvider

  const rememberPendingPreferenceUpdate = useCallback((target: RuntimePreferenceWriteTarget, promise: Promise<void>) => {
    const key = preferenceTargetKey(target)
    pendingPreferenceUpdateByTargetRef.current.set(key, promise)
    promise.finally(() => {
      if (pendingPreferenceUpdateByTargetRef.current.get(key) === promise) {
        pendingPreferenceUpdateByTargetRef.current.delete(key)
      }
    })
  }, [])

  const patchRuntimePreferences = useCallback(
    (patch: Partial<RuntimePreferenceView>) => {
      const target = resolvePreferenceWriteTarget({ visibleSurface, activeThreadId: state.activeThreadId })
      const promise = (async () => {
        if (target.kind === 'newThreadDraft') {
          replaceNewThreadDraftRuntimePreferences(applyDraftRuntimePreferencePatch(
            newThreadDraftRuntimePreferencesRef.current,
            patch,
            runtimeDefaults,
          ))
          return
        }
        if (target.kind === 'thread') {
          bumpThreadRuntimeHydrationEpoch(target.threadId)
          const threadPatch = resolveThreadPreferencePatchForDefaults(patch, runtimeDefaults)
          const result = await request('thread/runtimeState/patch', {
            threadId: target.threadId,
            patch: { preferences: threadPatch },
          })
          const preferences = (result && typeof result === 'object' && 'state' in result)
            ? (result as { state?: { preferences?: ThreadRuntimePreferences } }).state?.preferences
            : undefined
          const fallbackPreferences = { ...threadRuntimePreferencesRef.current[target.threadId] }
          if (Object.prototype.hasOwnProperty.call(threadPatch, 'modelTier')) {
            if (threadPatch.modelTier === null) {
              delete fallbackPreferences.modelTier
            } else if (threadPatch.modelTier !== undefined) {
              fallbackPreferences.modelTier = threadPatch.modelTier
            }
          }
          if (Object.prototype.hasOwnProperty.call(threadPatch, 'thinkingMode')) {
            if (threadPatch.thinkingMode === null) {
              delete fallbackPreferences.thinkingMode
            } else if (threadPatch.thinkingMode !== undefined) {
              fallbackPreferences.thinkingMode = threadPatch.thinkingMode
            }
          }
          if (Object.prototype.hasOwnProperty.call(threadPatch, 'thinkingEffort')) {
            if (threadPatch.thinkingEffort === null) {
              delete fallbackPreferences.thinkingEffort
            } else if (threadPatch.thinkingEffort !== undefined) {
              fallbackPreferences.thinkingEffort = threadPatch.thinkingEffort
            }
          }
          setThreadRuntimePreferences(target.threadId, preferences ?? fallbackPreferences)
          rememberThreadRuntimeProvider(target.threadId, parseEffectiveProfileProvider(result))
          return
        }
        const result = await request('config/runtimeDefaults/patch', patch)
        const parsed = parseRuntimeDefaultsResponse(result)
        setRuntimeDefaults(resolveRuntimePreferenceView({
          globalDefaults: DEFAULT_RUNTIME_PREFERENCES,
          threadPreferences: parsed.effective,
        }))
        setRuntimeDefaultProvider(parsed.profile?.provider ?? null)
        setThinkingEffortCapabilityProvider(parsed.capabilities?.thinkingEffort?.provider ?? null)
      })().catch(async (error) => {
        const details = toRpcError(
          target.kind === 'thread'
            ? 'thread/runtimeState/patch'
            : target.kind === 'newThreadDraft'
              ? 'draft/runtimePreferences'
              : 'config/runtimeDefaults/patch',
          error,
        )
        log(`Runtime preference update failed: ${details.message}`, 'error')
        if (target.kind === 'thread') {
          try {
            const result = await request('thread/runtimeState/read', { threadId: target.threadId })
            const preferences = (result && typeof result === 'object' && 'state' in result)
              ? (result as { state?: { preferences?: ThreadRuntimePreferences } }).state?.preferences
              : undefined
            setThreadRuntimePreferences(target.threadId, preferences)
            rememberThreadRuntimeProvider(target.threadId, parseEffectiveProfileProvider(result))
          } catch {
            // best-effort rehydrate after failed preference patch
          }
        } else {
          await loadRuntimeDefaults()
        }
        throw error
      })
      rememberPendingPreferenceUpdate(target, promise)
      void promise.catch(() => undefined)
      return promise
    },
    [
      loadRuntimeDefaults,
      log,
      bumpThreadRuntimeHydrationEpoch,
      rememberThreadRuntimeProvider,
      rememberPendingPreferenceUpdate,
      replaceNewThreadDraftRuntimePreferences,
      request,
      runtimeDefaults,
      setThreadRuntimePreferences,
      state.activeThreadId,
      threadRuntimePreferencesRef,
      visibleSurface,
    ],
  )

  const awaitPreferencePersistence = useCallback(async () => {
    const target = resolvePreferenceWriteTarget({ visibleSurface, activeThreadId: activeThreadIdRef.current })
    const pending = pendingPreferenceUpdateByTargetRef.current.get(preferenceTargetKey(target))
    if (pending) await pending
  }, [activeThreadIdRef, visibleSurface])

  const persistDraftRuntimePreferences = useCallback(async (threadId: string) => {
    const draftPreferences = newThreadDraftRuntimePreferencesRef.current
    if (Object.keys(draftPreferences).length === 0) return
    bumpThreadRuntimeHydrationEpoch(threadId)
    const threadPatch = resolveThreadPreferencePatchForDefaults(draftPreferences, runtimeDefaults)
    if (Object.keys(threadPatch).length === 0) return
    const result = await request('thread/runtimeState/patch', {
      threadId,
      patch: { preferences: threadPatch },
    })
    const preferences = (result && typeof result === 'object' && 'state' in result)
      ? (result as { state?: { preferences?: ThreadRuntimePreferences } }).state?.preferences
      : undefined
    setThreadRuntimePreferences(threadId, preferences ?? (draftPreferences as ThreadRuntimePreferences))
    replaceNewThreadDraftRuntimePreferences({})
    rememberThreadRuntimeProvider(threadId, parseEffectiveProfileProvider(result))
  }, [
    bumpThreadRuntimeHydrationEpoch,
    rememberThreadRuntimeProvider,
    replaceNewThreadDraftRuntimePreferences,
    request,
    runtimeDefaults,
    setThreadRuntimePreferences,
  ])

  const onModelTierChange = useCallback((modelTier: RuntimeModelTier) => {
    void patchRuntimePreferences({ modelTier })
  }, [patchRuntimePreferences])

  const onThinkingModeChange = useCallback((thinkingMode: boolean) => {
    void patchRuntimePreferences({ thinkingMode })
  }, [patchRuntimePreferences])

  const onThinkingEffortChange = useCallback((thinkingEffort: RuntimeThinkingEffort) => {
    void patchRuntimePreferences({ thinkingEffort })
  }, [patchRuntimePreferences])

  const {
    selectThread,
    selectCwd,
    renameThread,
    archiveThread,
    loadEarlierHistory,
    interruptTurn,
    cancelInputById,
    submitInputById,
    onSend,
  } = useRuntimeActionsBundle({
    core: {
      request,
      dispatch,
      log,
    },
    thread: {
      selectedCwdRef,
      setSelectedCwd: setSelectedCwdStable,
      createdThreadCwdByIdRef,
      activeThreadIdRef,
      activeTurnIdRef,
      selectedInputIdRef,
      pendingInputsRef,
      stateLogsRef,
      threadsRef,
      sortedThreadsRef,
      logsByThreadIdRef,
      setLogsByThreadId,
      runtimeStateByThreadRef,
      cacheThreadMode,
      replayCursorByThreadRef,
      setMode: setModeStable,
      setIsThreadActionBusy: setIsThreadActionBusyStable,
      replayThreadEvents,
      resumeThreadInputs,
      refreshThreads,
      refreshWorkspaceDiff,
      pendingArchiveOpsRef,
      pruneThreadScopedRuntimeRefs,
      loadEarlierHistoryAction,
      selectThreadRef,
    },
    composer: {
      inputText,
      setInputText: setInputTextStable,
      isSendingTurn,
      isInterruptingTurn,
      isSubmittingInput,
      mode,
      activeThreadId: state.activeThreadId,
      activeTurnId: state.activeTurnId,
      newThreadDraft,
      commandByTurnRef,
      setIsSendingTurn: setIsSendingTurnStable,
      setIsInterruptingTurn: setIsInterruptingTurnStable,
      setIsSubmittingInput: setIsSubmittingInputStable,
      setSubmitStatusByInputId,
      toRpcError,
      nowMs: runtimePorts.nowMs,
      leaveNewThreadDraft,
      newThreadDraftRef,
      awaitPreferencePersistence,
      persistDraftRuntimePreferences,
    },
  })

  const enterNewThreadDraft = useCallback((args: { source: 'newThread' | 'addProject' | 'folderQuickAction'; cwd?: string | null }) => {
    const requestedCwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : null
    const fallbackDraftCwd = requestedCwd ?? null

    enterNewThreadDraftState({
      ...args,
      cwd: fallbackDraftCwd,
    })
    replaceNewThreadDraftRuntimePreferences({})
    clearThreadOnlySurfaceState()
    setSelectedCwdStable(fallbackDraftCwd)
    setModeStable('normal')
    activeThreadIdRef.current = null
    dispatch({ type: 'set_active_thread', threadId: null })
    dispatch({ type: 'set_active_turn', turnId: null })
    dispatch({ type: 'clear_pending_inputs' })
    dispatch({ type: 'replace_logs', logs: [] })
  }, [activeThreadIdRef, clearThreadOnlySurfaceState, dispatch, enterNewThreadDraftState, replaceNewThreadDraftRuntimePreferences, setModeStable])

  useEffect(() => {
    if (state.activeThreadId) return
    if (newThreadDraft.status === 'active') return
    clearThreadOnlySurfaceState()
    setSelectedCwdStable(null)
    replaceNewThreadDraftRuntimePreferences({})
    enterNewThreadDraftState({ source: 'newThread', cwd: null })
  }, [
    clearThreadOnlySurfaceState,
    enterNewThreadDraftState,
    newThreadDraft.status,
    replaceNewThreadDraftRuntimePreferences,
    state.activeThreadId,
    setSelectedCwdStable,
  ])

  const selectThreadWithDraftExit = useCallback((threadId: string, options?: SelectThreadOptions) => {
    leaveNewThreadDraft()
    selectThread(threadId, options)
  }, [leaveNewThreadDraft, selectThread])

  useThreadUrlSync({
    activeThreadId: state.activeThreadId,
    threads: state.threads,
    selectThread: selectThreadWithDraftExit,
  })

  const { running: devLoadAllRunning, requestStart: requestDevLoadAll } = useDevLoadAllHistory({
    enabled: devRuntime,
    activeThreadId: state.activeThreadId,
    activeHistoryLoading,
    historyMore,
    loadEarlierHistory,
  })

  useDevRuntimeApi({
    dispatch,
    activeThreadId: state.activeThreadId,
    activeTurnId: state.activeTurnId,
    enabled: devRuntime,
    clientRef,
  })

  useRpcConnectionEffect({
    bridgeUrl,
    seenEventCap: SEEN_EVENT_CAP,
    dispatch,
    initializeHandshake,
    loadRuntimeDefaults,
    refreshThreads,
    refreshWorkspaceDiff,
    resumeThreadInputs,
    replayThreadEvents,
    activeThreadIdRef,
    handleNotification,
    captureError,
    onQueueMetrics: onRpcQueueMetrics,
    rpcQueueConfig,
    clientRef,
    eventCursorRef,
  })

  const threadUiHandlers = useMemo(
    () =>
      createThreadUiHandlers({
        selectCwd,
        selectThread: selectThreadWithDraftExit,
        renameThread,
        archiveThread,
        enterNewThreadDraft: () => enterNewThreadDraft({ source: 'newThread' }),
        enterNewThreadDraftInCwd: (cwd) => enterNewThreadDraft({ source: 'folderQuickAction', cwd }),
        hideThreadGroup,
        runAsyncSafely,
      }),
    [
      archiveThread,
      enterNewThreadDraft,
      hideThreadGroup,
      renameThread,
      selectCwd,
      selectThreadWithDraftExit,
    ],
  )

  const composerUiHandlers = useMemo(
    () =>
      createComposerUiHandlers({
        setMode: setModeStable,
        cacheThreadMode,
        activeThreadIdRef,
        onSend,
        interruptTurn,
        cancelInputById,
        loadEarlierHistory,
        submitInputById,
        requestDevLoadAll,
        runAsyncSafely,
      }),
    [
      cacheThreadMode,
      cancelInputById,
      interruptTurn,
      loadEarlierHistory,
      onSend,
      requestDevLoadAll,
      setModeStable,
      submitInputById,
    ],
  )

  const diffUiHandlers = useMemo(
    () =>
      createDiffUiHandlers({
        refreshWorkspaceDiff,
        requestDiffFilePatch,
        runAsyncSafely,
      }),
    [refreshWorkspaceDiff, requestDiffFilePatch],
  )

  const threadSection = useMemo<BuildAppShellPropsArgs['thread']>(
    () => ({
      sortedThreads,
      selectedCwd,
      onSelectCwd: threadUiHandlers.onSelectCwd,
      activeThreadId: state.activeThreadId,
      onSelectThread: threadUiHandlers.onSelectThread,
      onRenameThread: threadUiHandlers.onRenameThread,
      onArchiveThread: threadUiHandlers.onArchiveThread,
      onEnterNewThreadDraft: threadUiHandlers.onEnterNewThreadDraft,
      onEnterNewThreadDraftInCwd: threadUiHandlers.onEnterNewThreadDraftInCwd,
      onEnterAddProjectDraft: () => enterNewThreadDraft({ source: 'addProject' }),
      hiddenGroupCwds,
      onHideThreadGroup: threadUiHandlers.onHideThreadGroup,
      isThreadActionBusy,
    }),
    [enterNewThreadDraft, hiddenGroupCwds, isThreadActionBusy, selectedCwd, sortedThreads, state.activeThreadId, threadUiHandlers],
  )

  const layoutSection = useMemo<BuildAppShellPropsArgs['layout']>(
    () => ({
      isSidebarOpen,
      setIsSidebarOpen,
      sidebarWidth,
      isRightRailOpen,
      setIsRightRailOpen,
      rightRailWidth,
      setSidebarWidth,
      setRightRailWidth,
      isSettingsOpen,
      setIsSettingsOpen,
    }),
    [isSidebarOpen, rightRailWidth, setIsSidebarOpen, isRightRailOpen, setIsRightRailOpen, setRightRailWidth, setSidebarWidth, sidebarWidth, isSettingsOpen, setIsSettingsOpen],
  )

  const transcriptSection = useMemo<BuildAppShellPropsArgs['transcript']>(
    () => ({
      activeThreadTitle,
      activeThreadLatestCompactBoundary,
      activeThreadLatestRequestCollapse,
      activeContextMeter,
      showContextMeter: runtimeUi.showContextMeter,
      activeTurnId: state.activeTurnId,
      connectionStatus: state.connectionStatus,
      activeThread,
      transcriptVirtualizationEnabled,
      composerLocked,
      visibleSurface,
      draftCwd: newThreadDraft.status === 'active' ? newThreadDraft.cwd : null,
      draftCwdOptions: cwdOptions,
      onDraftCwdChange: setNewThreadDraftCwdStable,
      logs: activeLogs,
      pendingTurns: Object.values(state.pendingTurns),
      inputText,
      mode,
      modelTier: activeRuntimePreferences.modelTier,
      thinkingMode: activeRuntimePreferences.thinkingMode,
      thinkingEffort: activeRuntimePreferences.thinkingEffort,
      thinkingEffortSupported,
      onModeChange: composerUiHandlers.onModeChange,
      onModelTierChange,
      onThinkingModeChange,
      onThinkingEffortChange,
      onInputTextChange: setInputTextStable,
      onSend: composerUiHandlers.onSend,
      onInterrupt: composerUiHandlers.onInterrupt,
      historyMore,
      historyLoading: activeHistoryLoading,
      onLoadEarlier: composerUiHandlers.onLoadEarlier,
      devLoadAllEnabled: devRuntime,
      devLoadAllRunning,
      onDevLoadAllEarlier: composerUiHandlers.onDevLoadAllEarlier,
      isSending: isSendingTurn,
      isInterrupting: isInterruptingTurn,
      lastRpcError,
    }),
    [
      activeHistoryLoading,
      activeLogs,
      state.pendingTurns,
      activeThread,
      activeThreadLatestCompactBoundary,
      activeThreadLatestRequestCollapse,
      activeContextMeter,
      activeThreadTitle,
      composerLocked,
      composerUiHandlers,
      cwdOptions,
      devLoadAllRunning,
      devRuntime,
      historyMore,
      inputText,
      isInterruptingTurn,
      isSendingTurn,
      lastRpcError,
      mode,
      activeRuntimePreferences,
      newThreadDraft,
      onModelTierChange,
      onThinkingModeChange,
      onThinkingEffortChange,
      runtimeUi.showContextMeter,
      setInputTextStable,
      setNewThreadDraftCwdStable,
      state.activeTurnId,
      state.connectionStatus,
      transcriptVirtualizationEnabled,
      visibleSurface,
    ],
  )

  const approvalSection = useMemo<BuildAppShellPropsArgs['approval']>(
    () => ({
      selectedInput,
      isSelectedAskOpen,
      selectedAskPageIndex,
      selectedAskDraft,
      submitStatus,
      isSubmittingInput,
      onAskOpen,
      onCancelInput: composerUiHandlers.onCancelInput,
      onAskPageChange,
      onAskDraftChange,
      onSubmitInput: composerUiHandlers.onSubmitInput,
    }),
    [
      composerUiHandlers,
      isSelectedAskOpen,
      isSubmittingInput,
      onAskDraftChange,
      onAskOpen,
      onAskPageChange,
      selectedAskDraft,
      selectedAskPageIndex,
      selectedInput,
      submitStatus,
    ],
  )

  const diffSection = useMemo<BuildAppShellPropsArgs['diff']>(
    () => ({
      diffSnapshot,
      onRefreshDiff: diffUiHandlers.onRefreshDiff,
      onRequestDiffPatch: diffUiHandlers.onRequestDiffPatch,
      isRefreshingDiff,
    }),
    [diffSnapshot, diffUiHandlers, isRefreshingDiff],
  )

  const feedbackSection = useMemo<BuildAppShellPropsArgs['feedback']>(
    () => ({ noticeMessage }),
    [noticeMessage],
  )

  const settingsSection = useMemo<BuildAppShellPropsArgs['settings']>(
    () => ({
      userSettings,
      onUserSettingChange: updateUserSetting,
    }),
    [updateUserSetting, userSettings],
  )

  return useMemo(
    () =>
      buildAppShellProps({
        thread: threadSection,
        layout: layoutSection,
        transcript: transcriptSection,
        approval: approvalSection,
        diff: diffSection,
        feedback: feedbackSection,
        settings: settingsSection,
      }),
    [
      approvalSection,
      diffSection,
      feedbackSection,
      layoutSection,
      settingsSection,
      threadSection,
      transcriptSection,
    ],
  )
}
