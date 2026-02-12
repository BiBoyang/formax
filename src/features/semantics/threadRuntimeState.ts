import { isReplMode, type ReplMode } from './replModeTransition'
export type ThreadRuntimePendingInputKind = 'approval' | 'ask_user_question'

export type ThreadRuntimePendingInput = {
  inputId: string
  turnId: string
  kind: ThreadRuntimePendingInputKind
  createdAt: string
  expiresAt: string
}

export type ThreadRuntimeState = {
  threadId: string
  mode: ReplMode
  activeTurnId: string | null
  lastTurnId: string | null
  lastTurnStatus: 'running' | 'completed' | 'failed' | 'interrupted' | null
  pendingInputs: Record<string, ThreadRuntimePendingInput>
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
  return {
    threadId: args.threadId,
    mode: 'normal',
    activeTurnId: null,
    lastTurnId: null,
    lastTurnStatus: null,
    pendingInputs: {},
    updatedAt: toIsoOrNow(args.ts),
    lastNotificationMethod: args.method,
    lastReplaySeq: args.replaySeq,
  }
}

export function reduceThreadRuntimeState(
  state: ThreadRuntimeState,
  args: { method: string; params: unknown; replaySeq: number },
): ThreadRuntimeState {
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
      const kind = record.kind === 'approval' || record.kind === 'ask_user_question' ? record.kind : null
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : nowIso()
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : createdAt
      if (inputId && turnId && kind) {
        next.pendingInputs = {
          ...next.pendingInputs,
          [inputId]: {
            inputId,
            turnId,
            kind,
            createdAt,
            expiresAt,
          },
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
