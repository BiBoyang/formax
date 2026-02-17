import type { Dispatch, SetStateAction } from 'react'
import { asThreadReplay, type ReplayStateSnapshot } from '../core/rpcParsers'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import { shouldPromoteReplayAsCanonical } from '../core/replayMachine'
import type { ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import { summarizeInvariantIssues } from '../../../../../src/features/semantics/selectors/invariants'

type ReplayResult = ReturnType<typeof asThreadReplay>

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
  request: (method: string, params?: unknown) => Promise<any>
  asThreadReplay: (value: unknown) => ReplayResult
  toRuntimePendingInputsById: (pendingInputs: ReplayStateSnapshot['pendingInputs']) => ThreadRuntimeState['pendingInputs']
  replayCursorByThreadRef: { current: Record<string, number> }
  replayAnomalyCountSeenByThreadRef: { current: Record<string, number> }
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
  activeThreadIdRef: { current: string | null }
  logsByThreadIdRef: { current: Record<string, any[]> }
  stateLogsRef: { current: any[] }
  transcriptSourceByThreadRef: { current: Record<string, ThreadTranscriptSource> }
  dispatch: Dispatch<any>
  setMode: Dispatch<SetStateAction<any>>
  cacheThreadMode: (threadId: string, mode: any) => void
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

  while (pageCount < 100) {
    pageCount += 1
    const result = await ctx.request('thread/replay', { threadId, after, limit: 200 })
    const replay = ctx.asThreadReplay(result)
    latestCursor = replay.latestCursor
    if (replay.state) {
      replayState = replay.state
      maybeLogInvariantIssues(replay.state)
      observeCanonicalProtocolAnomalies(replay.state)
      hydrateRuntimeState(replay.state, replay.latestCursor)
    }

    if (replay.hasGap) {
      if (replay.state?.projection) {
        const rebuildState = commitGapRebuild({
          state: replay.state,
          replayCursor: replay.latestCursor,
          projectionSnapshot: replay.state.projection,
          clearActiveLogs: false,
        })
        if (rebuildState === 'deferred') {
          flushCanonicalProtocolAnomaliesLog()
          return true
        }
        flushCanonicalProtocolAnomaliesLog()
        return true
      }

      const baselineResult = await ctx.request('thread/replay', { threadId })
      const baselineReplay = ctx.asThreadReplay(baselineResult)
      if (baselineReplay.state) {
        maybeLogInvariantIssues(baselineReplay.state)
        observeCanonicalProtocolAnomalies(baselineReplay.state)
        hydrateRuntimeState(baselineReplay.state, baselineReplay.latestCursor)
        replayState = baselineReplay.state
      }
      if (baselineReplay.state?.projection) {
        const rebuildState = commitGapRebuild({
          state: baselineReplay.state,
          replayCursor: baselineReplay.latestCursor,
          projectionSnapshot: baselineReplay.state.projection,
          clearActiveLogs: false,
        })
        if (rebuildState === 'deferred') {
          flushCanonicalProtocolAnomaliesLog()
          return true
        }
        flushCanonicalProtocolAnomaliesLog()
        return true
      }
      commitGapRebuild({
        state: baselineReplay.state ?? null,
        replayCursor: baselineReplay.nextCursor > 0 ? baselineReplay.nextCursor : baselineReplay.latestCursor,
        projectionSnapshot: baselineReplay.state?.projection ?? null,
        clearActiveLogs: true,
      })
      flushCanonicalProtocolAnomaliesLog()
      return true
    }

    if (fromStart && replay.latestCursor === 0 && replay.data.length === 0) {
      const loaded = await ctx.loadThreadHistory(threadId)
      if (!loaded) {
        flushCanonicalProtocolAnomaliesLog()
        return false
      }
      ctx.replayCursorByThreadRef.current[threadId] = 0
      syncActiveThreadRuntimeState(replay.state ?? null)
      flushCanonicalProtocolAnomaliesLog()
      return true
    }

    for (const entry of replay.data) {
      receivedEntries = true
      ctx.handleNotification({
        jsonrpc: '2.0',
        method: entry.method,
        ...(entry.params === undefined ? {} : { params: entry.params }),
      })
    }

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

  if (fromStart && !receivedEntries) {
    const loaded = await ctx.loadThreadHistory(threadId)
    if (!loaded) {
      flushCanonicalProtocolAnomaliesLog()
      return false
    }
  }

  const currentTranscriptSource = ctx.transcriptSourceByThreadRef.current[threadId]
  if (
    shouldPromoteReplayAsCanonical({
      receivedEntries,
      fromStart,
      initialAfter,
      currentTranscriptSource,
    })
  ) {
    ctx.setThreadTranscriptSource(threadId, 'replay')
    ctx.clearThreadHistoryCursor(threadId)
  }

  ctx.replayCursorByThreadRef.current[threadId] = after > 0 ? after : latestCursor
  syncActiveThreadRuntimeState(replayState)
  flushCanonicalProtocolAnomaliesLog()
  return true
}
