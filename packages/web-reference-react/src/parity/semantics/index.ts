export type { CanonicalEvent, ReplMode } from '@formax/semantics'
export { resolveCommandRouting, isReplMode } from '@formax/semantics'

export {
  createInitialThreadRuntimeState,
  extractThreadIdFromNotificationParams,
  reduceThreadRuntimeState,
} from '@formax/semantics'
export type { ThreadRuntimePreferences, ThreadRuntimeState } from '@formax/semantics'

export {
  formatArchiveNotice,
  resolveArchiveSelection,
} from '@formax/semantics'
export type { ArchiveThreadLike } from '@formax/semantics'
export { transitionResolvedFromPending } from '@formax/semantics'

export {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '@formax/semantics'
export type {
  TranscriptProjectionState,
  TranscriptSegment,
} from '@formax/semantics'

export {
  mapHistoryMessagesToCanonicalEvents,
  mapTurnNotificationToCanonicalEvents,
} from '@formax/semantics'
export { CROSS_PATH_CONTRACT_FIXTURE } from '@formax/semantics'

export { summarizeInvariantIssues, selectTurnSegments } from '@formax/semantics'
export type { SemanticsInvariantIssue } from '@formax/semantics'
