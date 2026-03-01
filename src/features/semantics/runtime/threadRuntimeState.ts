import { isReplMode, type ReplMode } from '../core/replModeTransition'
import { isInputKind, type InputKind } from '../../../shared/inputContracts'

export type ThreadRuntimePendingInputKind = InputKind
const MAX_STICKY_TOOL_NAMES = 512

export type ThreadRuntimePendingInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: ThreadRuntimePendingInputKind
  status: 'pending'
  createdAt: string
  expiresAt: string
  payload: unknown
}

export type ThreadRuntimeState = {
  threadId: string
  mode: ReplMode
  activeTurnId: string | null
  lastTurnId: string | null
  lastTurnStatus: 'running' | 'completed' | 'failed' | 'interrupted' | null
  pendingInputs: Record<string, ThreadRuntimePendingInput>
  toolNameByUseId: Record<string, string>
  updatedAt: string
  lastNotificationMethod: string | null
  lastReplaySeq: number
}

function nowIso(): string {
  return new Date().toISOString()
}

function toIsoOrNow(value: unknown): string {
  if (typeof value !== 'string') return nowIso()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso()
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function withStickyToolNameBounded(args: {
  current: Record<string, string>
  toolUseId: string
  toolName: string
}): Record<string, string> {
  const existing = args.current[args.toolUseId]
  if (existing === args.toolName) return args.current

  const next = {
    ...args.current,
    [args.toolUseId]: args.toolName,
  }
  const keys = Object.keys(next)
  if (keys.length <= MAX_STICKY_TOOL_NAMES) return next

  const trimCount = keys.length - MAX_STICKY_TOOL_NAMES
  for (let index = 0; index < trimCount; index += 1) {
    delete next[keys[index]!]
  }
  return next
}

export function extractThreadIdFromNotificationParams(params: unknown): string | null {
  if (!params || typeof params !== 'object') return null
  const obj = params as Record<string, unknown>
  if (typeof obj.threadId === 'string' && obj.threadId.trim()) return obj.threadId
  const turn = obj.turn
  if (turn && typeof turn === 'object') {
    const turnObj = turn as Record<string, unknown>
    if (typeof turnObj.threadId === 'string' && turnObj.threadId.trim()) return turnObj.threadId
  }
  return null
}

export function createInitialThreadRuntimeState(args: {
  threadId: string
  replaySeq: number
  method: string
  ts?: unknown
}): ThreadRuntimeState {
  const seededReplaySeq = Number.isFinite(args.replaySeq) ? Math.max(0, args.replaySeq - 1) : 0
  return {
    threadId: args.threadId,
    mode: 'normal',
    activeTurnId: null,
    lastTurnId: null,
    lastTurnStatus: null,
    pendingInputs: {},
    toolNameByUseId: {},
    updatedAt: toIsoOrNow(args.ts),
    lastNotificationMethod: args.method,
    lastReplaySeq: seededReplaySeq,
  }
}

export function reduceThreadRuntimeState(
  state: ThreadRuntimeState,
  args: { method: string; params: unknown; replaySeq: number },
): ThreadRuntimeState {
  if (args.replaySeq <= state.lastReplaySeq) {
    return state
  }

  const params = args.params && typeof args.params === 'object' ? (args.params as Record<string, unknown>) : {}
  const updatedAt = toIsoOrNow(params.ts)
  const next: ThreadRuntimeState = {
    ...state,
    updatedAt,
    lastNotificationMethod: args.method,
    lastReplaySeq: args.replaySeq,
  }

  if (args.method === 'turn/started') {
    const turn = params.turn
    if (turn && typeof turn === 'object') {
      const turnRecord = turn as Record<string, unknown>
      const turnId = turnRecord.id
      if (isReplMode(turnRecord.mode)) {
        next.mode = turnRecord.mode
      }
      if (typeof turnId === 'string' && turnId.trim()) {
        next.activeTurnId = turnId
        next.lastTurnId = turnId
        next.lastTurnStatus = 'running'
      }
    }
    return next
  }

  if (args.method === 'turn/inputRequested') {
    const input = params.input
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>
      const inputId = typeof record.inputId === 'string' ? record.inputId : null
      const turnId = typeof record.turnId === 'string' ? record.turnId : null
      const threadId = typeof record.threadId === 'string' && record.threadId.trim() ? record.threadId : state.threadId
      const toolUseIdRaw = toNonEmptyString(record.toolUseId)
      const pendingToolUseId = toolUseIdRaw ?? inputId
      const kind = isInputKind(record.kind) ? record.kind : null
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : nowIso()
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : createdAt
      if (inputId && turnId && kind && pendingToolUseId) {
        next.pendingInputs = {
          ...next.pendingInputs,
          [inputId]: {
            inputId,
            threadId,
            turnId,
            toolUseId: pendingToolUseId,
            kind,
            status: 'pending',
            createdAt,
            expiresAt,
            payload: record.payload,
          },
        }
      }
      const payload = record.payload
      const payloadToolName =
        payload && typeof payload === 'object' ? toNonEmptyString((payload as Record<string, unknown>).toolName) : null
      if (toolUseIdRaw && payloadToolName) {
        next.toolNameByUseId = withStickyToolNameBounded({
          current: next.toolNameByUseId,
          toolUseId: toolUseIdRaw,
          toolName: payloadToolName,
        })
      }
    }
    return next
  }

  if (args.method === 'turn/event') {
    const event = params.event
    if (event && typeof event === 'object') {
      const eventRecord = event as Record<string, unknown>
      const eventType = toNonEmptyString(eventRecord.type)
      if (
        eventType === 'tool_start' ||
        eventType === 'tool_update' ||
        eventType === 'tool_end' ||
        eventType === 'tool_input'
      ) {
        const toolUseId = toNonEmptyString(eventRecord.id) ?? toNonEmptyString(eventRecord.toolUseId)
        const toolName = toNonEmptyString(eventRecord.name) ?? toNonEmptyString(eventRecord.toolName)
        if (toolUseId && toolName) {
          next.toolNameByUseId = withStickyToolNameBounded({
            current: next.toolNameByUseId,
            toolUseId,
            toolName,
          })
        }
      }
    }
    return next
  }

  if (args.method === 'turn/inputResolved') {
    const input = params.input
    if (input && typeof input === 'object') {
      const inputId = (input as Record<string, unknown>).inputId
      if (typeof inputId === 'string' && next.pendingInputs[inputId]) {
        const pendingInputs = { ...next.pendingInputs }
        delete pendingInputs[inputId]
        next.pendingInputs = pendingInputs
      }
    }
    return next
  }

  if (args.method === 'turn/completed' || args.method === 'turn/failed') {
    const turn = params.turn
    if (turn && typeof turn === 'object') {
      const turnRecord = turn as Record<string, unknown>
      const turnId = typeof turnRecord.id === 'string' ? turnRecord.id : null
      const statusRaw = turnRecord.status
      if (turnId) {
        next.lastTurnId = turnId
        if (next.activeTurnId === turnId) next.activeTurnId = null
        const pendingInputs = { ...next.pendingInputs }
        for (const [inputId, pending] of Object.entries(pendingInputs)) {
          if (pending.turnId === turnId) delete pendingInputs[inputId]
        }
        next.pendingInputs = pendingInputs
      }
      if (statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'interrupted') {
        next.lastTurnStatus = statusRaw
      } else if (args.method === 'turn/completed') {
        next.lastTurnStatus = 'completed'
      } else {
        next.lastTurnStatus = 'failed'
      }
    }
    return next
  }

  if (args.method === 'turn/modeChanged') {
    if (isReplMode(params.mode)) {
      next.mode = params.mode
    }
    return next
  }

  return next
}
