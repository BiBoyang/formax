import type { ConnectionStatus } from './rpcClient'
import type { PendingInput, ThreadSummary, TranscriptItem } from './types'
import { transitionResolvedFromPending } from './semantics'
import type { CanonicalEvent } from './semantics'
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
}

export type AppAction =
  | { type: 'set_connection_status'; status: ConnectionStatus }
  | { type: 'set_threads'; threads: ThreadSummary[] }
  | { type: 'set_active_thread'; threadId: string | null }
  | { type: 'set_active_turn'; turnId: string | null }
  | { type: 'replace_logs'; logs: TranscriptItem[] }
  | { type: 'prepend_logs'; logs: TranscriptItem[] }
  | { type: 'clear_pending_inputs' }
  | { type: 'push_log'; text: string; level?: 'info' | 'warn' | 'error'; turnId?: string }
  | { type: 'push_message'; role: 'user' | 'assistant'; text: string; turnId?: string }
  | { type: 'bind_last_user_message_turn'; turnId: string }
  | { type: 'input_requested'; input: PendingInput }
  | { type: 'input_resolved'; inputId: string; status?: string; resolvedAt?: string; reason?: string }
  | { type: 'set_selected_input'; inputId: string | null }
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
}

function itemId(): string {
  return `${Date.now()}-${Math.random()}`
}

function isResolvedInputStatus(value: string): value is 'submitted' | 'canceled' | 'expired' | 'failed' {
  return value === 'submitted' || value === 'canceled' || value === 'expired' || value === 'failed'
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set_connection_status':
      return { ...state, connectionStatus: action.status }

    case 'set_threads':
      return { ...state, threads: action.threads }

    case 'set_active_thread':
      return { ...state, activeThreadId: action.threadId, transcriptProjection: null }

    case 'set_active_turn':
      return { ...state, activeTurnId: action.turnId }

    case 'replace_logs':
      return { ...state, logs: action.logs, transcriptProjection: null }

    case 'prepend_logs':
      return { ...state, logs: [...action.logs, ...state.logs] }

    case 'clear_pending_inputs':
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
        id: itemId(),
        kind: 'message',
        role: action.role,
        text: action.text,
        ...(action.turnId ? { turnId: action.turnId } : {}),
      }
      return { ...state, logs: [...state.logs, next] }
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
      const nextPending = { ...state.pendingInputs }
      const pending = nextPending[action.inputId]
      delete nextPending[action.inputId]
      const nextSelected =
        state.selectedInputId === action.inputId ? (Object.keys(nextPending)[0] ?? null) : state.selectedInputId
      const resolvedAt = action.resolvedAt ?? new Date().toISOString()
      const resolvedStatus =
        action.status && pending && isResolvedInputStatus(action.status)
          ? transitionResolvedFromPending({
              state: {
                status: 'pending',
                createdAt: pending.createdAt,
                expiresAt: pending.expiresAt,
              },
              status: action.status,
              resolvedAt,
              reason: action.reason,
            }).status
          : action.status
      const nextLogs =
        resolvedStatus == null
          ? state.logs
          : [
              ...state.logs,
              {
                id: itemId(),
                kind: 'log',
                text: `Input resolved: ${resolvedStatus}`,
                level: 'info',
              } as TranscriptItem,
            ]
      return {
        ...state,
        pendingInputs: nextPending,
        selectedInputId: nextSelected,
        logs: nextLogs,
      }
    }

    case 'set_selected_input':
      return { ...state, selectedInputId: action.inputId }

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
