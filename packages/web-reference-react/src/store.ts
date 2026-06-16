import type { ConnectionStatus } from './rpcClient'
import type { ContextMeterSnapshotRaw, ContextMeterThreadRaw, PendingInput, ThreadSummary, TranscriptItem } from './types'
import type { CanonicalEvent } from './semantics'
import type { ContextMeterBudgetRaw } from '@formax/shared/utils/contextMeter'
import type { TokenUsage } from '@formax/shared/streaming'
import {
  createInitialTranscriptProjectionState,
  type TranscriptSegment,
  type TranscriptProjectionState,
} from './semantics'
import {
  applyCanonicalProjectionEvent as applyCanonicalProjectionEventInEngine,
  collectToolNameByUseIdFromLogs,
  toTranscriptItemFromProjectionSegment,
} from './app/core/projectionEngine'

export type AppState = {
  connectionStatus: ConnectionStatus
  threads: ThreadSummary[]
  activeThreadId: string | null
  activeTurnId: string | null
  // Render model consumed by transcript UI; built from history hydrate + canonical projection patches.
  logs: TranscriptItem[]
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
  transcriptProjection: TranscriptProjectionState | null
  contextMeterRawByThreadId: Record<string, ContextMeterThreadRaw>
}

export type AppAction =
  | { type: 'set_connection_status'; status: ConnectionStatus }
  | { type: 'set_threads'; threads: ThreadSummary[] }
  | { type: 'set_active_thread'; threadId: string | null }
  | { type: 'set_active_turn'; turnId: string | null }
  | { type: 'clear_active_turn_if_matches'; turnId: string }
  | { type: 'replace_logs'; logs: TranscriptItem[] }
  | { type: 'prepend_logs'; logs: TranscriptItem[] }
  | { type: 'clear_pending_inputs' }
  | { type: 'push_log'; text: string; level?: 'info' | 'warn' | 'error'; turnId?: string }
  | { type: 'push_message'; role: 'user' | 'assistant'; text: string; turnId?: string; id?: string; clientMessageId?: string; optimistic?: boolean }
  | { type: 'remove_transcript_item'; id: string }
  | { type: 'bind_last_optimistic_user_message_turn'; turnId: string; activate?: boolean }
  | { type: 'bind_optimistic_user_message_turn'; clientMessageId: string; turnId: string; activate?: boolean }
  | { type: 'bind_last_user_message_turn'; turnId: string }
  | { type: 'input_requested'; input: PendingInput }
  | { type: 'input_resolved'; inputId: string; status?: string; resolvedAt?: string; reason?: string }
  | { type: 'set_selected_input'; inputId: string | null }
  | { type: 'context_meter_budget_received'; threadId: string; budgetRaw: ContextMeterBudgetRaw | null; ts?: string }
  | { type: 'context_meter_usage_received'; threadId: string; turnId: string; usage: TokenUsage; replaySeq?: number; ts?: string }
  | {
      type: 'context_meter_snapshot_received'
      threadId: string
      budgetRaw: ContextMeterBudgetRaw | null
      snapshot: ContextMeterSnapshotRaw
      fetchedAt: string
    }
  | { type: 'hydrate_projection_tool_names'; threadId: string; toolNameByUseId: Record<string, string> }
  | {
      type: 'hydrate_projection_snapshot'
      threadId: string
      snapshot: {
        segments: TranscriptSegment[]
        lastReplaySeq: number
        toolNameByUseId: Record<string, string>
        openAssistantSegmentIdByTurn: Record<string, string>
        openThinkingSegmentIdByTurn: Record<string, string>
      }
    }
  | { type: 'apply_canonical_event'; event: CanonicalEvent }

export const initialAppState: AppState = {
  connectionStatus: 'disconnected',
  threads: [],
  activeThreadId: null,
  activeTurnId: null,
  logs: [],
  pendingInputs: {},
  selectedInputId: null,
  transcriptProjection: null,
  contextMeterRawByThreadId: {},
}

function itemId(): string {
  return `${Date.now()}-${Math.random()}`
}

function areThreadSummariesEqual(a: ThreadSummary, b: ThreadSummary): boolean {
  return (
    a.id === b.id &&
    a.cwd === b.cwd &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.messageCount === b.messageCount &&
    a.lastUserPrompt === b.lastUserPrompt &&
    a.label === b.label &&
    a.titleSource === b.titleSource &&
    a.titleStatus === b.titleStatus &&
    (a.archivedAt ?? null) === (b.archivedAt ?? null)
  )
}

