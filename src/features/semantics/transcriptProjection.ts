import type {
  CanonicalEvent,
  CanonicalMessageUiKind,
  ToolInputKind,
  ToolInputStatus,
} from './canonicalEvents'
import type { TokenUsage } from '../../streaming/types'

export type UserSegment = {
  id: string
  kind: 'user'
  turnId: string
  text: string
  uiKind?: Extract<CanonicalMessageUiKind, 'compact_summary'>
}

export type SystemSegment = {
  id: string
  kind: 'system'
  turnId: string
  role: 'assistant' | 'user'
  text: string
  uiKind?: CanonicalMessageUiKind
}

export type AssistantSegment = {
  id: string
  kind: 'assistant'
  turnId: string
  text: string
}

export type ThinkingSegment = {
  id: string
  kind: 'thinking'
  turnId: string
  text: string
  status: 'running' | 'finalized'
}

export type ToolSegment = {
  id: string
  kind: 'tool'
  turnId: string
  toolUseId: string
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
  input?: Record<string, unknown>
  result?: string
  resultLines?: number
  expandInfo?: string
  middleLines?: string[]
  transcriptLines?: string[]
  nestedTools?: Array<{
    id: string
    name: string
    input: Record<string, unknown>
    status: 'running' | 'completed' | 'error'
    summary?: string
  }>
  toolUses?: number
  usage?: TokenUsage
  durationMs?: number
  patchStartLineNumber?: number
  hideSummaryContent?: boolean
  startedAtMs?: number
  paramsText?: string
  inputState?: {
    kind: ToolInputKind
    status: ToolInputStatus
  }
}

export type TurnFooterSegment = {
  id: string
  kind: 'turn_footer'
  turnId: string
  status: 'completed' | 'failed' | 'interrupted'
  message?: string
}

export type TranscriptSegment =
  | UserSegment
  | SystemSegment
  | AssistantSegment
  | ThinkingSegment
  | ToolSegment
  | TurnFooterSegment

