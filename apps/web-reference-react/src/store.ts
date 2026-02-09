import type { ConnectionStatus } from './rpcClient'
import type { PendingInput, ThreadSummary, TranscriptItem } from './types'

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
  | { type: 'push_log'; text: string; level?: 'info' | 'warn' | 'error'; turnId?: string }
  | { type: 'push_message'; role: 'user' | 'assistant'; text: string; turnId?: string }
  | { type: 'bind_last_user_message_turn'; turnId: string }
  | { type: 'append_assistant_delta'; turnId: string; text: string }
  | { type: 'append_thinking_delta'; turnId: string; text: string }
  | {
      type: 'append_tool_event'
      turnId: string
      toolUseId?: string
      toolName?: string
      phase: 'start' | 'update' | 'end'
      text: string
    }
  | { type: 'input_requested'; input: PendingInput }
  | { type: 'input_resolved'; inputId: string; status?: string }
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
        updated[updated.length - 1] = { ...last, text: last.text + action.text }
        return { ...state, logs: updated }
      }

      const next: TranscriptItem = {
        id: itemId(),
        kind: 'thinking',
        text: action.text,
        turnId: action.turnId,
      }
      return { ...state, logs: [...state.logs, next] }
    }

    case 'append_tool_event': {
      const next: TranscriptItem = {
        id: itemId(),
        kind: 'tool',
        turnId: action.turnId,
        toolUseId: action.toolUseId,
        toolName: action.toolName,
        phase: action.phase,
        text: action.text,
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
      delete nextPending[action.inputId]
      const nextSelected =
        state.selectedInputId === action.inputId ? (Object.keys(nextPending)[0] ?? null) : state.selectedInputId
      const nextLogs =
        action.status == null
          ? state.logs
          : [
              ...state.logs,
              {
                id: itemId(),
                kind: 'log',
                text: `Input resolved: ${action.status}`,
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
