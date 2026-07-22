import fs from 'node:fs'
import readline from 'node:readline'
import type { ProjectionSnapshot, TranscriptSegment } from '@formax/semantics'

export const APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME = 'app_transcript_turn_snapshot'
export const APP_TRANSCRIPT_TURN_SNAPSHOT_SCHEMA_VERSION = 1

type PersistedTranscriptTurnSnapshot = {
  threadId: string
  turnId: string
  segments: TranscriptSegment[]
}

type PersistedToolSegment = Extract<TranscriptSegment, { kind: 'tool' }>
type PersistedToolInputState = NonNullable<Extract<TranscriptSegment, { kind: 'tool' }>['inputState']>
type PersistedNestedTool = NonNullable<PersistedToolSegment['nestedTools']>[number]
type PersistedToolUsage = NonNullable<PersistedToolSegment['usage']>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    out.push(item)
  }
  return out
}

function readOptionalStringList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  return readStringList(value) ?? undefined
}

function readNestedTools(value: unknown): PersistedNestedTool[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: PersistedNestedTool[] = []
  for (const item of value) {
    if (!isRecord(item)) return undefined
    const id = readNonEmptyString(item.id)
    const name = readNonEmptyString(item.name)
    if (!id || !name || !isRecord(item.input)) return undefined
    if (item.status !== 'running' && item.status !== 'completed' && item.status !== 'error') return undefined
    out.push({
      id,
      name,
      input: item.input,
      status: item.status,
      ...(readOptionalString(item.summary) !== undefined ? { summary: readOptionalString(item.summary) } : {}),
    })
  }
  return out
}

function readToolUsage(value: unknown): PersistedToolUsage | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined
  const out: PersistedToolUsage = {}
  for (const key of [
    'input_tokens',
    'output_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
    'cache_deleted_input_tokens',
  ] as const) {
    const tokenCount = value[key]
    if (tokenCount === undefined) continue
    if (typeof tokenCount !== 'number' || !Number.isFinite(tokenCount)) return undefined
    out[key] = tokenCount
  }
  return out
}

function parseSegment(value: unknown, turnId: string): TranscriptSegment | null {
  if (!isRecord(value)) return null
  const id = readNonEmptyString(value.id)
  const segmentTurnId = readNonEmptyString(value.turnId)
  if (!id || segmentTurnId !== turnId) return null

  if (value.kind === 'user') {
    if (typeof value.text !== 'string') return null
    const messageKind = value.messageKind === 'compact_summary' ? 'compact_summary' : undefined
    const clientMessageId = readNonEmptyString(value.clientMessageId)
    return {
      id,
      kind: 'user',
      turnId,
      text: value.text,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(messageKind ? { messageKind } : {}),
    }
  }

  if (value.kind === 'system') {
    if (typeof value.text !== 'string') return null
    if (value.role !== 'assistant' && value.role !== 'user') return null
    const messageKind =
      value.messageKind === 'command_subline' ||
      value.messageKind === 'compact_boundary' ||
      value.messageKind === 'compact_banner' ||
      value.messageKind === 'compact_summary'
        ? value.messageKind
        : undefined
    return {
      id,
      kind: 'system',
      turnId,
      role: value.role,
      text: value.text,
      ...(messageKind ? { messageKind } : {}),
    }
  }

  if (value.kind === 'assistant') {
    return typeof value.text === 'string' ? { id, kind: 'assistant', turnId, text: value.text } : null
  }

  if (value.kind === 'thinking') {
    if (typeof value.text !== 'string') return null
    if (value.status !== 'running' && value.status !== 'finalized') return null
    return { id, kind: 'thinking', turnId, text: value.text, status: value.status }
  }

  if (value.kind === 'tool') {
    const toolUseId = readNonEmptyString(value.toolUseId)
    const toolName = readNonEmptyString(value.toolName)
    if (!toolUseId || !toolName || typeof value.summary !== 'string') return null
    if (value.status !== 'running' && value.status !== 'completed' && value.status !== 'error') return null
    const detailLines = readStringList(value.detailLines)
    if (!detailLines) return null
    const input = isRecord(value.input) ? value.input : undefined
    const middleLines = readOptionalStringList(value.middleLines)
    const transcriptLines = readOptionalStringList(value.transcriptLines)
    const nestedTools = readNestedTools(value.nestedTools)
    const usage = readToolUsage(value.usage)
    const inputState: PersistedToolInputState | undefined = (() => {
      if (!isRecord(value.inputState)) return undefined
      const kind = value.inputState.kind
      const status = value.inputState.status
      if (kind !== 'approval' && kind !== 'ask_user_question') return undefined
      if (status !== 'pending' && status !== 'submitted' && status !== 'canceled' && status !== 'expired' && status !== 'failed') {
        return undefined
      }
      return { kind, status }
    })()
    return {
      id,
      kind: 'tool',
      turnId,
      toolUseId,
      toolName,
      status: value.status,
      ...(value.terminalSource === 'tool_event' || value.terminalSource === 'turn_footer'
        ? { terminalSource: value.terminalSource }
        : {}),
      summary: value.summary,
      detailLines,
      ...(input ? { input } : {}),
      ...(readOptionalString(value.result) !== undefined ? { result: readOptionalString(value.result) } : {}),
      ...(typeof value.resultLines === 'number' && Number.isFinite(value.resultLines)
        ? { resultLines: value.resultLines }
        : {}),
      ...(readOptionalString(value.expandInfo) !== undefined ? { expandInfo: readOptionalString(value.expandInfo) } : {}),
      ...(middleLines !== undefined ? { middleLines } : {}),
      ...(transcriptLines !== undefined ? { transcriptLines } : {}),
      ...(nestedTools !== undefined ? { nestedTools } : {}),
      ...(typeof value.toolUses === 'number' && Number.isFinite(value.toolUses) ? { toolUses: value.toolUses } : {}),
      ...(usage !== undefined ? { usage } : {}),
      ...(typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? { durationMs: value.durationMs } : {}),
      ...(typeof value.startedAtMs === 'number' && Number.isFinite(value.startedAtMs)
        ? { startedAtMs: value.startedAtMs }
        : {}),
      ...(typeof value.patchStartLineNumber === 'number' && Number.isFinite(value.patchStartLineNumber)
        ? { patchStartLineNumber: value.patchStartLineNumber }
        : {}),
      ...(readOptionalString(value.paramsText) !== undefined ? { paramsText: readOptionalString(value.paramsText) } : {}),
      ...(inputState ? { inputState } : {}),
    }
  }

  if (value.kind === 'turn_footer') {
    if (value.status !== 'completed' && value.status !== 'failed' && value.status !== 'interrupted') return null
    return {
      id,
      kind: 'turn_footer',
      turnId,
      status: value.status,
      ...(readOptionalString(value.message) !== undefined ? { message: readOptionalString(value.message) } : {}),
    }
  }

  return null
}