function reconcileThreadSummaries(prev: ThreadSummary[], next: ThreadSummary[]): ThreadSummary[] {
  if (prev === next) return prev
  if (prev.length === 0) return next.length === 0 ? prev : next
  if (next.length === 0) return prev.length === 0 ? prev : next

  const prevById = new Map<string, ThreadSummary>()
  for (const thread of prev) {
    prevById.set(thread.id, thread)
  }

  let orderAndValuesStable = prev.length === next.length
  const reconciled: ThreadSummary[] = new Array(next.length)

  for (let index = 0; index < next.length; index += 1) {
    const nextThread = next[index]
    const prevThreadAtIndex = prev[index]
    if (prevThreadAtIndex && areThreadSummariesEqual(prevThreadAtIndex, nextThread)) {
      reconciled[index] = prevThreadAtIndex
      continue
    }

    orderAndValuesStable = false
    const prevThreadWithSameId = prevById.get(nextThread.id)
    if (prevThreadWithSameId && areThreadSummariesEqual(prevThreadWithSameId, nextThread)) {
      reconciled[index] = prevThreadWithSameId
      continue
    }
    reconciled[index] = nextThread
  }

  if (orderAndValuesStable) {
    return prev
  }
  return reconciled
}

function getContextMeterThreadRaw(
  state: AppState,
  threadId: string,
): ContextMeterThreadRaw {
  return state.contextMeterRawByThreadId[threadId] ?? {
    threadId,
    budgetRaw: null,
    liveUsageByTurnId: {},
    latestUsageTurnId: null,
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set_connection_status':
      if (state.connectionStatus === action.status) return state
      return { ...state, connectionStatus: action.status }

    case 'set_threads': {
      const nextThreads = reconcileThreadSummaries(state.threads, action.threads)
      if (nextThreads === state.threads) return state
      return { ...state, threads: nextThreads }
    }

    case 'set_active_thread':
      if (state.activeThreadId === action.threadId && state.transcriptProjection === null) return state
      return { ...state, activeThreadId: action.threadId, transcriptProjection: null }

    case 'set_active_turn':
      if (state.activeTurnId === action.turnId) return state
      return { ...state, activeTurnId: action.turnId }

    case 'clear_active_turn_if_matches':
      if (state.activeTurnId !== action.turnId) return state
      return { ...state, activeTurnId: null }

    case 'replace_logs':
      if (state.logs === action.logs && state.transcriptProjection === null) return state
      return { ...state, logs: action.logs, transcriptProjection: null }

    case 'prepend_logs':
      if (action.logs.length === 0) return state
      return { ...state, logs: [...action.logs, ...state.logs] }

    case 'clear_pending_inputs':
      if (state.selectedInputId === null && Object.keys(state.pendingInputs).length === 0) return state
      return { ...state, pendingInputs: {}, selectedInputId: null }

    case 'push_log': {
      const next: TranscriptItem = {
        id: itemId(),
        kind: 'log',
        text: action.text,
        level: action.level ?? 'info',
        ...(action.turnId ? { turnId: action.turnId } : {}),
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'push_message': {
      const next: TranscriptItem = {
        id: action.id ?? itemId(),
        kind: 'message',
        role: action.role,
        text: action.text,
        ...(action.turnId ? { turnId: action.turnId } : {}),
        ...('clientMessageId' in action && typeof action.clientMessageId === 'string' ? { clientMessageId: action.clientMessageId } : {}),
        ...(action.optimistic ? { optimistic: true } : {}),
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'remove_transcript_item': {
      const nextLogs = state.logs.filter((item) => item.id !== action.id)
      if (nextLogs.length === state.logs.length) return state
      return { ...state, logs: nextLogs }
    }

    case 'bind_last_optimistic_user_message_turn': {
      for (let idx = state.logs.length - 1; idx >= 0; idx -= 1) {
        const item = state.logs[idx]
        if (item?.kind === 'message' && item.role === 'user' && item.optimistic) {
          const updated = state.logs.slice()
          updated[idx] = { ...item, turnId: action.turnId }
          return { ...state, logs: updated, ...(action.activate ? { activeTurnId: action.turnId } : {}) }
        }
      }
      return state
    }

    case 'bind_optimistic_user_message_turn': {
      const clientMessageId = action.clientMessageId.trim()
      if (!clientMessageId) return state
      const index = state.logs.findIndex((item) =>
        item.kind === 'message' &&
        item.role === 'user' &&
        item.optimistic &&
        item.clientMessageId === clientMessageId,
      )
      if (index < 0) return state
      const updated = state.logs.slice()
      updated[index] = { ...updated[index], turnId: action.turnId } as TranscriptItem
      return { ...state, logs: updated, ...(action.activate ? { activeTurnId: action.turnId } : {}) }
    }

    case 'bind_last_user_message_turn': {
      for (let idx = state.logs.length - 1; idx >= 0; idx -= 1) {
        const item = state.logs[idx]
        if (item?.kind === 'message' && item.role === 'user' && !item.turnId) {
          const updated = state.logs.slice()
          updated[idx] = { ...item, turnId: action.turnId }
          return { ...state, logs: updated }
        }
      }
      return state
    }

    case 'input_requested': {
      const nextPending = { ...state.pendingInputs, [action.input.inputId]: action.input }
      const nextSelected = state.selectedInputId ?? action.input.inputId
      return {
        ...state,
        pendingInputs: nextPending,
        selectedInputId: nextSelected,
      }
    }

    case 'input_resolved': {
      const hasInput = Object.prototype.hasOwnProperty.call(state.pendingInputs, action.inputId)
      if (!hasInput && state.selectedInputId !== action.inputId) {
        return state
      }
      const nextPending = { ...state.pendingInputs }
      delete nextPending[action.inputId]
      const nextSelected =
        state.selectedInputId === action.inputId ? (Object.keys(nextPending)[0] ?? null) : state.selectedInputId
      return {
        ...state,
        pendingInputs: nextPending,
        selectedInputId: nextSelected,
      }
    }

    case 'set_selected_input':
      if (state.selectedInputId === action.inputId) return state
      return { ...state, selectedInputId: action.inputId }

    case 'context_meter_budget_received': {
      const current = getContextMeterThreadRaw(state, action.threadId)
      const next: ContextMeterThreadRaw = {
        ...current,
        budgetRaw: action.budgetRaw,
        ...(action.ts ? { budgetUpdatedAt: action.ts } : {}),
      }
      return {
        ...state,
        contextMeterRawByThreadId: {
          ...state.contextMeterRawByThreadId,
          [action.threadId]: next,
        },
      }
    }

    case 'context_meter_usage_received': {
      const current = getContextMeterThreadRaw(state, action.threadId)
      const next: ContextMeterThreadRaw = {
        ...current,
        liveUsageByTurnId: {
          ...current.liveUsageByTurnId,
          [action.turnId]: {
            usage: action.usage,
            ...(action.replaySeq !== undefined ? { replaySeq: action.replaySeq } : {}),
            ...(action.ts ? { ts: action.ts } : {}),
          },
        },
        latestUsageTurnId: action.turnId,
      }
      return {
        ...state,
        contextMeterRawByThreadId: {
          ...state.contextMeterRawByThreadId,
          [action.threadId]: next,
        },
      }
    }

    case 'context_meter_snapshot_received': {
      const current = getContextMeterThreadRaw(state, action.threadId)
      const next: ContextMeterThreadRaw = {
        ...current,
        budgetRaw: action.budgetRaw,
        budgetUpdatedAt: action.fetchedAt,
        snapshot: action.snapshot,
      }
      return {
        ...state,
        contextMeterRawByThreadId: {
          ...state.contextMeterRawByThreadId,
          [action.threadId]: next,
        },
      }
    }

    case 'hydrate_projection_tool_names': {
      const existingProjection =
        state.transcriptProjection && state.transcriptProjection.threadId === action.threadId
          ? state.transcriptProjection
          : createInitialTranscriptProjectionState({ threadId: action.threadId })
      const fromLogs = collectToolNameByUseIdFromLogs(state.logs)
      const toolNameByUseId = {
        ...fromLogs,
        ...existingProjection.toolNameByUseId,
        ...action.toolNameByUseId,
      }
      if (Object.keys(toolNameByUseId).length === 0) return state
      return {
        ...state,
        transcriptProjection: {
          ...existingProjection,
          toolNameByUseId,
        },
      }
    }

    case 'hydrate_projection_snapshot': {
      const existingItemById = new Map<string, TranscriptItem>()
      const logs = action.snapshot.segments
        .map((segment) => toTranscriptItemFromProjectionSegment({ segment, existingItemById }))
        .filter((item): item is TranscriptItem => Boolean(item))
      return {
        ...state,
        logs,
        transcriptProjection: {
          threadId: action.threadId,
          segments: action.snapshot.segments.map((segment) => ({ ...segment })),
          seenEventIds: new Set<string>(),
          lastReplaySeq: action.snapshot.lastReplaySeq,
          toolNameByUseId: { ...action.snapshot.toolNameByUseId },
          openAssistantSegmentIdByTurn: { ...action.snapshot.openAssistantSegmentIdByTurn },
          openThinkingSegmentIdByTurn: { ...action.snapshot.openThinkingSegmentIdByTurn },
        },
      }
    }

    case 'apply_canonical_event':
      {
        const projectionPatch = applyCanonicalProjectionEventInEngine({
          state: {
            logs: state.logs,
            transcriptProjection: state.transcriptProjection,
          },
          event: action.event,
        })
        if (
          projectionPatch.logs === state.logs &&
          projectionPatch.transcriptProjection === state.transcriptProjection
        ) {
          return state
        }
        return {
          ...state,
          ...projectionPatch,
        }
      }

    default:
      return state
  }
}
