import type { PendingInput, ResolvedInput, ThreadMessage, ThreadSummary } from '../../types'
import type { TranscriptSegment } from '../../../../../src/features/semantics/projection/transcriptProjection'
import { isReplMode, type ReplMode } from '../../../../../src/features/semantics/core/replModeTransition'
import type { ThreadRuntimeState } from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import type { SemanticsInvariantIssue } from '../../../../../src/features/semantics/selectors/invariants'

export type ReplayNotification = {
  replaySeq: number
  method: string
  params?: unknown
}

export type ReplayStateSnapshot = {
  mode: ReplMode
  activeTurnId: string | null
  lastTurnId: string | null
  lastTurnStatus: ThreadRuntimeState['lastTurnStatus']
  pendingInputCount: number
  canonicalProtocolAnomalyCount: number
  pendingInputs: PendingInput[]
  invariantIssues: SemanticsInvariantIssue[]
  projection: {
    segments: TranscriptSegment[]
    lastReplaySeq: number
    toolNameByUseId: Record<string, string>
    openAssistantSegmentIdByTurn: Record<string, string>
    openThinkingSegmentIdByTurn: Record<string, string>
  } | null
  toolNameByUseId: Record<string, string>
  updatedAt: string
}

function parseInvariantIssues(value: unknown): SemanticsInvariantIssue[] {
  if (!Array.isArray(value)) return []
  const out: SemanticsInvariantIssue[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (row.kind === 'running_tool_after_terminal_turn') {
      const turnId = typeof row.turnId === 'string' && row.turnId.trim() ? row.turnId : null
      const toolUseId = typeof row.toolUseId === 'string' && row.toolUseId.trim() ? row.toolUseId : null
      if (!turnId || !toolUseId) continue
      out.push({
        kind: 'running_tool_after_terminal_turn',
        turnId,
        toolUseId,
      })
      continue
    }
    if (row.kind === 'pending_input_after_terminal_turn') {
      const turnId = typeof row.turnId === 'string' && row.turnId.trim() ? row.turnId : null
      const inputId = typeof row.inputId === 'string' && row.inputId.trim() ? row.inputId : null
      const toolUseId = typeof row.toolUseId === 'string' && row.toolUseId.trim() ? row.toolUseId : null
      if (!turnId || !inputId || !toolUseId) continue
      out.push({
        kind: 'pending_input_after_terminal_turn',
        turnId,
        inputId,
        toolUseId,
      })
    }
  }
  return out
}

export function asThreadSummaries(value: unknown): ThreadSummary[] {
  if (!value || typeof value !== 'object') return []
  const data = (value as { data?: unknown }).data
  return Array.isArray(data) ? (data as ThreadSummary[]) : []
}

export function asThreadMessages(value: unknown): { data: ThreadMessage[]; nextCursor: string | null } {
  if (!value || typeof value !== 'object') return { data: [], nextCursor: null }
  const raw = Array.isArray((value as { data?: unknown }).data) ? ((value as { data: unknown[] }).data ?? []) : []
  const data: ThreadMessage[] = raw
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const kind = record.kind
      if (kind === 'tool') {
        if (typeof record.toolName !== 'string') return null
        const status =
          record.status === 'error'
            ? 'error'
            : record.status === 'running'
              ? 'running'
              : 'completed'
        const summary = typeof record.summary === 'string' ? record.summary : `${record.toolName} completed`
        return {
          id: typeof record.id === 'string' ? record.id : `tool-${index}`,
          kind: 'tool' as const,
          toolName: record.toolName,
          status,
          summary,
          ...(typeof record.toolUseId === 'string' ? { toolUseId: record.toolUseId } : {}),
          ...(typeof record.paramsText === 'string' ? { paramsText: record.paramsText } : {}),
          ...(Array.isArray(record.detailLines)
            ? { detailLines: record.detailLines.filter((line): line is string => typeof line === 'string') }
            : {}),
        }
      }

      const role = record.role
      if (role !== 'user' && role !== 'assistant') return null
      if (typeof record.text !== 'string') return null
      return {
        id: typeof record.id === 'string' ? record.id : `msg-${index}`,
        kind: 'message' as const,
        role,
        text: record.text,
      }
    })
    .filter((entry): entry is ThreadMessage => Boolean(entry))
  const nextCursorRaw = (value as { nextCursor?: unknown }).nextCursor
  const nextCursor = typeof nextCursorRaw === 'string' ? nextCursorRaw : null
  return { data, nextCursor }
}

