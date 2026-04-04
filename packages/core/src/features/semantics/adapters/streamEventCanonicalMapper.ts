import type { CanonicalEvent } from '../core/canonicalEvents'
import type { PromptMessageMeta } from '../../../prompts/types'
import { formatToolInputAsParamsText } from '@formax/shared/paramsText'
import { toolResultContentToText } from '@formax/shared/utils/toolResultContent'
import { readCanonicalToolEndSummary, readCanonicalToolUpdateLine } from './toolEventCanonicalFields'

type StreamPayloadEvent = Record<string, unknown>

type CanonicalEnvelope = Pick<CanonicalEvent, 'schemaVersion' | 'threadId' | 'replaySeq' | 'eventId' | 'ts' | 'source'>

type StreamEventCanonicalMapperOptions = {
  turnId: string
  nextReplaySeq: () => number
  envelopeFor: (args: { kind: CanonicalEvent['kind']; replaySeq: number }) => CanonicalEnvelope
  inferFailureStatus: (message: string) => 'failed' | 'interrupted'
  resolveThinkingDeltaText?: (event: StreamPayloadEvent) => string
  includeToolNameOnNonStart?: boolean
  includeToolProgressFieldsOnEnd?: boolean
  includeCompletedSummaryFallbackOnToolEnd?: boolean
  alwaysIncludeToolEndIsError?: boolean
}

function readToolUseId(event: StreamPayloadEvent): string {
  const raw = event.id ?? event.toolUseId
  return typeof raw === 'string' ? raw.trim() : ''
}

function readToolName(event: StreamPayloadEvent): string | undefined {
  const raw = event.name
  return typeof raw === 'string' && raw.trim() ? raw : undefined
}

function readToolInput(event: StreamPayloadEvent): Record<string, unknown> | undefined {
  if (event.input && typeof event.input === 'object' && !Array.isArray(event.input)) {
    return event.input as Record<string, unknown>
  }
  return undefined
}

function readCompactBoundary(event: StreamPayloadEvent): PromptMessageMeta['compactBoundary'] | undefined {
  const boundary = event.boundary
  if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) return undefined
  return (boundary as { schemaVersion?: unknown }).schemaVersion === 1
    ? (boundary as PromptMessageMeta['compactBoundary'])
    : undefined
}

function readToolResultContent(event: StreamPayloadEvent): string {
  const result = event.result
  if (!result || typeof result !== 'object') return ''
  return toolResultContentToText((result as Record<string, unknown>).content as any)
}

function readToolResultError(event: StreamPayloadEvent): boolean {
  const result = event.result
  if (!result || typeof result !== 'object') return false
  return Boolean((result as Record<string, unknown>).is_error)
}

function readPatchStartLineNumber(event: StreamPayloadEvent): number | undefined {
  const raw = event.patchStartLineNumber
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  if (raw <= 0) return undefined
  return Math.floor(raw)
}

function readToolNestedTools(event: StreamPayloadEvent):
  | Array<{
      id: string
      name: string
      input: Record<string, unknown>
      status: 'running' | 'completed' | 'error'
      summary?: string
    }>
  | null {
  if (!Array.isArray(event.nestedTools)) return null
  const nested = (event.nestedTools as Array<Record<string, unknown>>)
    .map((item) => {
      const id = typeof item.id === 'string' ? item.id : ''
      const name = typeof item.name === 'string' ? item.name : ''
      const status = item.status
      if (!id || !name || (status !== 'running' && status !== 'completed' && status !== 'error')) return null
      const nestedStatus = status as 'running' | 'completed' | 'error'
      const input =
        item.input && typeof item.input === 'object' && !Array.isArray(item.input)
          ? (item.input as Record<string, unknown>)
          : {}
      const summary = typeof item.summary === 'string' ? item.summary : undefined
      return { id, name, input, status: nestedStatus, ...(summary ? { summary } : {}) }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
  return nested.length > 0 ? nested : null
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return String((error as Record<string, unknown>).message)
  }
  return 'stream error'
}

function appendToolProgressFields(
  out: Record<string, unknown>,
  event: StreamPayloadEvent,
): void {
  if (Array.isArray(event.middleLines)) out.middleLines = event.middleLines
  if (Array.isArray(event.transcriptLines)) out.transcriptLines = event.transcriptLines
  const nestedTools = readToolNestedTools(event)
  if (nestedTools) out.nestedTools = nestedTools
  if (typeof event.toolUses === 'number') out.toolUses = event.toolUses
  if (event.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)) out.usage = event.usage
}

