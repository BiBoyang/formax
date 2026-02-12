import type { ConnectionStatus } from './rpcClient'
import type { PendingInput, ThreadSummary, TranscriptItem } from './types'
import { transitionResolvedFromPending } from '../../../src/features/semantics/inputStateMachine'
import { applyToolEventPatch, findToolEventTargetIndex } from './toolEventNormalizer'

export type AppState = {
  connectionStatus: ConnectionStatus
  threads: ThreadSummary[]
  activeThreadId: string | null
  activeTurnId: string | null
  logs: TranscriptItem[]
  pendingInputs: Record<string, PendingInput>
  selectedInputId: string | null
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

export const initialAppState: AppState = {
  connectionStatus: 'disconnected',
  threads: [],
  activeThreadId: null,
  activeTurnId: null,
  logs: [],
  pendingInputs: {},
  selectedInputId: null,
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
      return { ...state, activeThreadId: action.threadId }

    case 'set_active_turn':
      return { ...state, activeTurnId: action.turnId }

    case 'replace_logs':
      return { ...state, logs: action.logs }

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
      const last = state.logs[state.logs.length - 1]
      if (last && last.kind === 'message' && last.role === 'assistant' && last.turnId === action.turnId) {
        const updated = state.logs.slice()
        updated[updated.length - 1] = { ...last, text: last.text + action.text }
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
      const last = state.logs[state.logs.length - 1]
      if (last && last.kind === 'thinking' && last.turnId === action.turnId) {
        const updated = state.logs.slice()
        updated[updated.length - 1] = { ...last, text: last.text + action.text, status: 'running' }
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

    default:
      return state
  }
}
