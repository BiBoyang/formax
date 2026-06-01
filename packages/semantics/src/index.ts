// Bridge package: re-export only the surface currently consumed by workspace apps.
// This keeps web parity imports stable while avoiding accidental heavy transitive exports.
export type { CanonicalEvent } from '../../core/src/features/semantics/core/canonicalEvents'
export { resolveCommandRouting } from '../../core/src/features/semantics/core/commandRouting'
export {
  isReplMode,
  normalizeReplMode,
  resolveReplModeTransition,
  shouldInjectExitPlanReminder,
} from '../../core/src/features/semantics/core/replModeTransition'
export type { ReplMode } from '../../core/src/features/semantics/core/replModeTransition'

export {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
} from '../../core/src/features/semantics/runtime/threadRuntimeState'
export type {
  ThreadRuntimeModelTier,
  ThreadRuntimePendingInput,
  ThreadRuntimePendingInputKind,
  ThreadRuntimePreferences,
  ThreadRuntimePreferencesPatch,
  ThreadRuntimeState,
} from '../../core/src/features/semantics/runtime/threadRuntimeState'

export {
  formatArchiveNotice,
  resolveArchiveSelection,
} from '../../core/src/features/semantics/runtime/threadArchiveSemantics'
export type { ArchiveThreadLike } from '../../core/src/features/semantics/runtime/threadArchiveSemantics'
export {
  transitionInputSubmit,
  transitionResolvePending,
  transitionResolvedFromPending,
} from '../../core/src/features/semantics/runtime/inputStateMachine'
export type { InputState, InputStateResolved } from '../../core/src/features/semantics/runtime/inputStateMachine'

export {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../../core/src/features/semantics/projection/transcriptProjection'
export type {
  TranscriptProjectionState,
  TranscriptSegment,
} from '../../core/src/features/semantics/projection/transcriptProjection'

export {
  mapHistoryMessagesToCanonicalEvents,
  mapTurnNotificationToCanonicalEvents,
} from '../../core/src/features/semantics/adapters/canonicalEventAdapter'
export { buildTurnInput } from '../../core/src/features/semantics/adapters/turnInputBuilder'
export { CROSS_PATH_CONTRACT_FIXTURE } from '../../core/src/features/semantics/adapters/crossPathContractFixture'

export { selectTerminalTurnInvariantIssues, summarizeInvariantIssues } from '../../core/src/features/semantics/selectors/invariants'
export type { SemanticsInvariantIssue } from '../../core/src/features/semantics/selectors/invariants'
export { selectProjectionSnapshot, selectTurnSegments } from '../../core/src/features/semantics/selectors/transcriptSegments'
export type { ProjectionSnapshot } from '../../core/src/features/semantics/selectors/transcriptSegments'
