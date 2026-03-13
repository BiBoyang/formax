import { selectToolPresentation } from './toolPresentation'

export type ToolViewCompletion = { kind: 'started'; taskId: string } | { kind: 'done' } | null

type InputKind = 'approval' | 'ask_user_question'
type InputStatus = 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'

export type ToolViewModel = {
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
  paramsText?: string
  inputState?: {
    kind: InputKind
    status: InputStatus
  }
  taskSummaryLine: string
  taskCompletion: ToolViewCompletion
  hideSummaryContent: boolean
}

export type ToolViewModelSegment = {
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
  result?: string
  paramsText?: string
  inputState?: {
    kind: InputKind
    status: InputStatus
  }
}

export function selectToolViewModelFromSegment(
  segment: ToolViewModelSegment,
): ToolViewModel {
  const presentation = selectToolPresentation(segment)
  const summary =
    segment.toolName === 'Task' && (segment.status === 'running' || segment.status === 'error')
      ? presentation.taskSummaryLine
      : presentation.taskCompletion?.kind === 'started'
        ? `Started (task_id: ${presentation.taskCompletion.taskId})`
        : presentation.hideSummaryContent
          ? ''
          : presentation.summary

  return {
    toolName: segment.toolName,
    status: segment.status,
    summary,
    detailLines: presentation.detailLines,
    ...(segment.paramsText ? { paramsText: segment.paramsText } : {}),
    ...(segment.inputState ? { inputState: segment.inputState } : {}),
    taskSummaryLine: presentation.taskSummaryLine,
    taskCompletion: presentation.taskCompletion,
    hideSummaryContent: presentation.hideSummaryContent,
  }
}