export function parseProjectionSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return []
  const out: TranscriptSegment[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const segment = raw as Record<string, unknown>
    const kind = segment.kind
    const id = typeof segment.id === 'string' ? segment.id : null
    const turnId = typeof segment.turnId === 'string' ? segment.turnId : null
    if (!id || !turnId) continue

    if (kind === 'assistant') {
      if (typeof segment.text !== 'string') continue
      out.push({ id, kind: 'assistant', turnId, text: segment.text })
      continue
    }
    if (kind === 'thinking') {
      if (typeof segment.text !== 'string') continue
      if (segment.status !== 'running' && segment.status !== 'finalized') continue
      out.push({
        id,
        kind: 'thinking',
        turnId,
        text: segment.text,
        status: segment.status,
      })
      continue
    }
    if (kind === 'tool') {
      if (typeof segment.toolUseId !== 'string' || typeof segment.toolName !== 'string' || typeof segment.summary !== 'string') {
        continue
      }
      if (segment.status !== 'running' && segment.status !== 'completed' && segment.status !== 'error') continue
      const detailLines = Array.isArray(segment.detailLines)
        ? segment.detailLines.filter((line): line is string => typeof line === 'string')
        : []
      const inputStateRaw = segment.inputState
      const inputState:
        | {
            kind: 'approval' | 'ask_user_question'
            status: 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
          }
        | null =
        inputStateRaw && typeof inputStateRaw === 'object'
          ? (() => {
              const row = inputStateRaw as Record<string, unknown>
              const kind = row.kind === 'approval' || row.kind === 'ask_user_question' ? row.kind : null
              const status =
                row.status === 'pending' ||
                row.status === 'submitted' ||
                row.status === 'canceled' ||
                row.status === 'expired' ||
                row.status === 'failed'
                  ? row.status
                  : null
              if (!kind || !status) return null
              return { kind, status }
            })()
          : null
      out.push({
        id,
        kind: 'tool',
        turnId,
        toolUseId: segment.toolUseId,
        toolName: segment.toolName,
        status: segment.status,
        summary: segment.summary,
        detailLines,
        ...(typeof segment.paramsText === 'string' ? { paramsText: segment.paramsText } : {}),
        ...(inputState ? { inputState } : {}),
      })
      continue
    }
    if (kind === 'turn_footer') {
      if (segment.status !== 'completed' && segment.status !== 'failed' && segment.status !== 'interrupted') continue
      out.push({
        id,
        kind: 'turn_footer',
        turnId,
        status: segment.status,
        ...(typeof segment.message === 'string' ? { message: segment.message } : {}),
      })
    }
  }
  return out
}

function parseStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue
    if (typeof raw !== 'string') continue
    const text = raw.trim()
    if (!text) continue
    out[key] = text
  }
  return out
}

