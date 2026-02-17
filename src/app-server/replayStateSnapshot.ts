import type { TranscriptProjectionState } from '../features/semantics/projection/transcriptProjection.js'
import { type SemanticsInvariantIssue, selectTerminalTurnInvariantIssues } from '../features/semantics/selectors/invariants.js'
import { selectProjectionSnapshot, type ProjectionSnapshot } from '../features/semantics/selectors/transcriptSegments.js'
import type { ThreadRuntimeState } from './threadStateReducer.js'

export type ReplayStateSnapshot = {
  mode: ThreadRuntimeState['mode']
  activeTurnId: string | null
  lastTurnId: string | null
  lastTurnStatus: ThreadRuntimeState['lastTurnStatus']
  pendingInputCount: number
  canonicalProtocolAnomalyCount: number
  pendingInputs: Array<{
    inputId: string
    threadId: string
    turnId: string
    toolUseId: string
    kind: 'approval' | 'ask_user_question'
    status: 'pending'
    createdAt: string
    expiresAt: string
    payload: unknown
  }>
  invariantIssues: SemanticsInvariantIssue[]
  projection: ProjectionSnapshot | null
  toolNameByUseId: Record<string, string>
  updatedAt: string
}

export function buildReplayStateSnapshot(args: {
  stateForSnapshot: ThreadRuntimeState | null
  projection: TranscriptProjectionState | null
  includeProjectionSnapshot: boolean
  canonicalProtocolAnomalyCount: number
}): ReplayStateSnapshot | null {
  if (!args.stateForSnapshot) return null

  const projectionSnapshot = args.includeProjectionSnapshot
    ? selectProjectionSnapshot(args.projection)
    : null
  const invariantIssues = selectTerminalTurnInvariantIssues({
    projection: args.projection,
    runtimeState: args.stateForSnapshot,
  })

  return {
    mode: args.stateForSnapshot.mode,
    activeTurnId: args.stateForSnapshot.activeTurnId,
    lastTurnId: args.stateForSnapshot.lastTurnId,
    lastTurnStatus: args.stateForSnapshot.lastTurnStatus,
    pendingInputCount: Object.keys(args.stateForSnapshot.pendingInputs).length,
    canonicalProtocolAnomalyCount: Math.max(0, args.canonicalProtocolAnomalyCount),
    pendingInputs: Object.values(args.stateForSnapshot.pendingInputs).map((input) => ({
      inputId: input.inputId,
      threadId: input.threadId,
      turnId: input.turnId,
      toolUseId: input.toolUseId,
      kind: input.kind,
      status: input.status,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      payload: input.payload,
    })),
    invariantIssues,
    projection: projectionSnapshot,
    toolNameByUseId: { ...args.stateForSnapshot.toolNameByUseId },
    updatedAt: args.stateForSnapshot.updatedAt,
  }
}