export function parsePersistedTranscriptTurnSnapshot(
  value: unknown,
  expectedThreadId: string,
): PersistedTranscriptTurnSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== APP_TRANSCRIPT_TURN_SNAPSHOT_SCHEMA_VERSION) return null
  const threadId = readNonEmptyString(value.threadId)
  const turnId = readNonEmptyString(value.turnId)
  if (threadId !== expectedThreadId || !turnId || !Array.isArray(value.segments) || value.segments.length === 0) {
    return null
  }
  const segments = value.segments.map((segment) => parseSegment(segment, turnId))
  if (segments.some((segment) => segment === null)) return null
  const parsedSegments = segments as TranscriptSegment[]
  if (parsedSegments[parsedSegments.length - 1]?.kind !== 'turn_footer') return null
  return { threadId, turnId, segments: parsedSegments }
}

export function buildPersistedTranscriptTurnSnapshotData(args: {
  threadId: string
  turnId: string
  segments: TranscriptSegment[]
}): Record<string, unknown> {
  const parsed = args.segments.map((segment) => parseSegment(segment, args.turnId))
  if (parsed.some((segment) => segment === null) || parsed[parsed.length - 1]?.kind !== 'turn_footer') {
    throw new Error('Cannot persist non-terminal or invalid transcript turn snapshot')
  }
  return {
    schemaVersion: APP_TRANSCRIPT_TURN_SNAPSHOT_SCHEMA_VERSION,
    threadId: args.threadId,
    turnId: args.turnId,
    segments: parsed as TranscriptSegment[],
  }
}

export async function readPersistedTranscriptProjectionSnapshot(args: {
  filePath: string
  threadId: string
}): Promise<ProjectionSnapshot | null> {
  const order: string[] = []
  const segmentsByTurnId = new Map<string, TranscriptSegment[]>()
  let firstAppTurnId: string | null = null
  let transcriptContentBeforeFirstAppTurn = false
  let completeCoverage = true
  const startedTurnIds = new Set<string>()
  const input = fs.createReadStream(args.filePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })

  for await (const line of lines) {
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    let record: unknown
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(record)) continue
    if (order.length === 0) {
      if ((record.type === 'ui_msg' || record.type === 'history_state') && !firstAppTurnId) {
        transcriptContentBeforeFirstAppTurn = true
      }
    }
    if (record.type === 'event' && record.name === 'app_turn_started' && isRecord(record.data)) {
      const startedTurnId = readNonEmptyString(record.data.turnId)
      firstAppTurnId ??= startedTurnId
      if (startedTurnId) startedTurnIds.add(startedTurnId)
    }
    if (record.type !== 'event' || record.name !== APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME) {
      continue
    }
    const snapshot = parsePersistedTranscriptTurnSnapshot(record.data, args.threadId)
    if (!snapshot) continue
    if (order.length === 0) {
      completeCoverage = !transcriptContentBeforeFirstAppTurn && (!firstAppTurnId || firstAppTurnId === snapshot.turnId)
    }
    if (!segmentsByTurnId.has(snapshot.turnId)) order.push(snapshot.turnId)
    segmentsByTurnId.set(snapshot.turnId, snapshot.segments)
  }

  if (
    order.length === 0 ||
    !completeCoverage ||
    [...startedTurnIds].some((turnId) => !segmentsByTurnId.has(turnId))
  ) {
    return null
  }
  const segments = order.flatMap((turnId) => segmentsByTurnId.get(turnId) ?? [])
  const toolNameByUseId: Record<string, string> = {}
  for (const segment of segments) {
    if (segment.kind !== 'tool' || segment.toolName === 'Tool') continue
    toolNameByUseId[segment.toolUseId] = segment.toolName
  }
  return {
    segments,
    lastReplaySeq: 0,
    toolNameByUseId,
    openAssistantSegmentIdByTurn: {},
    openThinkingSegmentIdByTurn: {},
  }
}
