import fs from 'node:fs'
import readline from 'node:readline'
import { coerceNonEmptyString, isObject } from './validation'

export const DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME =
  'durable_tool_result_content_replacement_applied'

export type DurableToolResultContentReplacementSourceScopeDto =
  | { kind: 'main_thread' }
  | { kind: 'sidechain'; id: string }

export type DurableToolResultContentReplacementDto = {
  kind: 'tool_result_block'
  toolUseId: string
  replacementContent: string
  originalContentFingerprint?: string
  reason?: string
}

export type DurableToolResultContentReplacementEventDto = {
  type: 'durable_tool_result_content_replacement_applied'
  schemaVersion: 1
  source: 'tool_result_content_replacement'
  sourceScope?: DurableToolResultContentReplacementSourceScopeDto
  compactBoundaryFingerprint: string | null
  baseProjectionFingerprint: string | null
  sourceProjectionKind?: string
  replacements: DurableToolResultContentReplacementDto[]
}

export type DurableToolResultPromptMessageDto = {
  role: 'user' | 'assistant'
  content: unknown[]
  meta?: Record<string, unknown>
}

export type DurableToolResultHistoryStateDto = {
  type: 'history_state'
  messages: DurableToolResultPromptMessageDto[]
}

export type DurableToolResultContentReplacementSessionRecordDto =
  | DurableToolResultContentReplacementEventDto
  | DurableToolResultHistoryStateDto

function parseSourceScope(value: unknown): DurableToolResultContentReplacementSourceScopeDto | null {
  if (!isObject(value)) return null
  if (value.kind === 'main_thread') return { kind: 'main_thread' }
  if (value.kind === 'sidechain') {
    const id = coerceNonEmptyString(value.id)
    return id ? { kind: 'sidechain', id } : null
  }
  return null
}

function parseReplacement(value: unknown): DurableToolResultContentReplacementDto | null {
  if (!isObject(value) || value.kind !== 'tool_result_block') return null
  const toolUseId = coerceNonEmptyString(value.toolUseId)
  const replacementContent = coerceNonEmptyString(value.replacementContent)
  if (!toolUseId || !replacementContent) return null
  const originalContentFingerprint = coerceNonEmptyString(value.originalContentFingerprint)
  const reason = coerceNonEmptyString(value.reason)
  return {
    kind: 'tool_result_block',
    toolUseId,
    replacementContent,
    ...(originalContentFingerprint ? { originalContentFingerprint } : {}),
    ...(reason ? { reason } : {}),
  }
}

function parseReplacements(value: unknown): DurableToolResultContentReplacementDto[] | null {
  if (!Array.isArray(value)) return null
  const replacements = value
    .map(parseReplacement)
    .filter((entry): entry is DurableToolResultContentReplacementDto => Boolean(entry))
  return replacements.length === value.length ? replacements : null
}

function parseHistoryPromptMessageDto(value: unknown): DurableToolResultPromptMessageDto | null {
  if (!isObject(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (!Array.isArray(value.content)) return null
  return {
    role: value.role,
    content: value.content,
    ...(isObject(value.meta) ? { meta: value.meta as Record<string, unknown> } : {}),
  }
}

function parseHistoryStateDto(record: unknown): DurableToolResultHistoryStateDto | null {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return null
  return {
    type: 'history_state',
    messages: record.messages
      .map((message) => parseHistoryPromptMessageDto(message))
      .filter((message): message is DurableToolResultPromptMessageDto => Boolean(message)),
  }
}

function parseDurableToolResultReplacementEventDto(
  data: unknown,
): DurableToolResultContentReplacementEventDto | null {
  if (!isObject(data) || data.schemaVersion !== 1) return null
  if (data.source !== 'tool_result_content_replacement') return null
  const sourceScope = data.sourceScope === undefined ? undefined : parseSourceScope(data.sourceScope)
  if (data.sourceScope !== undefined && !sourceScope) return null
  const replacements = parseReplacements(data.replacements)
  if (!replacements) return null
  const sourceProjectionKind = coerceNonEmptyString(data.sourceProjectionKind)
  return {
    type: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
    schemaVersion: 1,
    source: 'tool_result_content_replacement',
    ...(sourceScope ? { sourceScope } : {}),
    compactBoundaryFingerprint: coerceNonEmptyString(data.compactBoundaryFingerprint),
    baseProjectionFingerprint: coerceNonEmptyString(data.baseProjectionFingerprint),
    ...(sourceProjectionKind ? { sourceProjectionKind } : {}),
    replacements,
  }
}

function parseSessionRecord(record: unknown): DurableToolResultContentReplacementSessionRecordDto | null {
  const historyState = parseHistoryStateDto(record)
  if (historyState) return historyState

  if (!isObject(record) || record.type !== 'event') return null
  if (coerceNonEmptyString(record.name) !== DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME) return null
  return parseDurableToolResultReplacementEventDto(record.data)
}

export async function readDurableToolResultContentReplacementSessionRecordsFromSession(args: {
  filePath: string
}): Promise<DurableToolResultContentReplacementSessionRecordDto[]> {
  const records: DurableToolResultContentReplacementSessionRecordDto[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = parseSessionRecord(parsed)
    if (record) records.push(record)
  }

  return records
}

export function readDurableToolResultContentReplacementSessionRecordsFromSessionSync(args: {
  filePath: string
}): DurableToolResultContentReplacementSessionRecordDto[] {
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return []
  }

  const records: DurableToolResultContentReplacementSessionRecordDto[] = []
  for (const line of raw.split('\n')) {
    const trimmed = String(line).trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const record = parseSessionRecord(parsed)
    if (record) records.push(record)
  }
  return records
}
