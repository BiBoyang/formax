import type { CanonicalToolEvent } from '../../semantics/core/canonicalEvents'

type PersistedAppToolEventData = {
  threadId: string
  turnId: string
  toolUseId: string
  phase: 'start' | 'update' | 'end'
  toolName?: string
  status?: 'running' | 'completed' | 'error'
  summary?: string
  input?: Record<string, unknown>
  paramsText?: string
  line?: string
  lines?: string[]
  patchStartLineNumber?: number
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parsePatchStartLineNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value <= 0) return undefined
  return Math.floor(value)
}

function splitResultLines(result: string): string[] {
  return result
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => Boolean(line.trim()))
    .slice(0, 80)
}

export function toPersistedAppToolEventData(event: CanonicalToolEvent): PersistedAppToolEventData {
  const toolName = coerceNonEmptyString(event.toolName) ?? undefined
  const base: PersistedAppToolEventData = {
    threadId: event.threadId,
    turnId: event.turnId,
    toolUseId: event.toolUseId,
    phase: event.phase,
    ...(toolName ? { toolName } : {}),
  }

  if (event.phase === 'start') {
    return {
      ...base,
      status: 'running',
      summary: coerceNonEmptyString(event.summary) ?? `${toolName ?? 'Tool'} running`,
    }
  }

  if (event.phase === 'update') {
    return {
      ...base,
      ...(isObject(event.input) ? { input: event.input } : {}),
      ...(coerceNonEmptyString(event.paramsText) ? { paramsText: event.paramsText } : {}),
      ...(coerceNonEmptyString(event.line) ? { line: event.line } : {}),
    }
  }

  const status: 'completed' | 'error' = event.isError ? 'error' : 'completed'
  const rawResult = coerceNonEmptyString(event.result) ?? ''
  const lines = rawResult ? splitResultLines(rawResult) : []
  const patchStartLineNumber = parsePatchStartLineNumber(event.patchStartLineNumber)
  const summary =
    coerceNonEmptyString(event.summary) ??
    lines[0] ??
    (status === 'error' ? 'Tool failed' : 'Tool completed')

  return {
    ...base,
    status,
    summary,
    ...(lines.length > 0 ? { lines } : {}),
    ...(patchStartLineNumber !== undefined ? { patchStartLineNumber } : {}),
  }
}