export type TranscriptProjectionState = {
  threadId: string
  segments: TranscriptSegment[]
  seenEventIds: Set<string>
  lastReplaySeq: number
  toolNameByUseId: Record<string, string>
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

function toSegmentId(args: { kind: TranscriptSegment['kind']; replaySeq: number; turnId: string; suffix?: string }): string {
  return args.suffix
    ? `${args.turnId}:${args.kind}:${args.replaySeq}:${args.suffix}`
    : `${args.turnId}:${args.kind}:${args.replaySeq}`
}

function dedupeAppend(lines: string[], line: string | undefined): string[] {
  const text = String(line ?? '').trim()
  if (!text) return lines
  if (lines[lines.length - 1] === text) return lines
  return [...lines, text]
}

function findOpenSegmentIndexById(segments: TranscriptSegment[], id: string | undefined): number {
  if (!id) return -1
  return segments.findIndex((segment) => segment.id === id)
}

function findToolSegmentIndex(args: { segments: TranscriptSegment[]; turnId: string; toolUseId: string }): number {
  for (let index = args.segments.length - 1; index >= 0; index -= 1) {
    const segment = args.segments[index]
    if (segment.kind !== 'tool') continue
    if (segment.turnId !== args.turnId) continue
    if (segment.toolUseId !== args.toolUseId) continue
    return index
  }
  return -1
}

type ProjectionDraft = {
  segments: TranscriptSegment[]
  toolNameByUseId: Record<string, string>
  openAssistantSegmentIdByTurn: Record<string, string>
  openThinkingSegmentIdByTurn: Record<string, string>
}

function closeAssistantSegment(draft: ProjectionDraft, turnId: string): void {
  if (!Object.prototype.hasOwnProperty.call(draft.openAssistantSegmentIdByTurn, turnId)) return
  const next = { ...draft.openAssistantSegmentIdByTurn }
  delete next[turnId]
  draft.openAssistantSegmentIdByTurn = next
}

function closeThinkingSegment(draft: ProjectionDraft, turnId: string): void {
  const segmentId = draft.openThinkingSegmentIdByTurn[turnId]
  if (!segmentId) return
  const segmentIndex = findOpenSegmentIndexById(draft.segments, segmentId)
  if (segmentIndex >= 0) {
    const current = draft.segments[segmentIndex]
    if (current.kind === 'thinking' && current.status === 'running') {
      draft.segments[segmentIndex] = { ...current, status: 'finalized' }
    }
  }
  const next = { ...draft.openThinkingSegmentIdByTurn }
  delete next[turnId]
  draft.openThinkingSegmentIdByTurn = next
}

function closeTurnTextSegments(draft: ProjectionDraft, turnId: string): void {
  closeAssistantSegment(draft, turnId)
  closeThinkingSegment(draft, turnId)
}

function rebindToolSummaryForName(args: {
  summary: string
  currentToolName: string
  nextToolName: string
  status: ToolSegment['status']
}): string {
  const runningTemplate = `${args.currentToolName} running`
  const completedTemplate = `${args.currentToolName} completed`
  if (args.status === 'running' && args.summary === runningTemplate) {
    return `${args.nextToolName} running`
  }
  if (args.status === 'completed' && args.summary === completedTemplate) {
    return `${args.nextToolName} completed`
  }
  return args.summary
}

function parseTimestampMs(ts: string): number | null {
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : null
}

export function createInitialTranscriptProjectionState(args: { threadId: string }): TranscriptProjectionState {
  return {
    threadId: args.threadId,
    segments: [],
    seenEventIds: new Set<string>(),
    lastReplaySeq: 0,
    toolNameByUseId: {},
    openAssistantSegmentIdByTurn: {},
    openThinkingSegmentIdByTurn: {},
  }
}

export function reduceTranscriptProjection(state: TranscriptProjectionState, event: CanonicalEvent): TranscriptProjectionState {
  if (event.threadId !== state.threadId) return state
  if (state.seenEventIds.has(event.eventId)) return state

  const seenEventIds = new Set(state.seenEventIds)
  seenEventIds.add(event.eventId)
  if (event.replaySeq < state.lastReplaySeq) {
    return {
      ...state,
      seenEventIds,
    }
  }

  const draft: ProjectionDraft = {
    segments: [...state.segments],
    toolNameByUseId: { ...state.toolNameByUseId },
    openAssistantSegmentIdByTurn: { ...state.openAssistantSegmentIdByTurn },
    openThinkingSegmentIdByTurn: { ...state.openThinkingSegmentIdByTurn },
  }

  if (event.kind === 'user_message') {
    if (!event.text && !event.uiKind) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    const next: UserSegment = {
      id: toSegmentId({ kind: 'user', replaySeq: event.replaySeq, turnId: event.turnId }),
      kind: 'user',
      turnId: event.turnId,
      text: event.text,
      ...(event.uiKind ? { uiKind: event.uiKind } : {}),
    }
    draft.segments.push(next)
  }

  if (event.kind === 'system_message') {
    if (!event.text && !event.uiKind) {
      return {
        ...state,
        seenEventIds,
        lastReplaySeq: event.replaySeq,
      }
    }
    const next: SystemSegment = {
      id: toSegmentId({ kind: 'system', replaySeq: event.replaySeq, turnId: event.turnId }),
      kind: 'system',
      turnId: event.turnId,
      role: event.role,
      text: event.text,
      ...(event.uiKind ? { uiKind: event.uiKind } : {}),
    }
    draft.segments.push(next)
  }

  if (event.kind === 'assistant_delta') {
    const text = event.textDelta
    if (text) {
      closeThinkingSegment(draft, event.turnId)
      const openId = draft.openAssistantSegmentIdByTurn[event.turnId]
      const openIndex = findOpenSegmentIndexById(draft.segments, openId)
      if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'assistant') {
        const current = draft.segments[openIndex] as AssistantSegment
        draft.segments[openIndex] = { ...current, text: current.text + text }
      } else {
        const next: AssistantSegment = {
          id: toSegmentId({ kind: 'assistant', replaySeq: event.replaySeq, turnId: event.turnId }),
          kind: 'assistant',
          turnId: event.turnId,
          text,
        }
        draft.segments.push(next)
        draft.openAssistantSegmentIdByTurn[event.turnId] = next.id
      }
    }
  }

  if (event.kind === 'thinking_delta') {
    const text = event.textDelta
    if (text) {
      closeAssistantSegment(draft, event.turnId)
      const openId = draft.openThinkingSegmentIdByTurn[event.turnId]
      const openIndex = findOpenSegmentIndexById(draft.segments, openId)
      if (openIndex >= 0 && draft.segments[openIndex]?.kind === 'thinking') {
        const current = draft.segments[openIndex] as ThinkingSegment
        draft.segments[openIndex] = { ...current, text: current.text + text }
      } else {
        const next: ThinkingSegment = {
          id: toSegmentId({ kind: 'thinking', replaySeq: event.replaySeq, turnId: event.turnId }),
          kind: 'thinking',
          turnId: event.turnId,
          text,
          status: 'running',
        }
        draft.segments.push(next)
        draft.openThinkingSegmentIdByTurn[event.turnId] = next.id
      }
    }
  }

  if (event.kind === 'thinking_finalized') {
    closeThinkingSegment(draft, event.turnId)
  }

  if (event.kind === 'tool_event') {
    closeTurnTextSegments(draft, event.turnId)
    if (event.toolName) {
      draft.toolNameByUseId[event.toolUseId] = event.toolName
    }
    const toolName = event.toolName ?? draft.toolNameByUseId[event.toolUseId] ?? 'Tool'
    const toolIndex = findToolSegmentIndex({
      segments: draft.segments,
      turnId: event.turnId,
      toolUseId: event.toolUseId,
    })
    if (toolIndex >= 0) {
      const current = draft.segments[toolIndex]
      if (current.kind === 'tool') {
        const detailLinesFromEvent =
          Array.isArray(event.middleLines) && event.middleLines.length > 0
            ? event.middleLines.map((line) => String(line ?? '').trim()).filter((line) => line.length > 0)
            : null
        const middleLinesFromEvent =
          Array.isArray(event.middleLines) && event.middleLines.length > 0 ? event.middleLines : undefined
        const transcriptLinesFromEvent =
          Array.isArray(event.transcriptLines) && event.transcriptLines.length > 0 ? event.transcriptLines : undefined
        const nestedToolsFromEvent =
          Array.isArray(event.nestedTools) && event.nestedTools.length > 0 ? event.nestedTools : undefined
        const detailLines = detailLinesFromEvent ?? dedupeAppend(current.detailLines, event.line)
        const status =
          event.phase === 'end'
            ? event.isError
              ? 'error'
              : 'completed'
            : current.status
        const reboundSummary = rebindToolSummaryForName({
          summary: current.summary,
          currentToolName: current.toolName,
          nextToolName: toolName,
          status: current.status,
        })
        const endFallbackSummary = reboundSummary === `${toolName} running` ? `${toolName} completed` : reboundSummary
        const summary =
          event.phase === 'end'
            ? String(event.summary ?? event.line ?? endFallbackSummary)
            : reboundSummary
        const eventTsMs = parseTimestampMs(event.ts)
        const startedAtMs =
          current.startedAtMs !== undefined
            ? current.startedAtMs
            : event.phase === 'start' && eventTsMs !== null
              ? eventTsMs
              : undefined
        const durationMs =
          event.durationMs ??
          (event.phase === 'end' && startedAtMs !== undefined && eventTsMs !== null
            ? Math.max(0, eventTsMs - startedAtMs)
            : current.durationMs)
        draft.segments[toolIndex] = {
          ...current,
          toolName,
          status,
          summary,
          detailLines,
          ...(event.input ? { input: event.input } : {}),
          ...(event.result !== undefined ? { result: event.result } : {}),
          ...(event.resultLines !== undefined ? { resultLines: event.resultLines } : {}),
          ...(event.expandInfo !== undefined ? { expandInfo: event.expandInfo } : {}),
          ...(middleLinesFromEvent !== undefined ? { middleLines: middleLinesFromEvent } : {}),
          ...(transcriptLinesFromEvent !== undefined ? { transcriptLines: transcriptLinesFromEvent } : {}),
          ...(nestedToolsFromEvent !== undefined ? { nestedTools: nestedToolsFromEvent } : {}),
          ...(event.toolUses !== undefined ? { toolUses: event.toolUses } : {}),
          ...(event.usage !== undefined ? { usage: event.usage } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(startedAtMs !== undefined ? { startedAtMs } : {}),
          ...(event.patchStartLineNumber !== undefined ? { patchStartLineNumber: event.patchStartLineNumber } : {}),
          ...(event.hideSummaryContent !== undefined ? { hideSummaryContent: event.hideSummaryContent } : {}),
          ...(event.paramsText ? { paramsText: event.paramsText } : {}),
        }
      }
    } else {
      const initialStatus = event.phase === 'end' ? (event.isError ? 'error' : 'completed') : 'running'
      const detailLinesFromEvent =
        Array.isArray(event.middleLines) && event.middleLines.length > 0
          ? event.middleLines.map((line) => String(line ?? '').trim()).filter((line) => line.length > 0)
          : null
      const middleLinesFromEvent =
        Array.isArray(event.middleLines) && event.middleLines.length > 0 ? event.middleLines : undefined
      const transcriptLinesFromEvent =
        Array.isArray(event.transcriptLines) && event.transcriptLines.length > 0 ? event.transcriptLines : undefined
      const nestedToolsFromEvent =
        Array.isArray(event.nestedTools) && event.nestedTools.length > 0 ? event.nestedTools : undefined
      const eventTsMs = parseTimestampMs(event.ts)
      const next: ToolSegment = {
        id: toSegmentId({ kind: 'tool', replaySeq: event.replaySeq, turnId: event.turnId, suffix: event.toolUseId }),
        kind: 'tool',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        toolName,
        status: initialStatus,
        summary:
          event.phase === 'end'
            ? String(event.summary ?? event.line ?? `${toolName} completed`)
            : `${toolName} running`,
        detailLines: detailLinesFromEvent ?? dedupeAppend([], event.line),
        ...(event.input ? { input: event.input } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.resultLines !== undefined ? { resultLines: event.resultLines } : {}),
        ...(event.expandInfo !== undefined ? { expandInfo: event.expandInfo } : {}),
        ...(middleLinesFromEvent !== undefined ? { middleLines: middleLinesFromEvent } : {}),
        ...(transcriptLinesFromEvent !== undefined ? { transcriptLines: transcriptLinesFromEvent } : {}),
        ...(nestedToolsFromEvent !== undefined ? { nestedTools: nestedToolsFromEvent } : {}),
        ...(event.toolUses !== undefined ? { toolUses: event.toolUses } : {}),
        ...(event.usage !== undefined ? { usage: event.usage } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.patchStartLineNumber !== undefined ? { patchStartLineNumber: event.patchStartLineNumber } : {}),
        ...(event.hideSummaryContent !== undefined ? { hideSummaryContent: event.hideSummaryContent } : {}),
        ...(eventTsMs !== null && event.phase !== 'end' ? { startedAtMs: eventTsMs } : {}),
        ...(event.paramsText ? { paramsText: event.paramsText } : {}),
      }
      draft.segments.push(next)
    }
  }

  if (event.kind === 'tool_input_state') {
    closeTurnTextSegments(draft, event.turnId)
    if (event.toolName) {
      draft.toolNameByUseId[event.toolUseId] = event.toolName
    }
    const toolName = event.toolName ?? draft.toolNameByUseId[event.toolUseId] ?? 'Tool'
    const toolIndex = findToolSegmentIndex({
      segments: draft.segments,
      turnId: event.turnId,
      toolUseId: event.toolUseId,
    })
    if (toolIndex >= 0) {
      const current = draft.segments[toolIndex]
      if (current.kind === 'tool') {
        const summary = rebindToolSummaryForName({
          summary: current.summary,
          currentToolName: current.toolName,
          nextToolName: toolName,
          status: current.status,
        })
        draft.segments[toolIndex] = {
          ...current,
          toolName,
          summary,
          inputState: {
            kind: event.inputKind,
            status: event.status,
          },
        }
      }
    } else {
      const next: ToolSegment = {
        id: toSegmentId({ kind: 'tool', replaySeq: event.replaySeq, turnId: event.turnId, suffix: event.toolUseId }),
        kind: 'tool',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        toolName,
        status: 'running',
        summary: `${toolName} running`,
        detailLines: [],
        inputState: {
          kind: event.inputKind,
          status: event.status,
        },
      }
      draft.segments.push(next)
    }
  }

  if (event.kind === 'turn_footer') {
    closeTurnTextSegments(draft, event.turnId)
    const existingIndex = draft.segments.findIndex(
      (segment) => segment.kind === 'turn_footer' && segment.turnId === event.turnId,
    )
    if (existingIndex >= 0) {
      const current = draft.segments[existingIndex]
      if (current.kind === 'turn_footer') {
        draft.segments[existingIndex] = {
          ...current,
          status: event.status,
          ...(event.message ? { message: event.message } : {}),
        }
      }
    } else {
      const next: TurnFooterSegment = {
        id: toSegmentId({ kind: 'turn_footer', replaySeq: event.replaySeq, turnId: event.turnId }),
        kind: 'turn_footer',
        turnId: event.turnId,
        status: event.status,
        ...(event.message ? { message: event.message } : {}),
      }
      draft.segments.push(next)
    }
  }

  return {
    ...state,
    segments: draft.segments,
    toolNameByUseId: draft.toolNameByUseId,
    openAssistantSegmentIdByTurn: draft.openAssistantSegmentIdByTurn,
    openThinkingSegmentIdByTurn: draft.openThinkingSegmentIdByTurn,
    seenEventIds,
    lastReplaySeq: event.replaySeq,
  }
}

export function projectCanonicalEvents(
  state: TranscriptProjectionState,
  events: CanonicalEvent[],
): TranscriptProjectionState {
  return events.reduce((current, event) => reduceTranscriptProjection(current, event), state)
}
