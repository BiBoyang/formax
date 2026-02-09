import fs from 'node:fs'
import readline from 'node:readline'
import type { InputKind, InputResolvedPayload } from '../protocol/input.js'

type PendingInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: InputKind
  createdAt: string
  expiresAt: string
}

export type PersistedToolMessage = {
  id: string
  occurredAtMs: number
  sequence: number
  toolUseId?: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  paramsText?: string
  detailLines: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePendingInput(data: unknown): PendingInput | null {
  if (!isObject(data)) return null
  const inputId = coerceNonEmptyString(data.inputId)
  const threadId = coerceNonEmptyString(data.threadId)
  const turnId = coerceNonEmptyString(data.turnId)
  const toolUseId = coerceNonEmptyString(data.toolUseId)
  const kind = coerceNonEmptyString(data.kind)
  const createdAt = coerceNonEmptyString(data.createdAt)
  const expiresAt = coerceNonEmptyString(data.expiresAt)
  if (!inputId || !threadId || !turnId || !toolUseId || !createdAt || !expiresAt) return null
  if (kind !== 'approval' && kind !== 'ask_user_question') return null
  return { inputId, threadId, turnId, toolUseId, kind, createdAt, expiresAt }
}

function parseResolvedInputId(data: unknown): string | null {
  if (!isObject(data)) return null
  return coerceNonEmptyString(data.inputId)
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function appendUniqueLine(lines: string[], line: string): void {
  const normalized = line.trim()
  if (!normalized) return
  if (lines[lines.length - 1] === normalized) return
  lines.push(normalized)
}

function parseToolStatus(value: unknown): 'running' | 'completed' | 'error' | null {
  if (value === 'error') return 'error'
  if (value === 'running') return 'running'
  if (value === 'completed') return 'completed'
  return null
}

function parseLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const lines: string[] = []
  for (const line of value) {
    if (typeof line !== 'string') continue
    const trimmed = line.trim()
    if (!trimmed) continue
    lines.push(trimmed)
  }
  return lines
}

function toStaleInput(input: PendingInput, resolvedAt: string): InputResolvedPayload {
  return {
    inputId: input.inputId,
    threadId: input.threadId,
    turnId: input.turnId,
    toolUseId: input.toolUseId,
    kind: input.kind,
    status: 'expired',
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    resolvedAt,
    reason: 'server_restart',
  }
}

export async function readStaleInputsFromSession(args: { filePath: string; now?: Date }): Promise<InputResolvedPayload[]> {
  const pendingByInputId = new Map<string, PendingInput>()
  const resolvedAt = (args.now ?? new Date()).toISOString()

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = String(line ?? '').trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue

    const name = coerceNonEmptyString(parsed.name)
    if (!name) continue

    if (name === 'app_input_requested') {
      const pending = parsePendingInput(parsed.data)
      if (!pending) continue
      pendingByInputId.set(pending.inputId, pending)
      continue
    }

    if (name === 'app_input_resolved') {
      const inputId = parseResolvedInputId(parsed.data)
      if (!inputId) continue
      pendingByInputId.delete(inputId)
    }
  }

  return Array.from(pendingByInputId.values()).map((pending) => toStaleInput(pending, resolvedAt))
}

export async function readPersistedToolMessagesFromSession(args: { filePath: string }): Promise<PersistedToolMessage[]> {
  const byKey = new Map<string, PersistedToolMessage>()
  const activeAnonymousKeyByBucket = new Map<string, string>()
  let sequence = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = String(line ?? '').trimEnd()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'app_tool_event') continue
    if (!isObject(parsed.data)) continue

    const data = parsed.data
    const toolUseId = coerceNonEmptyString(data.toolUseId) ?? undefined
    const turnId = coerceNonEmptyString(data.turnId) ?? 'turn'
    const toolName = coerceNonEmptyString(data.toolName) ?? 'Tool'
    const phase = coerceNonEmptyString(data.phase)
    const bucketKey = `${turnId}:${toolName}`
    let key: string
    if (toolUseId) {
      key = toolUseId
    } else {
      if (phase === 'start' || !activeAnonymousKeyByBucket.has(bucketKey)) {
        activeAnonymousKeyByBucket.set(bucketKey, `anon:${bucketKey}:${sequence}`)
      }
      key = activeAnonymousKeyByBucket.get(bucketKey) ?? `anon:${bucketKey}:${sequence}`
    }
    const ts = parseTimestampMs(parsed.ts)
    const summary = coerceNonEmptyString(data.summary)
    const paramsText = coerceNonEmptyString(data.paramsText) ?? undefined
    const status = parseToolStatus(data.status)
    const lineValue = coerceNonEmptyString(data.line)
    const linesValue = parseLines(data.lines)

    let current = byKey.get(key)
    if (!current) {
      current = {
        id: `tool-${key}`,
        occurredAtMs: ts,
        sequence,
        ...(toolUseId ? { toolUseId } : {}),
        toolName,
        status: status ?? 'running',
        summary: summary ?? `${toolName} running`,
        ...(paramsText ? { paramsText } : {}),
        detailLines: [],
      }
      byKey.set(key, current)
    }

    current.toolName = toolName
    if (status) current.status = status
    if (summary) current.summary = summary
    if (paramsText) current.paramsText = paramsText
    if (lineValue) appendUniqueLine(current.detailLines, lineValue)
    for (const detailLine of linesValue) appendUniqueLine(current.detailLines, detailLine)
    if (current.occurredAtMs === 0 && ts > 0) current.occurredAtMs = ts

    const terminal = phase === 'end' || status === 'completed' || status === 'error'
    if (!toolUseId && terminal) {
      activeAnonymousKeyByBucket.delete(bucketKey)
    }
    sequence += 1
  }

  const out = Array.from(byKey.values())
  for (const message of out) {
    if (!message.summary) {
      message.summary = message.detailLines[0] ?? `${message.toolName} completed`
    }
  }
  out.sort((a, b) => {
    if (a.occurredAtMs !== b.occurredAtMs) return a.occurredAtMs - b.occurredAtMs
    return a.sequence - b.sequence
  })
  return out
}
