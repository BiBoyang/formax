import type { ConnectionStatus } from './rpcClient'
import type { PendingInput, ThreadSummary, TranscriptItem } from './types'
import { transitionResolvedFromPending } from '../../../src/features/semantics/inputStateMachine'
import { applyToolEventPatch, findToolEventTargetIndex } from './toolEventNormalizer'
import type { CanonicalEvent } from '../../../src/features/semantics/canonicalEvents'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
  type TranscriptProjectionState,
} from '../../../src/features/semantics/transcriptProjection'

export type AppState = {
  connectionStatus: ConnectionStatus
  threads: ThreadSummary[]
  activeThreadId: string | null
  activeTurnId: string | null
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
  | { type: 'append_assistant_delta'; turnId: string; text: string }
  | { type: 'append_thinking_delta'; turnId: string; text: string }
  | { type: 'finalize_turn_thinking'; turnId: string }
  | {
      type: 'push_turn_footer'
      turnId: string
      status: 'completed' | 'failed' | 'interrupted'
      message?: string
    }
  | {
      type: 'append_tool_event'
      turnId: string
      toolUseId?: string
      toolName?: string
      phase: 'start' | 'update' | 'end'
      text?: string
      input?: unknown
      isError?: boolean
    }
  | {
      type: 'annotate_tool_input_state'
      turnId: string
      toolUseId: string
      toolName?: string
      inputKind: 'approval' | 'ask_user_question'
      status: 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
    }
  | { type: 'input_requested'; input: PendingInput }
  | { type: 'input_resolved'; inputId: string; status?: string; resolvedAt?: string; reason?: string }
  | { type: 'set_selected_input'; inputId: string | null }
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

function findLastLogIndexInTurnTail(
  logs: TranscriptItem[],
  turnId: string,
  matcher: (item: TranscriptItem) => boolean,
): number {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const item = logs[index]
    if (item.turnId === turnId) {
      if (matcher(item)) return index
      continue
    }
    if (!item.turnId) continue
    break
  }
  return -1
}

function isProjectionManagedTurnItem(item: TranscriptItem, turnId: string): boolean {
  if (item.turnId !== turnId) return false
  if (item.kind === 'thinking' || item.kind === 'turn_footer' || item.kind === 'tool_call') return true
  return item.kind === 'message' && item.role === 'assistant'
}

function toTranscriptItemFromProjectionSegment(segment: TranscriptProjectionState['segments'][number]): TranscriptItem | null {
  if (segment.kind === 'assistant') {
    return {
      id: segment.id,
      kind: 'message',
      role: 'assistant',
      turnId: segment.turnId,
      text: segment.text,
    }
  }

  if (segment.kind === 'thinking') {
    return {
      id: segment.id,
      kind: 'thinking',
      turnId: segment.turnId,
      text: segment.text,
      status: segment.status,
    }
  }

  if (segment.kind === 'tool') {
    return {
      id: segment.id,
      kind: 'tool_call',
      turnId: segment.turnId,
      toolUseId: segment.toolUseId,
      toolName: segment.toolName,
      status: segment.status,
      summary: segment.summary,
      detailLines: segment.detailLines,
      ...(segment.paramsText ? { paramsText: segment.paramsText } : {}),
      ...(segment.inputState ? { inputState: segment.inputState } : {}),
    }
  }

  if (segment.kind === 'turn_footer') {
    return {
      id: segment.id,
      kind: 'turn_footer',
      turnId: segment.turnId,
      status: segment.status,
      createdAt: new Date().toISOString(),
      ...(segment.message ? { message: segment.message } : {}),
    }
  }

  return null
}

function mergeTurnProjectionLogs(args: {
  logs: TranscriptItem[]
  turnId: string
  projectedItems: TranscriptItem[]
}): TranscriptItem[] {
  const { logs, turnId, projectedItems } = args
  let firstManagedIndex = -1
  let lastTurnIndex = -1
  for (let index = 0; index < logs.length; index += 1) {
    const item = logs[index]
    if (item.turnId === turnId) {
      lastTurnIndex = index
      if (firstManagedIndex < 0 && isProjectionManagedTurnItem(item, turnId)) {
        firstManagedIndex = index
      }
    }
  }
  const anchorIndex = firstManagedIndex >= 0 ? firstManagedIndex : lastTurnIndex >= 0 ? lastTurnIndex + 1 : logs.length
  let managedBeforeAnchor = 0
  for (let index = 0; index < anchorIndex; index += 1) {
    if (isProjectionManagedTurnItem(logs[index], turnId)) managedBeforeAnchor += 1
  }
  const filteredLogs = logs.filter((item) => !isProjectionManagedTurnItem(item, turnId))
  const insertionIndex = Math.max(0, Math.min(filteredLogs.length, anchorIndex - managedBeforeAnchor))
  return [
    ...filteredLogs.slice(0, insertionIndex),
    ...projectedItems,
    ...filteredLogs.slice(insertionIndex),
  ]
}

