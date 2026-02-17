import type { CanonicalToolEvent, CanonicalToolInputStateEvent } from '../core/canonicalEvents'
import type { TranscriptSegmentIdFactory } from './transcriptProjectionIds'
import type { ToolSegment, TranscriptSegment } from './transcriptProjectionTypes'

export function dedupeAppend(lines: string[], line: string | undefined): string[] {
  const text = String(line ?? '').trim()
  if (!text) return lines
  if (lines[lines.length - 1] === text) return lines
  return [...lines, text]
}

export function findToolSegmentIndex(args: { segments: TranscriptSegment[]; turnId: string; toolUseId: string }): number {
  for (let index = args.segments.length - 1; index >= 0; index -= 1) {
    const segment = args.segments[index]
    if (segment.kind !== 'tool') continue
    if (segment.turnId !== args.turnId) continue
    if (segment.toolUseId !== args.toolUseId) continue
    return index
  }
  return -1
}

export function rebindToolSummaryForName(args: {
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

export function parseTimestampMs(ts: string): number | null {
  const ms = Date.parse(ts)
  return Number.isFinite(ms) ? ms : null
}

export function reduceToolEvent(args: {
  draft: {
    segments: TranscriptSegment[]
    toolNameByUseId: Record<string, string>
  }
  event: CanonicalToolEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
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
      const status = event.phase === 'end' ? (event.isError ? 'error' : 'completed') : current.status
      const reboundSummary = rebindToolSummaryForName({
        summary: current.summary,
        currentToolName: current.toolName,
        nextToolName: toolName,
        status: current.status,
      })
      const endFallbackSummary = reboundSummary === `${toolName} running` ? `${toolName} completed` : reboundSummary
      const summary =
        event.phase === 'end' ? String(event.summary ?? event.line ?? endFallbackSummary) : reboundSummary
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
    return
  }

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
    id: args.toSegmentId({ kind: 'tool', replaySeq: event.replaySeq, turnId: event.turnId, suffix: event.toolUseId }),
    kind: 'tool',
    turnId: event.turnId,
    toolUseId: event.toolUseId,
    toolName,
    status: initialStatus,
    summary: event.phase === 'end' ? String(event.summary ?? event.line ?? `${toolName} completed`) : `${toolName} running`,
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

export function reduceToolInputStateEvent(args: {
  draft: {
    segments: TranscriptSegment[]
    toolNameByUseId: Record<string, string>
  }
  event: CanonicalToolInputStateEvent
  toSegmentId: TranscriptSegmentIdFactory
}): void {
  const { draft, event } = args
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
    return
  }

  const next: ToolSegment = {
    id: args.toSegmentId({ kind: 'tool', replaySeq: event.replaySeq, turnId: event.turnId, suffix: event.toolUseId }),
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
