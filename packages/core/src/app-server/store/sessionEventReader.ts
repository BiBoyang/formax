import fs from 'node:fs'
import readline from 'node:readline'
import type { InputKind, InputResolvedPayload } from '../protocol/input.js'
import { isInputKind } from '../../shared/inputContracts.js'
import {
  createPersistedToolEventAggregator,
  type PersistedToolMessage,
} from '../../features/repl/sessionSave/persistedToolEvents.js'
import {
  readLatestRequestCollapseEventFromSession as readLatestRequestCollapseEventFromSharedSession,
  readRequestCollapseEventsFromSession as readRequestCollapseEventsFromSharedSession,
  inspectRequestCollapseEventsFromSession as inspectRequestCollapseEventsFromSharedSession,
  type PersistedRequestCollapseEvent,
  type PersistedRequestCollapseInspection,
} from '../../features/repl/sessionSave/requestCollapseEvents.js'

type PendingInput = {
  inputId: string
  threadId: string
  turnId: string
  toolUseId: string
  kind: InputKind
  createdAt: string
  expiresAt: string
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
  if (!isInputKind(kind)) return null
  return { inputId, threadId, turnId, toolUseId, kind, createdAt, expiresAt }
}

function parseResolvedInputId(data: unknown): string | null {
  if (!isObject(data)) return null
  return coerceNonEmptyString(data.inputId)
}

function parseOccurredAtMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
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
    const trimmed = String(line).trimEnd()
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
  const aggregator = createPersistedToolEventAggregator()

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
    if (!isObject(parsed)) continue
    if (parsed.type !== 'event') continue
    if (coerceNonEmptyString(parsed.name) !== 'app_tool_event') continue
    aggregator.ingest({
      ts: parsed.ts,
      data: parsed.data,
    })
  }

  return aggregator.finalize()
}

export async function readRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent[]> {
  return readRequestCollapseEventsFromSharedSession(args)
}

export async function readLatestRequestCollapseEventFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseEvent | null> {
  return readLatestRequestCollapseEventFromSharedSession(args)
}

export async function inspectRequestCollapseEventsFromSession(args: {
  filePath: string
}): Promise<PersistedRequestCollapseInspection> {
  return inspectRequestCollapseEventsFromSharedSession(args)
}
