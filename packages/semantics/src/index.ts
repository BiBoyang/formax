// Bridge package: re-export only the surface currently consumed by workspace apps.
// This keeps web parity imports stable while avoiding accidental heavy transitive exports.
export type { CanonicalEvent } from '../../../src/features/semantics/core/canonicalEvents'
export { resolveCommandRouting } from '../../../src/features/semantics/core/commandRouting'
export {
  isReplMode,
  normalizeReplMode,
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../../../src/features/semantics/core/replModeTransition'
export type { ReplMode } from '../../../src/features/semantics/core/replModeTransition'

export {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
} from '../../../src/features/semantics/runtime/threadRuntimeState'
export type {
  ThreadRuntimePendingInput,
  ThreadRuntimePendingInputKind,
  ThreadRuntimeState,
} from '../../../src/features/semantics/runtime/threadRuntimeState'

export {
  formatArchiveNotice,
  resolveArchiveSelection,
} from '../../../src/features/semantics/runtime/threadArchiveSemantics'
export type { ArchiveThreadLike } from '../../../src/features/semantics/runtime/threadArchiveSemantics'
export {
  transitionInputSubmit,
  transitionResolvePending,
  transitionResolvedFromPending,
} from '../../../src/features/semantics/runtime/inputStateMachine'
export type { InputState, InputStateResolved } from '../../../src/features/semantics/runtime/inputStateMachine'

export {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../../../src/features/semantics/projection/transcriptProjection'
export type {
  TranscriptProjectionState,
  TranscriptSegment,
} from '../../../src/features/semantics/projection/transcriptProjection'

export {
  mapHistoryMessagesToCanonicalEvents,
  mapTurnNotificationToCanonicalEvents,
} from '../../../src/features/semantics/adapters/canonicalEventAdapter'
export { buildTurnInput } from '../../../src/features/semantics/adapters/turnInputBuilder'
export { CROSS_PATH_CONTRACT_FIXTURE } from '../../../src/features/semantics/adapters/crossPathContractFixture'

export { selectTerminalTurnInvariantIssues, summarizeInvariantIssues } from '../../../src/features/semantics/selectors/invariants'
export type { SemanticsInvariantIssue } from '../../../src/features/semantics/selectors/invariants'
export { selectProjectionSnapshot, selectTurnSegments } from '../../../src/features/semantics/selectors/transcriptSegments'
export type { ProjectionSnapshot } from '../../../src/features/semantics/selectors/transcriptSegments'
