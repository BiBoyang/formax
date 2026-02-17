import type { TranscriptProjectionState } from '../projection/transcriptProjection'
import type { ThreadRuntimeState } from '../runtime/threadRuntimeState'

export type SemanticsInvariantIssue =
  | {
      kind: 'running_tool_after_terminal_turn'
      turnId: string
      toolUseId: string
    }
  | {
      kind: 'pending_input_after_terminal_turn'
      turnId: string
      inputId: string
      toolUseId: string
    }

export function selectTerminalTurnInvariantIssues(args: {
  projection: TranscriptProjectionState | null | undefined
  runtimeState?: ThreadRuntimeState | null
}): SemanticsInvariantIssue[] {
  const projection = args.projection
  if (!projection) return []

  const terminalTurnIds = new Set<string>()
  for (const segment of projection.segments) {
    if (segment.kind !== 'turn_footer') continue
    terminalTurnIds.add(segment.turnId)
  }
  if (terminalTurnIds.size === 0) return []

  const issues: SemanticsInvariantIssue[] = []
  for (const segment of projection.segments) {
    if (segment.kind !== 'tool') continue
    if (segment.status !== 'running') continue
    if (!terminalTurnIds.has(segment.turnId)) continue
    issues.push({
      kind: 'running_tool_after_terminal_turn',
      turnId: segment.turnId,
      toolUseId: segment.toolUseId,
    })
  }

  const runtimeState = args.runtimeState
  if (!runtimeState) return issues
  for (const pending of Object.values(runtimeState.pendingInputs)) {
    if (pending.status !== 'pending') continue
    if (!terminalTurnIds.has(pending.turnId)) continue
    issues.push({
      kind: 'pending_input_after_terminal_turn',
      turnId: pending.turnId,
      inputId: pending.inputId,
      toolUseId: pending.toolUseId,
    })
  }

  return issues
}
