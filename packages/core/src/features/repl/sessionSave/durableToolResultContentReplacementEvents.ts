import fs from 'node:fs'
import readline from 'node:readline'
import {
  findLatestCompactBoundaryIndex,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import type {
  DurableToolResultContentReplacement,
  DurableToolResultContentReplacementSourceScope,
  DurableToolResultContentReplacementState,
} from '../../../chat/context/contextProjection'
import type { PromptMessage } from '../../../prompts'

export const DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME =
  'durable_tool_result_content_replacement_applied'

const MAIN_THREAD_SCOPE: DurableToolResultContentReplacementSourceScope = { kind: 'main_thread' }

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseSourceScope(value: unknown): DurableToolResultContentReplacementSourceScope | null {
  if (!isObject(value)) return null
  if (value.kind === 'main_thread') return MAIN_THREAD_SCOPE
  if (value.kind === 'sidechain') {
    const id = coerceNonEmptyString(value.id)
    return id ? { kind: 'sidechain', id } : null
  }
  return null
}

function sameSourceScope(
  left: DurableToolResultContentReplacementSourceScope,
  right: DurableToolResultContentReplacementSourceScope,
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'main_thread') return true
  return left.id === (right as { kind: 'sidechain'; id: string }).id
}

function parseReplacement(value: unknown): DurableToolResultContentReplacement | null {
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

function parseReplacements(value: unknown): DurableToolResultContentReplacement[] | null {
  if (!Array.isArray(value)) return null
  const replacements = value.map(parseReplacement).filter((entry): entry is DurableToolResultContentReplacement =>
    Boolean(entry),
  )
  return replacements.length === value.length ? replacements : null
}

function readActiveCompactBoundaryFingerprint(record: unknown): string | null | undefined {
  if (!isObject(record) || record.type !== 'history_state' || !Array.isArray(record.messages)) return undefined
  const messages = record.messages as PromptMessage[]
  const boundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (boundaryIndex < 0) return undefined
  return fingerprintCompactBoundaryMessage(messages[boundaryIndex]!)
}

function emptyState(scope: DurableToolResultContentReplacementSourceScope): DurableToolResultContentReplacementState {
  return {
    schemaVersion: 1,
    sourceScope: scope,
    activeCompactBoundaryFingerprint: null,
    replacements: [],
  }
}

function applyActiveCompactBoundaryFingerprint(args: {
  state: DurableToolResultContentReplacementState
  activeCompactBoundaryFingerprint: string | null
}): DurableToolResultContentReplacementState {
  if (
    args.activeCompactBoundaryFingerprint &&
    args.state.replacements.length > 0 &&
    args.state.activeCompactBoundaryFingerprint !== args.activeCompactBoundaryFingerprint
  ) {
    return {
      schemaVersion: 1,
      sourceScope: args.state.sourceScope,
      activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
      ...(args.state.baseProjectionFingerprint ? { baseProjectionFingerprint: args.state.baseProjectionFingerprint } : {}),
      ...(args.state.sourceProjectionKind ? { sourceProjectionKind: args.state.sourceProjectionKind } : {}),
      replacements: [],
    }
  }
  return {
    ...args.state,
    activeCompactBoundaryFingerprint: args.activeCompactBoundaryFingerprint,
  }
}

function applyDurableToolResultReplacementEvent(args: {
  state: DurableToolResultContentReplacementState
  data: unknown
  sourceScope: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  if (!isObject(args.data) || args.data.schemaVersion !== 1) return args.state
  if (args.data.source !== 'tool_result_content_replacement') return args.state
  const eventSourceScope =
    args.data.sourceScope === undefined ? MAIN_THREAD_SCOPE : parseSourceScope(args.data.sourceScope)
  if (!eventSourceScope) return args.state
  if (!sameSourceScope(eventSourceScope, args.sourceScope)) return args.state
  const eventCompactBoundaryFingerprint = coerceNonEmptyString(args.data.compactBoundaryFingerprint)
  if (
    eventCompactBoundaryFingerprint &&
    args.state.activeCompactBoundaryFingerprint &&
    eventCompactBoundaryFingerprint !== args.state.activeCompactBoundaryFingerprint
  ) {
    return args.state
  }
  if (!eventCompactBoundaryFingerprint && args.state.activeCompactBoundaryFingerprint) return args.state
  const replacements = parseReplacements(args.data.replacements)
  if (!replacements) return args.state
  const baseProjectionFingerprint = coerceNonEmptyString(args.data.baseProjectionFingerprint)
  const sourceProjectionKind =
    args.data.sourceProjectionKind === 'model_facing_baseline' ? args.data.sourceProjectionKind : null
  return {
    schemaVersion: 1,
    sourceScope: eventSourceScope,
    activeCompactBoundaryFingerprint: args.state.activeCompactBoundaryFingerprint ?? eventCompactBoundaryFingerprint,
    baseProjectionFingerprint: baseProjectionFingerprint ?? null,
    sourceProjectionKind,
    replacements,
  }
}

function readDurableToolResultReplacementStateFromParsedLine(args: {
  state: DurableToolResultContentReplacementState
  parsed: unknown
  sourceScope: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  const nextActiveCompactBoundaryFingerprint = readActiveCompactBoundaryFingerprint(args.parsed)
  let state = args.state
  if (nextActiveCompactBoundaryFingerprint !== undefined) {
    state = applyActiveCompactBoundaryFingerprint({
      state,
      activeCompactBoundaryFingerprint: nextActiveCompactBoundaryFingerprint,
    })
  }
  if (!isObject(args.parsed) || args.parsed.type !== 'event') return state
  if (coerceNonEmptyString(args.parsed.name) !== DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME) return state
  return applyDurableToolResultReplacementEvent({ state, data: args.parsed.data, sourceScope: args.sourceScope })
}

export async function readDurableToolResultContentReplacementStateFromSession(args: {
  filePath: string
  sourceScope?: DurableToolResultContentReplacementSourceScope
}): Promise<DurableToolResultContentReplacementState> {
  const sourceScope = args.sourceScope ?? MAIN_THREAD_SCOPE
  let state = emptyState(sourceScope)
  const rl = readline.createInterface({
    input: fs.createReadStream(args.filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of rl) {
    const trimmed = String(line).trimEnd()
    if (!trimmed) continue
    try {
      state = readDurableToolResultReplacementStateFromParsedLine({
        state,
        parsed: JSON.parse(trimmed),
        sourceScope,
      })
    } catch {
      continue
    }
  }
  return state
}

export function readDurableToolResultContentReplacementStateFromSessionSync(args: {
  filePath: string
  sourceScope?: DurableToolResultContentReplacementSourceScope
}): DurableToolResultContentReplacementState {
  const sourceScope = args.sourceScope ?? MAIN_THREAD_SCOPE
  let state = emptyState(sourceScope)
  let raw = ''
  try {
    raw = fs.readFileSync(args.filePath, 'utf8')
  } catch {
    return state
  }
  for (const line of raw.split('\n')) {
    const trimmed = String(line).trim()
    if (!trimmed) continue
    try {
      state = readDurableToolResultReplacementStateFromParsedLine({
        state,
        parsed: JSON.parse(trimmed),
        sourceScope,
      })
    } catch {
      continue
    }
  }
  return state
}
