import type { Dispatch, SetStateAction } from 'react'
import type { AppAction } from '../../store'
import type { RpcThreadReplayResult } from '../core/rpcContracts'
import type { ReplayStateSnapshot } from '../core/rpcParsers'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import type { CompactBoundarySummary } from '../../types'
import { shouldPromoteReplayAsCanonical } from '../core/replayMachine'
import type { ReplMode, ThreadRuntimeState } from '../../semantics'
import { summarizeInvariantIssues } from '../../semantics'

type ReplayResult = RpcThreadReplayResult

function shouldUseIncrementalReplayData(replay: ReplayResult): boolean {
  return !replay.hasGap
}

function shouldUseHistoryFallbackOnEmptyReplayPage(args: {
  fromStart: boolean
  replay: Pick<ReplayResult, 'latestCursor' | 'data'>
}): boolean {
  if (!args.fromStart) return false
  return args.replay.latestCursor === 0 && args.replay.data.length === 0
}

function shouldUseHistoryFallbackAfterReplayLoop(args: {
  fromStart: boolean
  receivedEntries: boolean
}): boolean {
  return args.fromStart && !args.receivedEntries
}

export function resolveReplayCursorProgress(args: {
  after: number
  nextCursor: number
  latestCursor: number
}): { nextAfter: number; shouldContinue: boolean } {
  const nextAfter = args.nextCursor > 0 ? args.nextCursor : args.latestCursor
  if (nextAfter <= args.after) {
    return { nextAfter, shouldContinue: false }
  }
  if (nextAfter >= args.latestCursor) {
    return { nextAfter, shouldContinue: false }
  }
  return { nextAfter, shouldContinue: true }
}

export type ReplayThreadEventsContext = {
  request: (method: string, params?: unknown) => Promise<unknown>
  parseThreadReplayResponse: (value: unknown) => ReplayResult
  toRuntimePendingInputsById: (pendingInputs: ReplayStateSnapshot['pendingInputs']) => ThreadRuntimeState['pendingInputs']
  replayCursorByThreadRef: { current: Record<string, number> }
  replayAnomalyCountSeenByThreadRef: { current: Record<string, number> }
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  activeThreadIdRef: { current: string | null }
  logsByThreadIdRef: { current: Record<string, unknown[]> }
  stateLogsRef: { current: unknown[] }
  transcriptSourceByThreadRef: { current: Record<string, ThreadTranscriptSource> }
  cacheLatestCompactBoundary: (threadId: string, boundary: CompactBoundarySummary | null | undefined) => void
  dispatch: Dispatch<AppAction>
  setMode: Dispatch<SetStateAction<ReplMode>>
  cacheThreadMode: (threadId: string, mode: ReplMode) => void
  setThreadTranscriptSource: (threadId: string, source: ThreadTranscriptSource) => void
  clearThreadHistoryCursor: (threadId: string) => void
  syncPendingInputsFromReplayState: (threadId: string, replayState: ReplayStateSnapshot | null) => void
  loadThreadHistory: (threadId: string) => Promise<boolean>
  handleNotification: (notification: { jsonrpc: '2.0'; method: string; params?: unknown }) => void
  log: (text: string, level?: 'info' | 'warn' | 'error', turnId?: string) => void
}

