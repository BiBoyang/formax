import { parseBackgroundTaskId } from './taskResultParsing'

export type ToolPresentationStatus = 'running' | 'completed' | 'error'

export type ToolPresentationSegment = {
  summary: string
  detailLines: string[]
  toolName: string
  status: ToolPresentationStatus
  result?: string
}

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

export function selectToolPresentation(segment: ToolPresentationSegment): ToolPresentation {
  const summary = String(segment.summary ?? '')
  const lines = summary.split(/\r?\n/)
  const firstLine = lines[0] as string
  const remainingSummaryLines = lines.slice(1).filter((line) => line.length > 0)
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
          const taskId = parseBackgroundTaskId(String(segment.result ?? ''))
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
