import type { Msg } from '../../../../shared/toolMessageTypes'
import type { TranscriptProjectionState } from '../../../semantics/projection/projection'
import { selectTerminalTurnInvariantIssues } from '../../../semantics/selectors/invariants'

export type ReplCanonicalInvariantIssue =
  | ReturnType<typeof selectTerminalTurnInvariantIssues>[number]
  | {
      kind: 'duplicate_tool_row_in_turn'
      turnAnchorMessageId: string
      toolUseId: string
    }
  | {
      kind: 'open_assistant_after_terminal_turn'
      turnId: string
      openAssistantSegmentId: string
    }

export function collectReplCanonicalInvariantIssues(args: {
  projection: TranscriptProjectionState
  messages: Msg[]
  targetTurnId?: string | null
  targetTurnAnchorMessageId?: string | null
}): ReplCanonicalInvariantIssue[] {
  const issues: ReplCanonicalInvariantIssue[] = selectTerminalTurnInvariantIssues({ projection: args.projection }).filter(
    (issue) => !args.targetTurnId || issue.turnId === args.targetTurnId,
  )

  const terminalTurnIds = new Set(
    args.projection.segments
      .filter((segment) => segment.kind === 'turn_footer')
      .map((segment) => segment.turnId)
      .filter((turnId) => !args.targetTurnId || turnId === args.targetTurnId),
  )
  for (const turnId of terminalTurnIds) {
    const openAssistantSegmentId = args.projection.openAssistantSegmentIdByTurn[turnId]
    if (!openAssistantSegmentId) continue
    issues.push({
      kind: 'open_assistant_after_terminal_turn',
      turnId,
      openAssistantSegmentId,
    })
  }

  const startIndex = (() => {
    const targetAnchorId = args.targetTurnAnchorMessageId
    if (targetAnchorId) {
      const idx = args.messages.findIndex((message) => message.id === targetAnchorId)
      if (idx >= 0) return idx
    }
    for (let idx = args.messages.length - 1; idx >= 0; idx -= 1) {
      if (args.messages[idx]?.role === 'user') return idx
    }
    return -1
  })()

  const turnAnchorMessageId = startIndex >= 0 ? args.messages[startIndex]?.id || '__prelude__' : '__prelude__'
  const seenToolUseIds = new Set<string>()
  for (let idx = startIndex + 1; idx < args.messages.length; idx += 1) {
    const message = args.messages[idx]
    if (!message) continue
    if (message.role === 'user') break
    if (message.role !== 'tool') continue
    const toolUseId = String(message.toolInfo?.toolUseId || '').trim()
    if (!toolUseId) continue
    if (seenToolUseIds.has(toolUseId)) {
      issues.push({
        kind: 'duplicate_tool_row_in_turn',
        turnAnchorMessageId,
        toolUseId,
      })
      continue
    }
    seenToolUseIds.add(toolUseId)
  }

  return issues
}

export function summarizeReplCanonicalInvariantIssues(issues: ReplCanonicalInvariantIssue[]): string {
  if (issues.length === 0) return 'none'
  const counts = new Map<string, number>()
  for (const issue of issues) {
    counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ')
}

export function assertReplCanonicalInvariants(args: {
  projection: TranscriptProjectionState
  messages: Msg[]
  targetTurnId?: string | null
  targetTurnAnchorMessageId?: string | null
}): void {
  if (process.env.NODE_ENV === 'production') return
  const issues = collectReplCanonicalInvariantIssues(args)
  if (issues.length === 0) return
  throw new Error(`Invariant violation: ${summarizeReplCanonicalInvariantIssues(issues)}`)
}
