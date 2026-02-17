import type { Dispatch, SetStateAction } from 'react'
import { asThreadReplay, type ReplayStateSnapshot } from '../core/rpcParsers'
import type { ThreadTranscriptSource } from '../core/replayMachine'
import { shouldPromoteReplayAsCanonical } from '../core/replayMachine'
import type { ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import { summarizeInvariantIssues } from '../../../../../src/features/semantics/selectors/invariants'

type ReplayResult = ReturnType<typeof asThreadReplay>

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
      ctx.runtimeStateByThreadRef.current[threadId] = {
        threadId,
        mode: replay.state.mode,
        activeTurnId: replay.state.activeTurnId,
        lastTurnId: replay.state.lastTurnId,
        lastTurnStatus: replay.state.lastTurnStatus,
        pendingInputs: ctx.toRuntimePendingInputsById(replay.state.pendingInputs),
        toolNameByUseId: replay.state.toolNameByUseId,
        updatedAt: replay.state.updatedAt,
        lastNotificationMethod: null,
        lastReplaySeq: replay.latestCursor,
      }
      if (ctx.activeThreadIdRef.current === threadId && Object.keys(replay.state.toolNameByUseId).length > 0) {
        ctx.dispatch({
          type: 'hydrate_projection_tool_names',
          threadId,
          toolNameByUseId: replay.state.toolNameByUseId,
        })
      }
    }

    if (replay.hasGap) {
      if (replay.state?.projection) {
        if (ctx.activeThreadIdRef.current !== threadId) {
          flushCanonicalProtocolAnomaliesLog()
          return true
        }
        ctx.dispatch({
          type: 'hydrate_projection_snapshot',
          threadId,
          snapshot: replay.state.projection,
        })
        ctx.setThreadTranscriptSource(threadId, 'replay')
        ctx.clearThreadHistoryCursor(threadId)
        ctx.replayCursorByThreadRef.current[threadId] = replay.latestCursor
        if (ctx.activeThreadIdRef.current === threadId) {
          ctx.syncPendingInputsFromReplayState(threadId, replay.state)
          ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
          const nextMode = replay.state.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
          ctx.setMode(nextMode)
          ctx.cacheThreadMode(threadId, nextMode)
        }
        flushCanonicalProtocolAnomaliesLog()
        return true
      }

      const baselineResult = await ctx.request('thread/replay', { threadId })
      const baselineReplay = ctx.asThreadReplay(baselineResult)
      if (baselineReplay.state) {
        maybeLogInvariantIssues(baselineReplay.state)
        observeCanonicalProtocolAnomalies(baselineReplay.state)
        ctx.runtimeStateByThreadRef.current[threadId] = {
          threadId,
          mode: baselineReplay.state.mode,
          activeTurnId: baselineReplay.state.activeTurnId,
          lastTurnId: baselineReplay.state.lastTurnId,
          lastTurnStatus: baselineReplay.state.lastTurnStatus,
          pendingInputs: ctx.toRuntimePendingInputsById(baselineReplay.state.pendingInputs),
          toolNameByUseId: baselineReplay.state.toolNameByUseId,
          updatedAt: baselineReplay.state.updatedAt,
          lastNotificationMethod: null,
          lastReplaySeq: baselineReplay.latestCursor,
        }
        replayState = baselineReplay.state
        if (ctx.activeThreadIdRef.current === threadId && Object.keys(baselineReplay.state.toolNameByUseId).length > 0) {
          ctx.dispatch({
            type: 'hydrate_projection_tool_names',
            threadId,
            toolNameByUseId: baselineReplay.state.toolNameByUseId,
          })
        }
      }
      if (baselineReplay.state?.projection) {
        if (ctx.activeThreadIdRef.current !== threadId) {
          flushCanonicalProtocolAnomaliesLog()
          return true
        }
        ctx.dispatch({
          type: 'hydrate_projection_snapshot',
          threadId,
          snapshot: baselineReplay.state.projection,
        })
        ctx.setThreadTranscriptSource(threadId, 'replay')
        ctx.clearThreadHistoryCursor(threadId)
        ctx.replayCursorByThreadRef.current[threadId] = baselineReplay.latestCursor
        ctx.syncPendingInputsFromReplayState(threadId, baselineReplay.state)
        ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
        const nextMode = baselineReplay.state.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
        ctx.setMode(nextMode)
        ctx.cacheThreadMode(threadId, nextMode)
        flushCanonicalProtocolAnomaliesLog()
        return true
      }
      if (ctx.activeThreadIdRef.current === threadId) {
        ctx.dispatch({ type: 'replace_logs', logs: [] })
      }
      ctx.setThreadTranscriptSource(threadId, 'replay')
      ctx.clearThreadHistoryCursor(threadId)
      ctx.replayCursorByThreadRef.current[threadId] =
        baselineReplay.nextCursor > 0 ? baselineReplay.nextCursor : baselineReplay.latestCursor
      if (ctx.activeThreadIdRef.current === threadId) {
        ctx.syncPendingInputsFromReplayState(threadId, baselineReplay.state ?? null)
        ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
        const nextMode = baselineReplay.state?.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
        ctx.setMode(nextMode)
        if (baselineReplay.state) {
          ctx.cacheThreadMode(threadId, nextMode)
        }
      }
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
      if (ctx.activeThreadIdRef.current === threadId) {
        ctx.syncPendingInputsFromReplayState(threadId, replay.state ?? null)
        ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
        const nextMode = replay.state?.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
        ctx.setMode(nextMode)
        if (replay.state) {
          ctx.cacheThreadMode(threadId, nextMode)
        }
      }
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

    const nextAfter = replay.nextCursor > 0 ? replay.nextCursor : replay.latestCursor
    if (nextAfter <= after || nextAfter >= replay.latestCursor) {
      after = nextAfter
      break
    }
    after = nextAfter
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
  if (ctx.activeThreadIdRef.current === threadId) {
    ctx.syncPendingInputsFromReplayState(threadId, replayState)
    ctx.dispatch({ type: 'set_active_turn', turnId: ctx.runtimeStateByThreadRef.current[threadId]?.activeTurnId ?? null })
    const nextMode = replayState?.mode ?? ctx.runtimeStateByThreadRef.current[threadId]?.mode ?? 'normal'
    ctx.setMode(nextMode)
    if (replayState) {
      ctx.cacheThreadMode(threadId, nextMode)
    }
  }
  flushCanonicalProtocolAnomaliesLog()
  return true
}
