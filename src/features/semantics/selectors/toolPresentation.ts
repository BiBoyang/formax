import type { ToolSegment } from '../projection/transcriptProjection'

export type ToolPresentation = {
  summary: string
  firstLine: string
  remainingSummaryLines: string[]
  detailLines: string[]
  hideSummaryContent: boolean
  normalizedErrorFirstLine: string
  taskSummaryLine: string
}

function stripErrorPrefix(line: string): string {
  return line.startsWith('Error: ') ? line.slice('Error: '.length) : line
}

export function selectToolPresentation(
  segment: Pick<ToolSegment, 'summary' | 'detailLines' | 'toolName' | 'status' | 'hideSummaryContent'>,
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
  const hideSummaryContent = Boolean(
    segment.hideSummaryContent ?? (segment.toolName === 'Skill' && segment.status === 'completed'),
  )
  return {
    summary,
    firstLine,
    remainingSummaryLines,
    detailLines: segment.detailLines,
    hideSummaryContent,
    normalizedErrorFirstLine,
    taskSummaryLine,
  }
}
