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

const INVARIANT_KIND_ORDER: SemanticsInvariantIssue['kind'][] = [
  'running_tool_after_terminal_turn',
  'pending_input_after_terminal_turn',
]

export function summarizeInvariantIssues(issues: SemanticsInvariantIssue[]): string {
  if (issues.length === 0) return 'none'
  const counts: Record<SemanticsInvariantIssue['kind'], number> = {
    running_tool_after_terminal_turn: 0,
    pending_input_after_terminal_turn: 0,
  }
  for (const issue of issues) {
    counts[issue.kind] += 1
  }
  return INVARIANT_KIND_ORDER
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${kind}=${counts[kind]}`)
    .join(', ')
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