export async function replayThreadEvents(
  threadId: string,
  options: { fromStart?: boolean } | undefined,
  ctx: ReplayThreadEventsContext,
): Promise<boolean> {
  const fromStart = options?.fromStart === true
  let after = fromStart ? 0 : (ctx.replayCursorByThreadRef.current[threadId] ?? 0)
  const initialAfter = after
  let latestCursor = after
  let replayState: ReplayStateSnapshot | null = null
  let receivedEntries = false
  let pageCount = 0
  let hasLoggedInvariantIssues = false
  let maxCanonicalProtocolAnomalyCountObserved = 0

  const hydrateRuntimeState = (state: ReplayStateSnapshot, latestReplayCursor: number): void => {
    ctx.runtimeStateByThreadRef.current[threadId] = {
      threadId,
      mode: state.mode,
      activeTurnId: state.activeTurnId,
      lastTurnId: state.lastTurnId,
      lastTurnStatus: state.lastTurnStatus,
      pendingInputs: ctx.toRuntimePendingInputsById(state.pendingInputs),
      toolNameByUseId: state.toolNameByUseId,
      updatedAt: state.updatedAt,
      lastNotificationMethod: null,
      lastReplaySeq: latestReplayCursor,
    }
    if (ctx.activeThreadIdRef.current === threadId && Object.keys(state.toolNameByUseId).length > 0) {
      ctx.dispatch({
        type: 'hydrate_projection_tool_names',
        threadId,
        toolNameByUseId: state.toolNameByUseId,
      })
    }
  }

  const syncActiveThreadRuntimeState = (state: ReplayStateSnapshot | null): void => {
    if (ctx.activeThreadIdRef.current !== threadId) return
    ctx.syncPendingInputsFromReplayState(threadId, state)
    ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
    const nextMode = state?.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
    ctx.setMode(nextMode)
    if (state) {
      ctx.cacheThreadMode(threadId, nextMode)
    }
  }

  const applyReplayCursorAndSource = (nextCursor: number): void => {
    ctx.setThreadTranscriptSource(threadId, 'replay')
    ctx.clearThreadHistoryCursor(threadId)
    ctx.replayCursorByThreadRef.current[threadId] = nextCursor
  }

  const commitReplayTail = (args: {
    replayCursor: number
    promoteReplayAsSource: boolean
    state: ReplayStateSnapshot | null
  }): void => {
    if (args.promoteReplayAsSource) {
      ctx.setThreadTranscriptSource(threadId, 'replay')
      ctx.clearThreadHistoryCursor(threadId)
    }
    ctx.replayCursorByThreadRef.current[threadId] = args.replayCursor
    syncActiveThreadRuntimeState(args.state)
  }

  const shouldDeferProjectionHydration = (projectionSnapshot: ReplayStateSnapshot['projection']): boolean => {
    return Boolean(projectionSnapshot) && ctx.activeThreadIdRef.current !== threadId
  }

  const commitGapRebuild = (args: {
    state: ReplayStateSnapshot | null
    replayCursor: number
    projectionSnapshot: ReplayStateSnapshot['projection']
    clearActiveLogs: boolean
  }): 'applied' | 'deferred' => {
    if (shouldDeferProjectionHydration(args.projectionSnapshot)) {
      return 'deferred'
    }

    if (args.projectionSnapshot) {
      ctx.dispatch({
        type: 'hydrate_projection_snapshot',
        threadId,
        snapshot: args.projectionSnapshot,
      })
    } else if (args.clearActiveLogs && ctx.activeThreadIdRef.current === threadId) {
      ctx.dispatch({ type: 'replace_logs', logs: [] })
    }

    applyReplayCursorAndSource(args.replayCursor)
    syncActiveThreadRuntimeState(args.state)
    return 'applied'
  }

  const maybeLogInvariantIssues = (state: ReplayStateSnapshot | null | undefined): void => {
    if (hasLoggedInvariantIssues) return
    if (!state || state.invariantIssues.length === 0) return
    if (ctx.activeThreadIdRef.current !== threadId) return
    hasLoggedInvariantIssues = true
    const summary = summarizeInvariantIssues(state.invariantIssues)
    ctx.log(`Replay invariant issues detected (${summary})`, 'warn')
  }

  const observeCanonicalProtocolAnomalies = (state: ReplayStateSnapshot | null | undefined): void => {
    if (!state || state.canonicalProtocolAnomalyCount <= 0) return
    if (ctx.activeThreadIdRef.current !== threadId) return
    if (state.canonicalProtocolAnomalyCount <= maxCanonicalProtocolAnomalyCountObserved) return
    maxCanonicalProtocolAnomalyCountObserved = state.canonicalProtocolAnomalyCount
  }

  const flushCanonicalProtocolAnomaliesLog = (): void => {
    if (maxCanonicalProtocolAnomalyCountObserved <= 0) return
    const seen = ctx.replayAnomalyCountSeenByThreadRef.current[threadId] ?? 0
    if (maxCanonicalProtocolAnomalyCountObserved <= seen) return
    ctx.replayAnomalyCountSeenByThreadRef.current[threadId] = maxCanonicalProtocolAnomalyCountObserved
    ctx.log(`Replay canonical protocol anomalies detected (count=${maxCanonicalProtocolAnomalyCountObserved})`, 'warn')
  }

  const fetchReplayPage = async (afterCursor: number): Promise<ReplayResult> => {
    const result = await ctx.request('thread/replay', { threadId, after: afterCursor, limit: 200 })
    return ctx.parseThreadReplayResponse(result)
  }

  const fetchReplayBaseline = async (): Promise<ReplayResult> => {
    const baselineResult = await ctx.request('thread/replay', { threadId })
    return ctx.parseThreadReplayResponse(baselineResult)
  }

  const handleHasGapReplay = async (replay: ReplayResult): Promise<void> => {
    const gapRebuildCursor = replay.latestCursor
    const withGapCursorFloor = (cursor: number): number => Math.max(gapRebuildCursor, cursor)
    if (replay.state?.projection) {
      commitGapRebuild({
        state: replay.state,
        replayCursor: withGapCursorFloor(replay.latestCursor),
        projectionSnapshot: replay.state.projection,
        clearActiveLogs: false,
      })
      return
    }

    const baselineReplay = await fetchReplayBaseline()
    ctx.cacheLatestCompactBoundary(threadId, baselineReplay.latestCompactBoundary)
    if (baselineReplay.state) {
      maybeLogInvariantIssues(baselineReplay.state)
      observeCanonicalProtocolAnomalies(baselineReplay.state)
      hydrateRuntimeState(baselineReplay.state, baselineReplay.latestCursor)
      replayState = baselineReplay.state
    }
    if (baselineReplay.state?.projection) {
      commitGapRebuild({
        state: baselineReplay.state,
        replayCursor: withGapCursorFloor(baselineReplay.latestCursor),
        projectionSnapshot: baselineReplay.state.projection,
        clearActiveLogs: false,
      })
      return
    }

    commitGapRebuild({
      state: baselineReplay.state ?? null,
      replayCursor: withGapCursorFloor(
        baselineReplay.nextCursor > 0 ? baselineReplay.nextCursor : baselineReplay.latestCursor,
      ),
      projectionSnapshot: baselineReplay.state?.projection ?? null,
      clearActiveLogs: true,
    })
  }

  while (pageCount < 100) {
    pageCount += 1
    const replay = await fetchReplayPage(after)
    latestCursor = replay.latestCursor
    if (replay.state) {
      replayState = replay.state
      maybeLogInvariantIssues(replay.state)
      observeCanonicalProtocolAnomalies(replay.state)
      hydrateRuntimeState(replay.state, replay.latestCursor)
    }

    if (replay.hasGap) {
      ctx.cacheLatestCompactBoundary(threadId, replay.latestCompactBoundary)
      await handleHasGapReplay(replay)
      flushCanonicalProtocolAnomaliesLog()
      return true
    }

    if (shouldUseHistoryFallbackOnEmptyReplayPage({ fromStart, replay })) {
      ctx.cacheLatestCompactBoundary(threadId, replay.latestCompactBoundary)
      const loaded = await ctx.loadThreadHistory(threadId)
      if (!loaded) {
        flushCanonicalProtocolAnomaliesLog()
        return false
      }
      commitReplayTail({
        replayCursor: 0,
        promoteReplayAsSource: false,
        state: replay.state ?? null,
      })
      flushCanonicalProtocolAnomaliesLog()
      return true
    }

    const incrementalEntries = shouldUseIncrementalReplayData(replay) ? replay.data : []
    for (const entry of incrementalEntries) {
      receivedEntries = true
      ctx.handleNotification({
        jsonrpc: '2.0',
        method: entry.method,
        ...(entry.params === undefined ? {} : { params: entry.params }),
      })
    }
    ctx.cacheLatestCompactBoundary(threadId, replay.latestCompactBoundary)

    const { nextAfter, shouldContinue } = resolveReplayCursorProgress({
      after,
      nextCursor: replay.nextCursor,
      latestCursor: replay.latestCursor,
    })
    after = nextAfter
    if (!shouldContinue) {
      break
    }
  }

  if (shouldUseHistoryFallbackAfterReplayLoop({ fromStart, receivedEntries })) {
    const loaded = await ctx.loadThreadHistory(threadId)
    if (!loaded) {
      flushCanonicalProtocolAnomaliesLog()
      return false
    }
  }

  const currentTranscriptSource = ctx.transcriptSourceByThreadRef.current[threadId]
  const shouldPromoteReplaySource = shouldPromoteReplayAsCanonical({
    receivedEntries,
    fromStart,
    initialAfter,
    currentTranscriptSource,
  })
  commitReplayTail({
    replayCursor: after > 0 ? after : latestCursor,
    promoteReplayAsSource: shouldPromoteReplaySource,
    state: replayState,
  })
  flushCanonicalProtocolAnomaliesLog()
  return true
}
