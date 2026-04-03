import type { ResolvedInput, ThreadMessage, ThreadSummary } from '../../types'
import {
  asResolvedInputs,
  asThreadMessages,
  asThreadReplay,
  asThreadSummaries,
  type ReplayStateSnapshot,
} from './rpcParsers'

export type RpcStartedThread = {
  id: string
  cwd?: string
}

export type RpcTurnStartLikeResult = {
  turnId: string | null
  localStdout: string
  localDiagnostics: RpcContextDiagnosticsPayload | null
}

export type RpcContextDiagnosticsPayload = {
  kind: 'formax.context_diagnostics'
  schemaVersion: number
  mode?: string
  model?: string
  snapshot?: Record<string, unknown>
  nextTurnFixed?: Record<string, unknown>
  notes?: string[]
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

export type RpcThreadMessagesResult = {
  data: ThreadMessage[]
  nextCursor: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const deduped = new Set<string>()
  for (const row of value) {
    if (typeof row !== 'string') continue
    const trimmed = row.trim()
    if (!trimmed) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b))
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
  const localDiagnostics = parseContextDiagnosticsPayload(local.diagnostics)
  return {
    turnId,
    localStdout,
    localDiagnostics,
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

export function parseThreadListResponse(value: unknown): ThreadSummary[] {
  return asThreadSummaries(value)
}

export function parseHiddenThreadGroupCwdsFromThreadList(value: unknown): string[] {
  const root = asRecord(value)
  return parseStringList(root.hiddenGroupCwds)
}

export function parseThreadGroupHideResponse(value: unknown): string[] {
  const root = asRecord(value)
  return parseStringList(root.hiddenGroupCwds)
}

export function parseThreadMessagesResponse(value: unknown): RpcThreadMessagesResult {
  return asThreadMessages(value)
}

export function parseResolvedInputsResponse(value: unknown): ResolvedInput[] {
  return asResolvedInputs(value)
}

function parseContextDiagnosticsPayload(value: unknown): RpcContextDiagnosticsPayload | null {
  const record = asRecord(value)
  if (record.kind !== 'formax.context_diagnostics') return null
  const schemaVersion =
    typeof record.schemaVersion === 'number' && Number.isFinite(record.schemaVersion) ? record.schemaVersion : 0
  if (!schemaVersion) return null
  const mode = typeof record.mode === 'string' ? record.mode : undefined
  const model = typeof record.model === 'string' ? record.model : undefined
  const snapshot = asOptionalRecord(record.snapshot)
  const nextTurnFixed = asOptionalRecord(record.nextTurnFixed)
  const notes = Array.isArray(record.notes) ? record.notes.filter((row): row is string => typeof row === 'string') : undefined
  return {
    kind: 'formax.context_diagnostics',
    schemaVersion,
    ...(mode ? { mode } : {}),
    ...(model ? { model } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(nextTurnFixed ? { nextTurnFixed } : {}),
    ...(notes ? { notes } : {}),
  }
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