export function asThreadReplay(value: unknown): {
  data: ReplayNotification[]
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: ReplayStateSnapshot | null
} {
  if (!value || typeof value !== 'object') {
    return { data: [], nextCursor: 0, latestCursor: 0, hasGap: false, state: null }
  }
  const record = value as Record<string, unknown>
  const rawData = Array.isArray(record.data) ? record.data : []
  const data = rawData
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const row = entry as Record<string, unknown>
      if (typeof row.replaySeq !== 'number' || !Number.isFinite(row.replaySeq)) return null
      if (typeof row.method !== 'string' || !row.method.trim()) return null
      return {
        replaySeq: row.replaySeq,
        method: row.method,
        ...(row.params !== undefined ? { params: row.params } : {}),
      } satisfies ReplayNotification
    })
    .filter((entry): entry is ReplayNotification => Boolean(entry))
  const nextCursor = typeof record.nextCursor === 'number' && Number.isFinite(record.nextCursor) ? record.nextCursor : 0
  const latestCursor =
    typeof record.latestCursor === 'number' && Number.isFinite(record.latestCursor) ? record.latestCursor : nextCursor
  const hasGap = Boolean(record.hasGap)
  const rawState = record.state
  let state: ReplayStateSnapshot | null = null
  if (rawState && typeof rawState === 'object') {
    const stateRecord = rawState as Record<string, unknown>
    const mode = isReplMode(stateRecord.mode) ? stateRecord.mode : 'normal'
    const activeTurnId = typeof stateRecord.activeTurnId === 'string' ? stateRecord.activeTurnId : null
    const lastTurnId = typeof stateRecord.lastTurnId === 'string' ? stateRecord.lastTurnId : null
    const lastTurnStatusRaw = stateRecord.lastTurnStatus
    const lastTurnStatus =
      lastTurnStatusRaw === 'running' ||
      lastTurnStatusRaw === 'completed' ||
      lastTurnStatusRaw === 'failed' ||
      lastTurnStatusRaw === 'interrupted'
        ? lastTurnStatusRaw
        : null
    const pendingInputCount =
      typeof stateRecord.pendingInputCount === 'number' && Number.isFinite(stateRecord.pendingInputCount)
        ? Math.max(0, stateRecord.pendingInputCount)
        : 0
    const canonicalProtocolAnomalyCount =
      typeof stateRecord.canonicalProtocolAnomalyCount === 'number' &&
      Number.isFinite(stateRecord.canonicalProtocolAnomalyCount)
        ? Math.max(0, stateRecord.canonicalProtocolAnomalyCount)
        : 0
    const pendingInputs: PendingInput[] = Array.isArray(stateRecord.pendingInputs)
      ? stateRecord.pendingInputs
          .map((rawInput): PendingInput | null => {
            if (!rawInput || typeof rawInput !== 'object') return null
            const row = rawInput as Record<string, unknown>
            const inputId = typeof row.inputId === 'string' && row.inputId.trim() ? row.inputId : null
            const threadId = typeof row.threadId === 'string' && row.threadId.trim() ? row.threadId : null
            const turnId = typeof row.turnId === 'string' && row.turnId.trim() ? row.turnId : null
            const toolUseId = typeof row.toolUseId === 'string' && row.toolUseId.trim() ? row.toolUseId : null
            const kind = row.kind === 'approval' || row.kind === 'ask_user_question' ? row.kind : null
            const status = row.status === 'pending' ? 'pending' : null
            const createdAt = typeof row.createdAt === 'string' ? row.createdAt : null
            const expiresAt = typeof row.expiresAt === 'string' ? row.expiresAt : null
            if (!inputId || !threadId || !turnId || !toolUseId || !kind || !status || !createdAt || !expiresAt) {
              return null
            }
            const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}
            return {
              inputId,
              threadId,
              turnId,
              toolUseId,
              kind,
              status,
              createdAt,
              expiresAt,
              payload,
            }
          })
          .filter((input): input is PendingInput => Boolean(input))
      : []
    const projectionRaw = stateRecord.projection
    const projection =
      projectionRaw && typeof projectionRaw === 'object'
        ? (() => {
            const row = projectionRaw as Record<string, unknown>
            const segments = parseProjectionSegments(row.segments)
            const lastReplaySeq = typeof row.lastReplaySeq === 'number' && Number.isFinite(row.lastReplaySeq) ? row.lastReplaySeq : 0
            if (segments.length === 0 && lastReplaySeq <= 0) return null
            return {
              segments,
              lastReplaySeq,
              toolNameByUseId: parseStringRecord(row.toolNameByUseId),
              openAssistantSegmentIdByTurn: parseStringRecord(row.openAssistantSegmentIdByTurn),
              openThinkingSegmentIdByTurn: parseStringRecord(row.openThinkingSegmentIdByTurn),
            }
          })()
        : null
    const toolNameByUseId = parseStringRecord(stateRecord.toolNameByUseId)
    const invariantIssues = parseInvariantIssues(stateRecord.invariantIssues)
    const updatedAt = typeof stateRecord.updatedAt === 'string' ? stateRecord.updatedAt : new Date(0).toISOString()
    state = {
      mode,
      activeTurnId,
      lastTurnId,
      lastTurnStatus,
      pendingInputCount,
      canonicalProtocolAnomalyCount,
      pendingInputs,
      invariantIssues,
      projection,
      toolNameByUseId,
      updatedAt,
    }
  }
  return { data, nextCursor, latestCursor, hasGap, state }
}

export function asResolvedInputs(value: unknown): ResolvedInput[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as { staleInputs?: unknown }).staleInputs
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const inputId = typeof record.inputId === 'string' ? record.inputId : null
      const threadId = typeof record.threadId === 'string' ? record.threadId : null
      const turnId = typeof record.turnId === 'string' ? record.turnId : null
      const toolUseId = typeof record.toolUseId === 'string' ? record.toolUseId : null
      const kind = record.kind === 'approval' || record.kind === 'ask_user_question' ? record.kind : null
      const status =
        record.status === 'submitted' ||
        record.status === 'canceled' ||
        record.status === 'expired' ||
        record.status === 'failed'
          ? record.status
          : null
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : null
      const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : null
      const resolvedAt = typeof record.resolvedAt === 'string' ? record.resolvedAt : null
      if (!inputId || !threadId || !turnId || !toolUseId || !kind || !status || !createdAt || !expiresAt || !resolvedAt) {
        return null
      }
      const reason = typeof record.reason === 'string' ? record.reason : undefined
      return {
        inputId,
        threadId,
        turnId,
        toolUseId,
        kind,
        status,
        createdAt,
        expiresAt,
        resolvedAt,
        ...(reason ? { reason } : {}),
      } satisfies ResolvedInput
    })
    .filter((entry): entry is ResolvedInput => Boolean(entry))
}