function applyCanonicalProjectionEvent(state: AppState, event: CanonicalEvent): AppState {
  if (!event.threadId || !event.turnId) return state
  const currentProjection =
    state.transcriptProjection && state.transcriptProjection.threadId === event.threadId
      ? state.transcriptProjection
      : createInitialTranscriptProjectionState({ threadId: event.threadId })
  const nextProjection = reduceTranscriptProjection(currentProjection, event)
  const projectedItems = nextProjection.segments
    .filter((segment) => segment.turnId === event.turnId)
    .map((segment) => toTranscriptItemFromProjectionSegment(segment))
    .filter((segment): segment is TranscriptItem => Boolean(segment))
  const logs = mergeTurnProjectionLogs({
    logs: state.logs,
    turnId: event.turnId,
    projectedItems,
  })
  return {
    ...state,
    logs,
    transcriptProjection: nextProjection,
  }
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

    case 'append_assistant_delta': {
      const assistantIndex = findLastLogIndexInTurnTail(
        state.logs,
        action.turnId,
        (item) => item.kind === 'message' && item.role === 'assistant' && item.turnId === action.turnId,
      )
      if (assistantIndex >= 0) {
        const existing = state.logs[assistantIndex]
        if (existing.kind !== 'message' || existing.role !== 'assistant') return state
        const updated = state.logs.slice()
        updated[assistantIndex] = { ...existing, text: existing.text + action.text }
        return { ...state, logs: updated }
      }

      const next: TranscriptItem = {
        id: itemId(),
        kind: 'message',
        role: 'assistant',
        text: action.text,
        turnId: action.turnId,
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'append_thinking_delta': {
      const thinkingIndex = findLastLogIndexInTurnTail(
        state.logs,
        action.turnId,
        (item) => item.kind === 'thinking' && item.turnId === action.turnId,
      )
      if (thinkingIndex >= 0) {
        const existing = state.logs[thinkingIndex]
        if (existing.kind !== 'thinking') return state
        const updated = state.logs.slice()
        updated[thinkingIndex] = { ...existing, text: existing.text + action.text }
        return { ...state, logs: updated }
      }

      const next: TranscriptItem = {
        id: itemId(),
        kind: 'thinking',
        text: action.text,
        status: 'running',
        turnId: action.turnId,
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'finalize_turn_thinking': {
      let changed = false
      const nextLogs = state.logs.map((item) => {
        if (item.kind !== 'thinking' || item.turnId !== action.turnId || item.status === 'finalized') return item
        changed = true
        return { ...item, status: 'finalized' as const }
      })
      if (!changed) return state
      return { ...state, logs: nextLogs }
    }

    case 'push_turn_footer': {
      const existingIndex = state.logs.findIndex((item) => item.kind === 'turn_footer' && item.turnId === action.turnId)
      if (existingIndex >= 0) {
        const existing = state.logs[existingIndex]
        if (existing.kind !== 'turn_footer') return state
        const updated: TranscriptItem = {
          ...existing,
          status: action.status,
          ...(action.message ? { message: action.message } : {}),
        }
        const logs = state.logs.slice()
        logs[existingIndex] = updated
        return { ...state, logs }
      }
      const next: TranscriptItem = {
        id: itemId(),
        kind: 'turn_footer',
        turnId: action.turnId,
        status: action.status,
        createdAt: new Date().toISOString(),
        ...(action.message ? { message: action.message } : {}),
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'append_tool_event': {
      const targetIndex = findToolEventTargetIndex(state.logs, {
        turnId: action.turnId,
        toolUseId: action.toolUseId,
      })
      if (targetIndex >= 0) {
        const current = state.logs[targetIndex]
        if (current.kind !== 'tool_call') return state
        const updated = applyToolEventPatch({
          id: current.id,
          current,
          patch: {
            turnId: action.turnId,
            toolUseId: action.toolUseId,
            toolName: action.toolName,
            phase: action.phase,
            text: action.text,
            input: action.input,
            isError: action.isError,
          },
        })
        const nextLogs = state.logs.slice()
        nextLogs[targetIndex] = updated
        return { ...state, logs: nextLogs }
      }

      const next = applyToolEventPatch({
        id: itemId(),
        patch: {
          turnId: action.turnId,
          toolUseId: action.toolUseId,
          toolName: action.toolName,
          phase: action.phase,
          text: action.text,
          input: action.input,
          isError: action.isError,
        },
      })
      return { ...state, logs: [...state.logs, next] }
    }

    case 'annotate_tool_input_state': {
      const targetIndexByTurn = findToolEventTargetIndex(state.logs, {
        turnId: action.turnId,
        toolUseId: action.toolUseId,
      })
      const targetIndex =
        targetIndexByTurn >= 0
          ? targetIndexByTurn
          : (() => {
              for (let index = state.logs.length - 1; index >= 0; index -= 1) {
                const item = state.logs[index]
                if (item.kind !== 'tool_call') continue
                if (item.toolUseId !== action.toolUseId) continue
                if (!item.turnId) return index
              }
              return -1
            })()
      if (targetIndex >= 0) {
        const current = state.logs[targetIndex]
        if (current.kind !== 'tool_call') return state
        const nextLogs = state.logs.slice()
        nextLogs[targetIndex] = {
          ...current,
          ...(current.turnId ? {} : { turnId: action.turnId }),
          ...(action.toolName ? { toolName: action.toolName } : {}),
          ...(action.toolName && current.summary === `${current.toolName} running`
            ? { summary: `${action.toolName} running` }
            : {}),
          inputState: {
            kind: action.inputKind,
            status: action.status,
          },
        }
        return { ...state, logs: nextLogs }
      }

      const next: TranscriptItem = {
        id: itemId(),
        kind: 'tool_call',
        turnId: action.turnId,
        toolUseId: action.toolUseId,
        toolName: action.toolName ?? 'Tool',
        status: 'running',
        summary: `${action.toolName ?? 'Tool'} running`,
        detailLines: [],
        inputState: {
          kind: action.inputKind,
          status: action.status,
        },
      }
      return { ...state, logs: [...state.logs, next] }
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

    case 'apply_canonical_event':
      return applyCanonicalProjectionEvent(state, action.event)

    default:
      return state
  }
}
