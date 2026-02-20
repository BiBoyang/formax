import { asThreadReplay, type ReplayStateSnapshot } from './rpcParsers'

export type RpcStartedThread = {
  id: string
  cwd?: string
}

export type RpcTurnStartLikeResult = {
  turnId: string | null
  localStdout: string
}

export type RpcInputSubmitResult = {
  status: string
}

export type RpcThreadReplayResult = {
  data: Array<{ replaySeq: number; method: string; params?: unknown }>
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: ReplayStateSnapshot | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

export function parseThreadStartResponse(value: unknown): RpcStartedThread | null {
  const thread = asRecord(asRecord(value).thread)
  const id = typeof thread.id === 'string' && thread.id.trim() ? thread.id : ''
  if (!id) return null
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim() ? thread.cwd : undefined
  return cwd ? { id, cwd } : { id }
}

export function parseTurnStartLikeResponse(value: unknown): RpcTurnStartLikeResult {
  const root = asRecord(value)
  const turn = asRecord(root.turn)
  const local = asRecord(root.local)
  const turnId = typeof turn.id === 'string' && turn.id.trim() ? turn.id : null
  const localStdout = typeof local.stdout === 'string' ? local.stdout : ''
  return {
    turnId,
    localStdout,
  }
}

export function parseInputSubmitResponse(value: unknown): RpcInputSubmitResult {
  const record = asRecord(value)
  const status = typeof record.status === 'string' && record.status.trim() ? record.status : 'unknown'
  return { status }
}

export function parseThreadReplayResponse(value: unknown): RpcThreadReplayResult {
  return asThreadReplay(value)
}
