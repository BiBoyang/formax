import type { ToolSegment } from '../../semantics/projection/transcriptProjection'
import { selectToolPresentation } from '../../semantics/selectors/toolPresentation'
import { formatToolCallParts } from '../../../utils/toolFormatting'

export type ToolViewCompletion = { kind: 'started'; taskId: string } | { kind: 'done' } | null

export type ToolViewModel = {
  toolName: string
  status: 'running' | 'completed' | 'error'
  summary: string
  detailLines: string[]
  paramsText?: string
  inputState?: {
    kind: 'approval' | 'ask_user_question'
    status: 'pending' | 'submitted' | 'canceled' | 'expired' | 'failed'
  }
  taskSummaryLine: string
  taskCompletion: ToolViewCompletion
  hideSummaryContent: boolean
}

export function selectToolViewModelFromSegment(
  segment: Pick<ToolSegment, 'toolName' | 'status' | 'summary' | 'detailLines' | 'result' | 'paramsText' | 'inputState'>,
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

export function selectToolHeaderFromInput(args: {
  toolName: string
  input: Record<string, unknown>
  preferRelativePaths?: boolean
}): { label: string; paramsText?: string } {
  const parts = formatToolCallParts(args.toolName, args.input, {
    preferRelativePaths: args.preferRelativePaths ?? true,
  })
  return {
    label: parts.toolName,
    ...(parts.params ? { paramsText: parts.params } : {}),
  }
}