export function toCanonicalEventsFromStreamPayload(
  event: StreamPayloadEvent,
  options: StreamEventCanonicalMapperOptions,
): CanonicalEvent[] {
  if (!options.turnId.trim()) return []
  const type = typeof event.type === 'string' ? event.type : ''
  if (!type) return []

  const replaySeq = () => options.nextReplaySeq()
  const toEnvelope = (kind: CanonicalEvent['kind'], seq: number) =>
    options.envelopeFor({ kind, replaySeq: seq })

  if (type === 'assistant_delta') {
    const textDelta = String(event.text ?? '')
    if (!textDelta) return []
    const seq = replaySeq()
    return [{ ...toEnvelope('assistant_delta', seq), kind: 'assistant_delta', turnId: options.turnId, textDelta }]
  }

  if (type === 'compact_boundary') {
    const boundary = readCompactBoundary(event)
    const seq = replaySeq()
    return [
      {
        ...toEnvelope('system_message', seq),
        kind: 'system_message',
        turnId: options.turnId,
        role: 'assistant',
        text: '',
        uiKind: 'compact_boundary',
        ...(boundary ? { compactBoundary: boundary } : {}),
      },
    ]
  }

  if (type === 'thinking_delta') {
    const textDelta = options.resolveThinkingDeltaText
      ? options.resolveThinkingDeltaText(event)
      : String(event.thinking ?? '')
    if (!textDelta) return []
    const seq = replaySeq()
    return [{ ...toEnvelope('thinking_delta', seq), kind: 'thinking_delta', turnId: options.turnId, textDelta }]
  }

  if (type === 'thinking_stop') {
    const seq = replaySeq()
    return [{ ...toEnvelope('thinking_finalized', seq), kind: 'thinking_finalized', turnId: options.turnId }]
  }

  if (type === 'tool_start' || type === 'tool_input' || type === 'tool_update' || type === 'tool_end') {
    const toolUseId = readToolUseId(event)
    if (!toolUseId) return []
    const seq = replaySeq()
    const phase = type === 'tool_start' ? 'start' : type === 'tool_end' ? 'end' : 'update'
    const toolName = readToolName(event)
    const line = type === 'tool_update' ? readCanonicalToolUpdateLine(event) : undefined
    const summary =
      type === 'tool_end'
        ? readCanonicalToolEndSummary(event, {
            includeCompletedFallback: Boolean(options.includeCompletedSummaryFallbackOnToolEnd),
          })
        : undefined
    const input = readToolInput(event)
    const paramsText = formatToolInputAsParamsText(event.input)
    const result = type === 'tool_end' ? readToolResultContent(event) : ''
    const isError = type === 'tool_end' ? readToolResultError(event) : false
    const patchStartLineNumber = readPatchStartLineNumber(event)

    const toolEvent: Record<string, unknown> = {
      ...toEnvelope('tool_event', seq),
      kind: 'tool_event',
      turnId: options.turnId,
      toolUseId,
      phase,
    }
    if (toolName && (type === 'tool_start' || options.includeToolNameOnNonStart)) {
      toolEvent.toolName = toolName
    }
    if (input) toolEvent.input = input
    if (paramsText) toolEvent.paramsText = paramsText
    if (line) toolEvent.line = line
    if (summary) toolEvent.summary = summary
    if (result) toolEvent.result = result
    if (isError || options.alwaysIncludeToolEndIsError) toolEvent.isError = isError
    if (patchStartLineNumber !== undefined) toolEvent.patchStartLineNumber = patchStartLineNumber
    if (type === 'tool_update' || (type === 'tool_end' && options.includeToolProgressFieldsOnEnd)) {
      appendToolProgressFields(toolEvent, event)
    }

    return [toolEvent as CanonicalEvent]
  }

  if (type === 'complete') {
    const finalizeSeq = replaySeq()
    const footerSeq = replaySeq()
    return [
      { ...toEnvelope('thinking_finalized', finalizeSeq), kind: 'thinking_finalized', turnId: options.turnId },
      {
        ...toEnvelope('turn_footer', footerSeq),
        kind: 'turn_footer',
        turnId: options.turnId,
        status: 'completed',
      },
    ]
  }

  if (type === 'error') {
    const message = readErrorMessage(event.error)
    const finalizeSeq = replaySeq()
    const footerSeq = replaySeq()
    return [
      { ...toEnvelope('thinking_finalized', finalizeSeq), kind: 'thinking_finalized', turnId: options.turnId },
      {
        ...toEnvelope('turn_footer', footerSeq),
        kind: 'turn_footer',
        turnId: options.turnId,
        status: options.inferFailureStatus(message),
        message,
      },
    ]
  }

  return []
}
