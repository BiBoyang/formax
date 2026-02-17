import type { ToolSegment } from '../projection/transcriptProjection'
import { stripTrailingSystemReminderBlock } from '../../../utils/toolFormatting'

export type ToolPresentation = {
  summary: string
  firstLine: string
  remainingSummaryLines: string[]
  detailLines: string[]
  hideSummaryContent: boolean
  normalizedErrorFirstLine: string
  taskSummaryLine: string
  taskCompletion: { kind: 'started'; taskId: string } | { kind: 'done' } | null
}

function stripErrorPrefix(line: string): string {
  return line.startsWith('Error: ') ? line.slice('Error: '.length) : line
}

function parseBackgroundTaskId(result: string | undefined): string | null {
  const text = stripTrailingSystemReminderBlock(String(result ?? ''))
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const taskId = (parsed as Record<string, unknown>).task_id
    const status = (parsed as Record<string, unknown>).status
    if (typeof taskId === 'string' && taskId.trim() && status === 'running') return taskId.trim()
    return null
  } catch {
    return null
  }
}

export function selectToolPresentation(
  segment: Pick<ToolSegment, 'summary' | 'detailLines' | 'toolName' | 'status' | 'result'>,
): ToolPresentation {
  const summary = String(segment.summary ?? '')
  const lines = summary.split(/\r?\n/)
  const firstLine = String(lines[0] ?? '')
  const remainingSummaryLines = lines.slice(1).map((line) => String(line ?? '')).filter((line) => line.length > 0)
  const normalizedErrorFirstLine = stripErrorPrefix(firstLine)
  const taskSummaryLine =
    segment.toolName !== 'Task'
      ? firstLine
      : segment.status === 'running'
        ? firstLine || 'Task running'
        : segment.status === 'error'
          ? normalizedErrorFirstLine || 'Error'
          : firstLine
  const hideSummaryContent = segment.toolName === 'Skill' && segment.status === 'completed'
  const taskCompletion =
    segment.toolName === 'Task' && segment.status === 'completed'
      ? (() => {
          const taskId = parseBackgroundTaskId(segment.result)
          return taskId ? ({ kind: 'started', taskId } as const) : ({ kind: 'done' } as const)
        })()
      : null
  return {
    summary,
    firstLine,
    remainingSummaryLines,
    detailLines: segment.detailLines,
    hideSummaryContent,
    normalizedErrorFirstLine,
    taskSummaryLine,
    taskCompletion,
  }
}
