import type { DurableSnipSummary, ResolvedInput, ThreadMessage, ThreadSummary } from '../../types'
import {
  asResolvedInputs,
  asThreadMessages,
  asThreadReplay,
  asThreadSummaries,
  type ReplayStateSnapshot,
} from './rpcParsers'
import { parseCompactBoundarySummary } from './compactBoundarySummary'

export type RpcStartedThread = {
  id: string
  cwd?: string
}

export type RpcTurnStartLikeResult = {
  turnId: string | null
  localStdout: string
  localDiagnostics: RpcContextDiagnosticsPayload | null
}

export type RpcContextContributor = {
  kind?: 'system_section' | 'message' | 'tool_result' | 'fixed_group' | 'collapse_recap'
  key?: string
  label: string
  tokens: number
  role?: 'user' | 'assistant'
  ordinal?: number
  toolUseId?: string
  toolName?: string
  systemSectionKey?: string
}

export type RpcCountByToolName = {
  toolName: string
  count: number
}

export type RpcMicroCompactImpact = {
  compactedBlocks: number
  compactedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
  cacheAwareEligibleToolNames?: string[]
  cacheAwareMinResultChars?: number
  cacheAwareCompactedBlocks?: number
  cacheAwareToolNames?: string[]
  timeAwareEligibleToolNames?: string[]
  timeAwareMinResultChars?: number
  timeAwareMinStaleUserTurns?: number
  timeAwareCompactedBlocks?: number
  timeAwareToolNames?: string[]
}

export type RpcToolResultBudgetImpact = {
  replacedBlocks: number
  replacedToolNames: string[]
  estimatedTokensSaved: number
  keptRecentBlocks: number
  budgetTokens: number | null
  totalToolResultTokensBefore: number
  totalToolResultTokensAfter: number
}

export type RpcSnipImpact = {
  snippedMessages: number
  snippedBlocks: number
  estimatedTokensSaved: number
  keptRecentMessages: number
  minTextChars: number
}

export type RpcContextCollapseImpact = {
  collapsed: boolean
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  projectedHistoryTokensAfterCollapse: number
  projectedHistoryDeltaTokens: number
  metadata?: RpcContextCollapseMeta | null
}

export type RpcContextCollapseMeta = {
  schemaVersion: 1
  kind: 'request_recap'
  keepLastTurns: number
  preservedTailMessageCount: number
  retainedCompactSummary: boolean
  recentUserPromptCount: number
  recentFileCount: number
  earlierToolResultBlockCount: number
  recapFingerprint: string
}

export type RpcContextLifecycleMarker = {
  stage: 'snapshot' | 'post_microcompact' | 'post_prune' | 'post_compact'
  label: string
  totalTokens: number
  historyTokens: number
  fixedTokens: number
  deltaFromSnapshot: number
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
}

export type RpcContextStrategyCoordinationFact = {
  stage: 'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'
  role: 'budget_reducer' | 'semantic_projection' | 'terminal_fallback'
  scope: 'persisted_history_candidate' | 'request_history_projection' | 'assembled_request_envelope'
  disposition: 'applied' | 'skipped'
  terminal: boolean
  advisory: boolean
  reason: string
  estimatedTokensSaved: number
  inputTokens: number
  outputTokens: number
}

export type RpcContextStrategyControlPlane = {
  stageOrder: Array<'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'>
  appliedStages: Array<'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'>
  skippedStages: Array<'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'>
  terminalStage: 'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune' | null
  terminalDisposition: 'applied' | 'skipped' | null
  dominantSavingStage: 'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune' | null
  dominantSavingTokens: number
}

export type RpcAssembledLedgerRow = {
  kind:
    | 'system_total'
    | 'request_history'
    | 'tool_result_group'
    | 'tool_result_budget_savings'
    | 'fixed_group'
    | 'fixed_total'
    | 'assembled_total'
  key: string
  label: string
  tokens: number
  messageCount?: number
  blockCount?: number
}

export type RpcCompactBoundaryKeepStrategy =
  | {
      kind: 'keep_last_turns'
      keepLastTurns: number
    }
  | {
      kind: 'keep_combo'
      keepLastTurns: number
      keepMinTokens: number
      keepMinUserTurns: number
    }

export type RpcCompactRehydrationPlan = {
  schemaVersion: 1
  items: Array<{
    kind: 'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'
    priority: 'high' | 'medium'
    status: 'planned' | 'applied'
  }>
}

export type RpcCompactRehydrationCost = {
  sectionCount: number
  estimatedTokens: number
}

export type RpcCompactPreservedSegment = {
  schemaVersion: 1
  continuationMessageCount: number
  preservedTailMessageCount: number
  summaryFingerprint: string
  headFingerprint: string | null
  tailFingerprint: string | null
}

export type RpcCompactTriggerReason = {
  kind: 'auto_threshold' | 'manual' | 'reactive_error'
  detail?: string
}

export type RpcLatestCompactBoundary = {
  schemaVersion: 1
  trigger?: 'manual' | 'auto' | 'reactive'
  triggerReason?: RpcCompactTriggerReason
  preTokens?: number
  summaryKind?: 'model_summary' | 'session_memory'
  keepStrategy?: RpcCompactBoundaryKeepStrategy
  rehydrationPlan?: RpcCompactRehydrationPlan
  rehydrationCost?: RpcCompactRehydrationCost
  preservedSegment?: RpcCompactPreservedSegment
}

export type RpcContextDiagnosticsSnapshot = {
  totalTokens: number
  systemTokens: number
  systemSectionBreakdown?: RpcContextContributor[]
  historyTokens: number
  toolResultTokens: number
  otherHistoryTokens: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  toolResultBlockCount: number
  microCompactedToolResultCount: number
  toolResultCountsByToolName: RpcCountByToolName[]
  microCompactedCountsByToolName: RpcCountByToolName[]
  contextWindowTokens: number | null
  effectiveLimitTokens: number | null
  autoCompactLimitTokens: number | null
  baselineTokens: number | null
  percentRemaining: number | null
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
  topSnapshotContributors: RpcContextContributor[]
}

export type RpcNextTurnFixedContextDiagnostics = {
  fixedGroups: Array<{ label: string; blockCount: number; tokens: number }>
  assembledLedger?: RpcAssembledLedgerRow[]
  strategyCoordination?: RpcContextStrategyCoordinationFact[]
  strategyControlPlane?: RpcContextStrategyControlPlane
  workingSetSignals?: RpcWorkingSetSignals
  toolResultBudgetImpact?: RpcToolResultBudgetImpact
  microCompactImpact: RpcMicroCompactImpact
  snipImpact?: RpcSnipImpact
  collapseImpact?: RpcContextCollapseImpact
  lifecycleMarkers?: RpcContextLifecycleMarker[]
  projectedHistoryTokens: number
  projectedHistoryDeltaTokens: number
  fixedTokens: number
  totalTokens: number
  remainingToEffectiveLimit: number | null
  remainingToAutoCompactLimit: number | null
  shouldAutoCompact: boolean | null
  autoCompactSkipReason?: string | null
  pruneSkipReason?: string | null
  topAssembledContributors: RpcContextContributor[]
}

export type RpcWorkingSetSignals = {
  recentFileCount: number
  hasPlanState: boolean
  hasTodoState: boolean
  modeState: 'normal' | 'acceptEdits' | 'plan'
  keepMinTokensBoost: number
  keepMinUserTurnsBoost: number
  taskStateKinds?: Array<'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'>
  selectionReasons?: string[]
  anchorKind: 'none' | 'read' | 'filesystem_cluster' | 'task_execution_cluster'
  anchorToolNames: string[]
  anchorBacktrackTurns: number
  anchorMaxBacktrackTurns: number
}

export type RpcContextDiagnosticsPayload = {
  kind: 'formax.context_diagnostics'
  schemaVersion: 1
  mode: string
  model: string
  latestCompactBoundary: RpcLatestCompactBoundary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
  latestReactiveCompact?: RpcLatestReactiveCompact | null
  snapshot: RpcContextDiagnosticsSnapshot
  nextTurnFixed: RpcNextTurnFixedContextDiagnostics
  notes: string[]
}

export type RpcLatestRequestCollapse = {
  phase: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount: number
  estimatedTokensSaved: number
  recapFingerprint?: string
}

export type RpcLatestReactiveCompact = {
  triggerKind:
    | 'http_413'
    | 'request_too_large'
    | 'input_too_long'
    | 'prompt_too_long'
    | 'maximum_context_length'
    | 'context_length_exceeded'
    | 'context_limit'
    | 'too_many_tokens'
    | 'reduce_messages_length'
  triggerDetail?: string
  strategy: 'session_memory' | 'model_summary'
}

export type RpcSessionMemoryRestoreSummary = {
  schemaVersion: 1
  mode: 'normal' | 'acceptEdits' | 'plan'
  recentFiles: string[]
  recentUserPrompts: string[]
  recentSkills: string[]
  recentSubagentTypes: string[]
  recentDeferredToolNames: string[]
  recentTaskHints: string[]
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
}

export type RpcInputSubmitResult = {
  status: string
}

export type RpcThreadReplayResult = {
  data: Array<{ replaySeq: number; method: string; params?: unknown }>
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: ReplayStateSnapshot | null
  latestCompactBoundary?: RpcLatestCompactBoundary | null
  durableSnip?: DurableSnipSummary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
  pendingSessionMemoryRestore?: RpcSessionMemoryRestoreSummary | null
}

export type RpcThreadMessagesResult = {
  data: ThreadMessage[]
  nextCursor: string | null
  latestCompactBoundary?: RpcLatestCompactBoundary | null
  durableSnip?: DurableSnipSummary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
}

export type RpcThreadReadResult = {
  thread: {
    id: string
    cwd: string
    createdAt: string
    updatedAt: string
  }
  transcriptPreview: Array<{ role: 'user' | 'assistant'; text: string }>
  latestCompactBoundary?: RpcLatestCompactBoundary | null
  durableSnip?: DurableSnipSummary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
}

export type RpcThreadResumeResult = {
  thread: {
    id: string
    cwd: string
    createdAt: string
    updatedAt: string
  }
  staleInputs: ResolvedInput[]
  latestCompactBoundary?: RpcLatestCompactBoundary | null
  durableSnip?: DurableSnipSummary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
  pendingSessionMemoryRestore?: RpcSessionMemoryRestoreSummary | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return value as Record<string, unknown>
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const deduped = new Set<string>()
  for (const row of value) {
    if (typeof row !== 'string') continue
    const trimmed = row.trim()
    if (!trimmed) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b))
}

export function parseThreadStartResponse(value: unknown): RpcStartedThread | null {
  const thread = asRecord(asRecord(value).thread)
  const id = typeof thread.id === 'string' && thread.id.trim() ? thread.id : ''
  if (!id) return null
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim() ? thread.cwd : undefined
  return cwd ? { id, cwd } : { id }
}

export function parseTurnStartLikeResponse(value: unknown): RpcTurnStartLikeResult {
  const root = asRecord(value)
  const turn = asRecord(root.turn)
  const local = asRecord(root.local)
  const turnId = typeof turn.id === 'string' && turn.id.trim() ? turn.id : null
  const localStdout = typeof local.stdout === 'string' ? local.stdout : ''
  const localDiagnostics = parseContextDiagnosticsPayload(local.diagnostics)
  return {
    turnId,
    localStdout,
    localDiagnostics,
  }
}

export function parseInputSubmitResponse(value: unknown): RpcInputSubmitResult {
  const record = asRecord(value)
  const status = typeof record.status === 'string' && record.status.trim() ? record.status : 'unknown'
  return { status }
}

export function parseThreadReplayResponse(value: unknown): RpcThreadReplayResult {
  const replay = asThreadReplay(value)
  const root = asRecord(value)
  const latestCompactBoundary = parseOptionalNullableLatestCompactBoundaryField(root, 'latestCompactBoundary')
  const durableSnip = parseOptionalNullableDurableSnipField(root, 'durableSnip')
  const latestRequestCollapse = parseOptionalNullableLatestRequestCollapseField(root, 'latestRequestCollapse')
  if (!latestCompactBoundary || !durableSnip || !latestRequestCollapse) return replay
  return {
    ...replay,
    ...(latestCompactBoundary.present ? { latestCompactBoundary: latestCompactBoundary.value } : {}),
    ...(durableSnip.present ? { durableSnip: durableSnip.value } : {}),
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
  }
}

export function parseThreadListResponse(value: unknown): ThreadSummary[] {
  return asThreadSummaries(value)
}

export function parseHiddenThreadGroupCwdsFromThreadList(value: unknown): string[] {
  const root = asRecord(value)
  return parseStringList(root.hiddenGroupCwds)
}

export function parseThreadGroupHideResponse(value: unknown): string[] {
  const root = asRecord(value)
  return parseStringList(root.hiddenGroupCwds)
}

export function parseThreadMessagesResponse(value: unknown): RpcThreadMessagesResult {
  return asThreadMessages(value)
}

export function parseThreadReadResponse(value: unknown): RpcThreadReadResult | null {
  const root = asRecord(value)
  const thread = asRecord(root.thread)
  const id = typeof thread.id === 'string' && thread.id.trim() ? thread.id : null
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim() ? thread.cwd : null
  const createdAt = typeof thread.createdAt === 'string' && thread.createdAt.trim() ? thread.createdAt : null
  const updatedAt = typeof thread.updatedAt === 'string' && thread.updatedAt.trim() ? thread.updatedAt : null
  if (!id || !cwd || !createdAt || !updatedAt) return null
  const transcriptPreview = Array.isArray(root.transcriptPreview)
    ? root.transcriptPreview
        .map((entry) => {
          const row = asOptionalRecord(entry)
          if (!row) return null
          const role = row.role === 'user' || row.role === 'assistant' ? row.role : null
          const text = typeof row.text === 'string' ? row.text : null
          if (!role || text == null) return null
          return { role, text }
        })
        .filter((entry): entry is { role: 'user' | 'assistant'; text: string } => Boolean(entry))
    : []
  const latestCompactBoundary = parseOptionalNullableLatestCompactBoundaryField(root, 'latestCompactBoundary')
  const durableSnip = parseOptionalNullableDurableSnipField(root, 'durableSnip')
  const latestRequestCollapse = parseOptionalNullableLatestRequestCollapseField(root, 'latestRequestCollapse')
  if (!latestCompactBoundary || !durableSnip || !latestRequestCollapse) return null
  return {
    thread: { id, cwd, createdAt, updatedAt },
    transcriptPreview,
    ...(latestCompactBoundary.present ? { latestCompactBoundary: latestCompactBoundary.value } : {}),
    ...(durableSnip.present ? { durableSnip: durableSnip.value } : {}),
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
  }
}

export function parseThreadResumeResponse(value: unknown): RpcThreadResumeResult | null {
  const root = asRecord(value)
  const thread = asRecord(root.thread)
  const id = typeof thread.id === 'string' && thread.id.trim() ? thread.id : null
  const cwd = typeof thread.cwd === 'string' && thread.cwd.trim() ? thread.cwd : null
  const createdAt = typeof thread.createdAt === 'string' && thread.createdAt.trim() ? thread.createdAt : null
  const updatedAt = typeof thread.updatedAt === 'string' && thread.updatedAt.trim() ? thread.updatedAt : null
  const staleInputs = asResolvedInputs(root)
  const latestCompactBoundary = parseOptionalNullableLatestCompactBoundaryField(root, 'latestCompactBoundary')
  const durableSnip = parseOptionalNullableDurableSnipField(root, 'durableSnip')
  const latestRequestCollapse = parseOptionalNullableLatestRequestCollapseField(root, 'latestRequestCollapse')
  const pendingSessionMemoryRestore = parseOptionalNullableSessionMemoryRestoreField(root, 'pendingSessionMemoryRestore')
  if (
    !id ||
    !cwd ||
    !createdAt ||
    !updatedAt ||
    !latestCompactBoundary ||
    !durableSnip ||
    !latestRequestCollapse ||
    !pendingSessionMemoryRestore
  ) {
    return null
  }
  return {
    thread: { id, cwd, createdAt, updatedAt },
    staleInputs,
    ...(latestCompactBoundary.present ? { latestCompactBoundary: latestCompactBoundary.value } : {}),
    ...(durableSnip.present ? { durableSnip: durableSnip.value } : {}),
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
    ...(pendingSessionMemoryRestore.present
      ? { pendingSessionMemoryRestore: pendingSessionMemoryRestore.value }
      : {}),
  }
}

export function parseResolvedInputsResponse(value: unknown): ResolvedInput[] {
  return asResolvedInputs(value)
}

function parseContextDiagnosticsPayload(value: unknown): RpcContextDiagnosticsPayload | null {
  const record = asRecord(value)
  if (record.kind !== 'formax.context_diagnostics') return null
  if (record.schemaVersion !== 1) return null
  const mode = typeof record.mode === 'string' && record.mode.trim() ? record.mode : null
  const model = typeof record.model === 'string' && record.model.trim() ? record.model : null
  const snapshot = parseContextDiagnosticsSnapshot(record.snapshot)
  const nextTurnFixed = parseNextTurnFixedContextDiagnostics(record.nextTurnFixed)
  const latestCompactBoundary = parseStrictLatestCompactBoundaryField(record)
  const latestRequestCollapse = parseOptionalNullableLatestRequestCollapseField(record, 'latestRequestCollapse')
  const latestReactiveCompact = parseOptionalNullableLatestReactiveCompactField(record, 'latestReactiveCompact')
  const notes = parseRequiredStringList(record.notes)
  if (
    !mode ||
    !model ||
    !snapshot ||
    !nextTurnFixed ||
    !latestCompactBoundary ||
    !latestRequestCollapse ||
    !latestReactiveCompact ||
    !notes
  ) {
    return null
  }
  return {
    kind: 'formax.context_diagnostics',
    schemaVersion: 1,
    mode,
    model,
    latestCompactBoundary: latestCompactBoundary.value,
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
    ...(latestReactiveCompact.present ? { latestReactiveCompact: latestReactiveCompact.value } : {}),
    snapshot,
    nextTurnFixed,
    notes: notes.value,
  }
}

function parseLatestRequestCollapse(value: unknown): RpcLatestRequestCollapse | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const phase = record.phase === 'initial' || record.phase === 'reactive_retry' ? record.phase : null
  const collapsedHeadMessageCount = asFiniteNumber(record.collapsedHeadMessageCount)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const recapFingerprint =
    record.recapFingerprint === undefined
      ? undefined
      : typeof record.recapFingerprint === 'string' && record.recapFingerprint.trim()
        ? record.recapFingerprint
        : null
  if (!phase || collapsedHeadMessageCount == null || estimatedTokensSaved == null || recapFingerprint === null) {
    return null
  }
  return {
    phase,
    collapsedHeadMessageCount,
    estimatedTokensSaved,
    ...(recapFingerprint ? { recapFingerprint } : {}),
  }
}

function parseOptionalNullableLatestRequestCollapseField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: RpcLatestRequestCollapse | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { present: false, value: null }
  const value = record[key]
  if (value === null) return { present: true, value: null }
  const parsed = parseLatestRequestCollapse(value)
  return parsed ? { present: true, value: parsed } : null
}

function parseLatestReactiveCompact(value: unknown): RpcLatestReactiveCompact | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const triggerKind =
    record.triggerKind === 'http_413' ||
    record.triggerKind === 'request_too_large' ||
    record.triggerKind === 'input_too_long' ||
    record.triggerKind === 'prompt_too_long' ||
    record.triggerKind === 'maximum_context_length' ||
    record.triggerKind === 'context_length_exceeded' ||
    record.triggerKind === 'context_limit' ||
    record.triggerKind === 'too_many_tokens' ||
    record.triggerKind === 'reduce_messages_length'
      ? record.triggerKind
      : null
  const strategy = record.strategy === 'session_memory' || record.strategy === 'model_summary' ? record.strategy : null
  const triggerDetail =
    record.triggerDetail === undefined
      ? undefined
      : typeof record.triggerDetail === 'string' && record.triggerDetail.trim()
        ? record.triggerDetail
        : null
  if (!triggerKind || !strategy || triggerDetail === null) return null
  return {
    triggerKind,
    strategy,
    ...(triggerDetail ? { triggerDetail } : {}),
  }
}

function parseOptionalNullableLatestReactiveCompactField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: RpcLatestReactiveCompact | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { present: false, value: null }
  const value = record[key]
  if (value === null) return { present: true, value: null }
  const parsed = parseLatestReactiveCompact(value)
  return parsed ? { present: true, value: parsed } : null
}

function parseSessionMemoryRestoreSummary(value: unknown): RpcSessionMemoryRestoreSummary | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  if (record.schemaVersion !== 1) return null
  const mode = record.mode === 'normal' || record.mode === 'acceptEdits' || record.mode === 'plan' ? record.mode : null
  const recentFiles = parseRequiredStringList(record.recentFiles)
  const recentUserPrompts = parseRequiredStringList(record.recentUserPrompts)
  const recentSkills = record.recentSkills === undefined ? { value: [] } : parseRequiredStringList(record.recentSkills)
  const recentSubagentTypes =
    record.recentSubagentTypes === undefined ? { value: [] } : parseRequiredStringList(record.recentSubagentTypes)
  const recentDeferredToolNames =
    record.recentDeferredToolNames === undefined ? { value: [] } : parseRequiredStringList(record.recentDeferredToolNames)
  const recentTaskHints =
    record.recentTaskHints === undefined ? { value: [] } : parseRequiredStringList(record.recentTaskHints)
  const planPath = parseRequiredNullableString(record.planPath)
  const planExcerpt = parseRequiredNullableString(record.planExcerpt)
  const todoSummary = parseRequiredNullableString(record.todoSummary)
  if (
    !mode ||
    !recentFiles ||
    !recentUserPrompts ||
    !recentSkills ||
    !recentSubagentTypes ||
    !recentDeferredToolNames ||
    !recentTaskHints ||
    !planPath ||
    !planExcerpt ||
    !todoSummary
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    mode,
    recentFiles: recentFiles.value,
    recentUserPrompts: recentUserPrompts.value,
    recentSkills: recentSkills.value,
    recentSubagentTypes: recentSubagentTypes.value,
    recentDeferredToolNames: recentDeferredToolNames.value,
    recentTaskHints: recentTaskHints.value,
    planPath: planPath.value,
    planExcerpt: planExcerpt.value,
    todoSummary: todoSummary.value,
  }
}

function parseOptionalNullableSessionMemoryRestoreField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: RpcSessionMemoryRestoreSummary | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { present: false, value: null }
  const value = record[key]
  if (value === null) return { present: true, value: null }
  const parsed = parseSessionMemoryRestoreSummary(value)
  return parsed ? { present: true, value: parsed } : null
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  return asFiniteNumber(value)
}

function parseContributors(value: unknown): RpcContextContributor[] | null {
  if (!Array.isArray(value)) return null
  const rows: RpcContextContributor[] = []
  for (const row of value) {
    const record = asOptionalRecord(row)
    if (!record) return null
    const kindPresent = Object.prototype.hasOwnProperty.call(record, 'kind')
    const kind =
      record.kind === 'system_section' ||
      record.kind === 'message' ||
      record.kind === 'tool_result' ||
      record.kind === 'fixed_group' ||
      record.kind === 'collapse_recap'
        ? record.kind
        : null
    const keyPresent = Object.prototype.hasOwnProperty.call(record, 'key')
    const key = typeof record.key === 'string' && record.key.trim() ? record.key : null
    const label = typeof record.label === 'string' && record.label.trim() ? record.label : null
    const tokens = asFiniteNumber(record.tokens)
    if ((kindPresent && !kind) || (keyPresent && !key)) return null
    if (!label || tokens == null) return null

    const role =
      record.role === undefined ? undefined : record.role === 'user' || record.role === 'assistant' ? record.role : null
    const ordinal = record.ordinal === undefined ? undefined : asFiniteNumber(record.ordinal)
    const toolUseId = record.toolUseId === undefined ? undefined : typeof record.toolUseId === 'string' && record.toolUseId.trim() ? record.toolUseId : null
    const toolName = record.toolName === undefined ? undefined : typeof record.toolName === 'string' && record.toolName.trim() ? record.toolName : null
    const systemSectionKey =
      record.systemSectionKey === undefined
        ? undefined
        : typeof record.systemSectionKey === 'string' && record.systemSectionKey.trim()
          ? record.systemSectionKey
          : null

    if (role === null || ordinal === null || toolUseId === null || toolName === null || systemSectionKey === null) {
      return null
    }

    rows.push({
      label,
      tokens,
      ...(kind ? { kind } : {}),
      ...(key ? { key } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(ordinal !== undefined ? { ordinal } : {}),
      ...(toolUseId !== undefined ? { toolUseId } : {}),
      ...(toolName !== undefined ? { toolName } : {}),
      ...(systemSectionKey !== undefined ? { systemSectionKey } : {}),
    })
  }
  return rows
}

function parseCountByToolNameList(value: unknown): RpcCountByToolName[] | null {
  if (!Array.isArray(value)) return null
  const rows: RpcCountByToolName[] = []
  for (const row of value) {
    const record = asOptionalRecord(row)
    if (!record) return null
    const toolName = typeof record.toolName === 'string' && record.toolName.trim() ? record.toolName : null
    const count = asFiniteNumber(record.count)
    if (!toolName || count == null) return null
    rows.push({ toolName, count })
  }
  return rows
}

function parseMicroCompactImpact(value: unknown): RpcMicroCompactImpact | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const compactedBlocks = asFiniteNumber(record.compactedBlocks)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const keptRecentBlocks = asFiniteNumber(record.keptRecentBlocks)
  const compactedToolNames = parseRequiredStringList(record.compactedToolNames)
  const cacheAwareEligibleToolNames = parseOptionalStringList(record.cacheAwareEligibleToolNames)
  const cacheAwareMinResultChars = asOptionalFiniteNumber(record.cacheAwareMinResultChars)
  const cacheAwareCompactedBlocks = asOptionalFiniteNumber(record.cacheAwareCompactedBlocks)
  const cacheAwareToolNames = parseOptionalStringList(record.cacheAwareToolNames)
  const timeAwareEligibleToolNames = parseOptionalStringList(record.timeAwareEligibleToolNames)
  const timeAwareMinResultChars = asOptionalFiniteNumber(record.timeAwareMinResultChars)
  const timeAwareMinStaleUserTurns = asOptionalFiniteNumber(record.timeAwareMinStaleUserTurns)
  const timeAwareCompactedBlocks = asOptionalFiniteNumber(record.timeAwareCompactedBlocks)
  const timeAwareToolNames = parseOptionalStringList(record.timeAwareToolNames)
  if (compactedBlocks == null || estimatedTokensSaved == null || keptRecentBlocks == null || !compactedToolNames) {
    return null
  }
  if (
    cacheAwareEligibleToolNames === null ||
    cacheAwareMinResultChars === null ||
    cacheAwareCompactedBlocks === null ||
    cacheAwareToolNames === null ||
    timeAwareEligibleToolNames === null ||
    timeAwareMinResultChars === null ||
    timeAwareMinStaleUserTurns === null ||
    timeAwareCompactedBlocks === null ||
    timeAwareToolNames === null
  ) {
    return null
  }
  return {
    compactedBlocks,
    compactedToolNames: compactedToolNames.value,
    estimatedTokensSaved,
    keptRecentBlocks,
    ...(cacheAwareEligibleToolNames ? { cacheAwareEligibleToolNames: cacheAwareEligibleToolNames.value } : {}),
    ...(cacheAwareMinResultChars !== undefined ? { cacheAwareMinResultChars } : {}),
    ...(cacheAwareCompactedBlocks !== undefined ? { cacheAwareCompactedBlocks } : {}),
    ...(cacheAwareToolNames ? { cacheAwareToolNames: cacheAwareToolNames.value } : {}),
    ...(timeAwareEligibleToolNames ? { timeAwareEligibleToolNames: timeAwareEligibleToolNames.value } : {}),
    ...(timeAwareMinResultChars !== undefined ? { timeAwareMinResultChars } : {}),
    ...(timeAwareMinStaleUserTurns !== undefined ? { timeAwareMinStaleUserTurns } : {}),
    ...(timeAwareCompactedBlocks !== undefined ? { timeAwareCompactedBlocks } : {}),
    ...(timeAwareToolNames ? { timeAwareToolNames: timeAwareToolNames.value } : {}),
  }
}

function parseToolResultBudgetImpact(value: unknown): RpcToolResultBudgetImpact | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const replacedBlocks = asFiniteNumber(record.replacedBlocks)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const keptRecentBlocks = asFiniteNumber(record.keptRecentBlocks)
  const totalToolResultTokensBefore = asFiniteNumber(record.totalToolResultTokensBefore)
  const totalToolResultTokensAfter = asFiniteNumber(record.totalToolResultTokensAfter)
  const budgetTokens = parseRequiredNullableNumber(record.budgetTokens)
  const replacedToolNames = parseRequiredStringList(record.replacedToolNames)
  if (
    replacedBlocks == null ||
    estimatedTokensSaved == null ||
    keptRecentBlocks == null ||
    totalToolResultTokensBefore == null ||
    totalToolResultTokensAfter == null ||
    !budgetTokens ||
    !replacedToolNames
  ) {
    return null
  }
  return {
    replacedBlocks,
    replacedToolNames: replacedToolNames.value,
    estimatedTokensSaved,
    keptRecentBlocks,
    budgetTokens: budgetTokens.value,
    totalToolResultTokensBefore,
    totalToolResultTokensAfter,
  }
}

function parseSnipImpact(value: unknown): RpcSnipImpact | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const snippedMessages = asFiniteNumber(record.snippedMessages)
  const snippedBlocks = asFiniteNumber(record.snippedBlocks)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const keptRecentMessages = asFiniteNumber(record.keptRecentMessages)
  const minTextChars = asFiniteNumber(record.minTextChars)
  if (
    snippedMessages == null ||
    snippedBlocks == null ||
    estimatedTokensSaved == null ||
    keptRecentMessages == null ||
    minTextChars == null
  ) {
    return null
  }
  return {
    snippedMessages,
    snippedBlocks,
    estimatedTokensSaved,
    keptRecentMessages,
    minTextChars,
  }
}

function parseLifecycleMarkers(value: unknown): RpcContextLifecycleMarker[] | null {
  if (!Array.isArray(value)) return null
  const rows: RpcContextLifecycleMarker[] = []
  for (const row of value) {
    const record = asOptionalRecord(row)
    if (!record) return null
    const stage =
      record.stage === 'snapshot' ||
      record.stage === 'post_microcompact' ||
      record.stage === 'post_prune' ||
      record.stage === 'post_compact'
        ? record.stage
        : null
    const label = typeof record.label === 'string' && record.label.trim() ? record.label : null
    const totalTokens = asFiniteNumber(record.totalTokens)
    const historyTokens = asFiniteNumber(record.historyTokens)
    const fixedTokens = asFiniteNumber(record.fixedTokens)
    const deltaFromSnapshot = asFiniteNumber(record.deltaFromSnapshot)
    const remainingToEffectiveLimit = parseRequiredNullableNumber(record.remainingToEffectiveLimit)
    const remainingToAutoCompactLimit = parseRequiredNullableNumber(record.remainingToAutoCompactLimit)
    const shouldAutoCompact = parseRequiredNullableBoolean(record.shouldAutoCompact)
    if (
      !stage ||
      !label ||
      totalTokens == null ||
      historyTokens == null ||
      fixedTokens == null ||
      deltaFromSnapshot == null ||
      !remainingToEffectiveLimit ||
      !remainingToAutoCompactLimit ||
      !shouldAutoCompact
    ) {
      return null
    }
    rows.push({
      stage,
      label,
      totalTokens,
      historyTokens,
      fixedTokens,
      deltaFromSnapshot,
      remainingToEffectiveLimit: remainingToEffectiveLimit.value,
      remainingToAutoCompactLimit: remainingToAutoCompactLimit.value,
      shouldAutoCompact: shouldAutoCompact.value,
    })
  }
  return rows
}

function parseStrategyCoordination(value: unknown): RpcContextStrategyCoordinationFact[] | null {
  if (!Array.isArray(value)) return null
  const rows: RpcContextStrategyCoordinationFact[] = []
  for (const row of value) {
    const record = asOptionalRecord(row)
    if (!record) return null
    const stage =
      record.stage === 'microcompact' ||
      record.stage === 'tool_result_budget' ||
      record.stage === 'snip' ||
      record.stage === 'collapse' ||
      record.stage === 'prune'
        ? record.stage
        : null
    const role =
      record.role === 'budget_reducer' ||
      record.role === 'semantic_projection' ||
      record.role === 'terminal_fallback'
        ? record.role
        : null
    const scope =
      record.scope === 'persisted_history_candidate' ||
      record.scope === 'request_history_projection' ||
      record.scope === 'assembled_request_envelope'
        ? record.scope
        : null
    const disposition = record.disposition === 'applied' || record.disposition === 'skipped' ? record.disposition : null
    const terminal = typeof record.terminal === 'boolean' ? record.terminal : null
    const advisory = typeof record.advisory === 'boolean' ? record.advisory : null
    const reason = typeof record.reason === 'string' ? record.reason : null
    const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
    const inputTokens = asFiniteNumber(record.inputTokens)
    const outputTokens = asFiniteNumber(record.outputTokens)
    if (
      !stage ||
      !role ||
      !scope ||
      !disposition ||
      terminal == null ||
      advisory == null ||
      reason == null ||
      estimatedTokensSaved == null ||
      inputTokens == null ||
      outputTokens == null
    ) {
      return null
    }
    rows.push({
      stage,
      role,
      scope,
      disposition,
      terminal,
      advisory,
      reason,
      estimatedTokensSaved,
      inputTokens,
      outputTokens,
    })
  }
  return rows
}

function parseStrategyControlPlane(value: unknown): RpcContextStrategyControlPlane | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const stageOrder = parseMiddleLayerStageArray(record.stageOrder)
  const appliedStages = parseMiddleLayerStageArray(record.appliedStages)
  const skippedStages = parseMiddleLayerStageArray(record.skippedStages)
  const terminalStage = parseNullableMiddleLayerStage(record.terminalStage)
  const terminalDisposition = parseNullableMiddleLayerDisposition(record.terminalDisposition)
  const dominantSavingStage = parseNullableMiddleLayerStage(record.dominantSavingStage)
  const dominantSavingTokens = asFiniteNumber(record.dominantSavingTokens)
  if (
    !stageOrder ||
    !appliedStages ||
    !skippedStages ||
    terminalStage === undefined ||
    terminalDisposition === undefined ||
    dominantSavingStage === undefined ||
    dominantSavingTokens == null
  ) {
    return null
  }
  return {
    stageOrder,
    appliedStages,
    skippedStages,
    terminalStage,
    terminalDisposition,
    dominantSavingStage,
    dominantSavingTokens,
  }
}

function parseMiddleLayerStageArray(
  value: unknown,
): Array<'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'> | null {
  if (!Array.isArray(value)) return null
  const out: Array<'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune'> = []
  for (const item of value) {
    const parsed = parseNullableMiddleLayerStage(item)
    if (parsed == null) return null
    out.push(parsed)
  }
  return out
}

function parseNullableMiddleLayerStage(
  value: unknown,
): 'microcompact' | 'tool_result_budget' | 'snip' | 'collapse' | 'prune' | null | undefined {
  if (value == null) return null
  return value === 'microcompact' ||
    value === 'tool_result_budget' ||
    value === 'snip' ||
    value === 'collapse' ||
    value === 'prune'
    ? value
    : undefined
}

function parseNullableMiddleLayerDisposition(value: unknown): 'applied' | 'skipped' | null | undefined {
  if (value == null) return null
  return value === 'applied' || value === 'skipped' ? value : undefined
}

function parseCollapseImpact(value: unknown): RpcContextCollapseImpact | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const collapsed = typeof record.collapsed === 'boolean' ? record.collapsed : null
  const collapsedHeadMessageCount = asFiniteNumber(record.collapsedHeadMessageCount)
  const estimatedTokensSaved = asFiniteNumber(record.estimatedTokensSaved)
  const projectedHistoryTokensAfterCollapse = asFiniteNumber(record.projectedHistoryTokensAfterCollapse)
  const projectedHistoryDeltaTokens = asFiniteNumber(record.projectedHistoryDeltaTokens)
  const metadataField = parseOptionalNullableCollapseMeta(record)
  if (
    collapsed == null ||
    collapsedHeadMessageCount == null ||
    estimatedTokensSaved == null ||
    projectedHistoryTokensAfterCollapse == null ||
    projectedHistoryDeltaTokens == null ||
    !metadataField
  ) {
    return null
  }
  return {
    collapsed,
    collapsedHeadMessageCount,
    estimatedTokensSaved,
    projectedHistoryTokensAfterCollapse,
    projectedHistoryDeltaTokens,
    ...(metadataField.present ? { metadata: metadataField.value } : {}),
  }
}

function parseOptionalNullableCollapseMeta(
  record: Record<string, unknown>,
): { present: boolean; value: RpcContextCollapseMeta | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, 'metadata')) return { present: false, value: null }
  if (record.metadata == null) return { present: true, value: null }
  const parsed = parseCollapseMeta(record.metadata)
  if (!parsed) return null
  return { present: true, value: parsed }
}

function parseCollapseMeta(value: unknown): RpcContextCollapseMeta | null {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1 || record.kind !== 'request_recap') return null
  const keepLastTurns = asFiniteNumber(record.keepLastTurns)
  const preservedTailMessageCount = asFiniteNumber(record.preservedTailMessageCount)
  const retainedCompactSummary =
    typeof record.retainedCompactSummary === 'boolean' ? record.retainedCompactSummary : null
  const recentUserPromptCount = asFiniteNumber(record.recentUserPromptCount)
  const recentFileCount = asFiniteNumber(record.recentFileCount)
  const earlierToolResultBlockCount = asFiniteNumber(record.earlierToolResultBlockCount)
  const recapFingerprint =
    typeof record.recapFingerprint === 'string' && record.recapFingerprint.trim() ? record.recapFingerprint : null
  if (
    keepLastTurns == null ||
    preservedTailMessageCount == null ||
    retainedCompactSummary == null ||
    recentUserPromptCount == null ||
    recentFileCount == null ||
    earlierToolResultBlockCount == null ||
    !recapFingerprint
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    kind: 'request_recap',
    keepLastTurns,
    preservedTailMessageCount,
    retainedCompactSummary,
    recentUserPromptCount,
    recentFileCount,
    earlierToolResultBlockCount,
    recapFingerprint,
  }
}

function parseContextDiagnosticsSnapshot(value: unknown): RpcContextDiagnosticsSnapshot | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const toolResultCountsByToolName = parseCountByToolNameList(record.toolResultCountsByToolName)
  const microCompactedCountsByToolName = parseCountByToolNameList(record.microCompactedCountsByToolName)
  const topSnapshotContributors = parseContributors(record.topSnapshotContributors)
  if (!toolResultCountsByToolName || !microCompactedCountsByToolName || !topSnapshotContributors) return null
  const systemSectionBreakdown = record.systemSectionBreakdown == null ? undefined : parseContributors(record.systemSectionBreakdown)
  if (record.systemSectionBreakdown != null && !systemSectionBreakdown) return null

  const totalTokens = asFiniteNumber(record.totalTokens)
  const systemTokens = asFiniteNumber(record.systemTokens)
  const historyTokens = asFiniteNumber(record.historyTokens)
  const toolResultTokens = asFiniteNumber(record.toolResultTokens)
  const otherHistoryTokens = asFiniteNumber(record.otherHistoryTokens)
  const messageCount = asFiniteNumber(record.messageCount)
  const userMessageCount = asFiniteNumber(record.userMessageCount)
  const assistantMessageCount = asFiniteNumber(record.assistantMessageCount)
  const toolResultBlockCount = asFiniteNumber(record.toolResultBlockCount)
  const microCompactedToolResultCount = asFiniteNumber(record.microCompactedToolResultCount)
  if (
    totalTokens == null ||
    systemTokens == null ||
    historyTokens == null ||
    toolResultTokens == null ||
    otherHistoryTokens == null ||
    messageCount == null ||
    userMessageCount == null ||
    assistantMessageCount == null ||
    toolResultBlockCount == null ||
    microCompactedToolResultCount == null
  ) {
    return null
  }
  const contextWindowTokens = parseRequiredNullableNumber(record.contextWindowTokens)
  const effectiveLimitTokens = parseRequiredNullableNumber(record.effectiveLimitTokens)
  const autoCompactLimitTokens = parseRequiredNullableNumber(record.autoCompactLimitTokens)
  const baselineTokens = parseRequiredNullableNumber(record.baselineTokens)
  const percentRemaining = parseRequiredNullableNumber(record.percentRemaining)
  const remainingToEffectiveLimit = parseRequiredNullableNumber(record.remainingToEffectiveLimit)
  const remainingToAutoCompactLimit = parseRequiredNullableNumber(record.remainingToAutoCompactLimit)
  const shouldAutoCompact = parseRequiredNullableBoolean(record.shouldAutoCompact)
  if (
    !contextWindowTokens ||
    !effectiveLimitTokens ||
    !autoCompactLimitTokens ||
    !baselineTokens ||
    !percentRemaining ||
    !remainingToEffectiveLimit ||
    !remainingToAutoCompactLimit ||
    !shouldAutoCompact
  ) {
    return null
  }

  return {
    totalTokens,
    systemTokens,
    ...(systemSectionBreakdown ? { systemSectionBreakdown } : {}),
    historyTokens,
    toolResultTokens,
    otherHistoryTokens,
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolResultBlockCount,
    microCompactedToolResultCount,
    toolResultCountsByToolName,
    microCompactedCountsByToolName,
    contextWindowTokens: contextWindowTokens.value,
    effectiveLimitTokens: effectiveLimitTokens.value,
    autoCompactLimitTokens: autoCompactLimitTokens.value,
    baselineTokens: baselineTokens.value,
    percentRemaining: percentRemaining.value,
    remainingToEffectiveLimit: remainingToEffectiveLimit.value,
    remainingToAutoCompactLimit: remainingToAutoCompactLimit.value,
    shouldAutoCompact: shouldAutoCompact.value,
    topSnapshotContributors,
  }
}

function parseNextTurnFixedContextDiagnostics(value: unknown): RpcNextTurnFixedContextDiagnostics | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const fixedGroupsValue = record.fixedGroups
  if (!Array.isArray(fixedGroupsValue)) return null
  const fixedGroups: RpcNextTurnFixedContextDiagnostics['fixedGroups'] = []
  for (const row of fixedGroupsValue) {
    const item = asOptionalRecord(row)
    if (!item) return null
    const label = typeof item.label === 'string' && item.label.trim() ? item.label : null
    const blockCount = asFiniteNumber(item.blockCount)
    const tokens = asFiniteNumber(item.tokens)
    if (!label || blockCount == null || tokens == null) return null
    fixedGroups.push({ label, blockCount, tokens })
  }
  const microCompactImpact = parseMicroCompactImpact(record.microCompactImpact)
  const toolResultBudgetImpact =
    record.toolResultBudgetImpact == null ? undefined : parseToolResultBudgetImpact(record.toolResultBudgetImpact)
  if (record.toolResultBudgetImpact != null && !toolResultBudgetImpact) return null
  const snipImpact = record.snipImpact == null ? undefined : parseSnipImpact(record.snipImpact)
  if (record.snipImpact != null && !snipImpact) return null
  const assembledLedger = record.assembledLedger == null ? undefined : parseAssembledLedger(record.assembledLedger)
  if (record.assembledLedger != null && !assembledLedger) return null
  const strategyCoordination =
    record.strategyCoordination == null ? undefined : parseStrategyCoordination(record.strategyCoordination)
  if (record.strategyCoordination != null && !strategyCoordination) return null
  const strategyControlPlane =
    record.strategyControlPlane == null ? undefined : parseStrategyControlPlane(record.strategyControlPlane)
  if (record.strategyControlPlane != null && !strategyControlPlane) return null
  const workingSetSignals = record.workingSetSignals == null ? undefined : parseWorkingSetSignals(record.workingSetSignals)
  if (record.workingSetSignals != null && !workingSetSignals) return null
  const collapseImpact = record.collapseImpact == null ? undefined : parseCollapseImpact(record.collapseImpact)
  if (record.collapseImpact != null && !collapseImpact) return null
  const lifecycleMarkers = record.lifecycleMarkers == null ? undefined : parseLifecycleMarkers(record.lifecycleMarkers)
  if (record.lifecycleMarkers != null && !lifecycleMarkers) return null
  const topAssembledContributors = parseContributors(record.topAssembledContributors)
  const autoCompactSkipReason = parseOptionalNullableStringField(record, 'autoCompactSkipReason')
  const pruneSkipReason = parseOptionalNullableStringField(record, 'pruneSkipReason')
  const projectedHistoryTokens = asFiniteNumber(record.projectedHistoryTokens)
  const projectedHistoryDeltaTokens = asFiniteNumber(record.projectedHistoryDeltaTokens)
  const fixedTokens = asFiniteNumber(record.fixedTokens)
  const totalTokens = asFiniteNumber(record.totalTokens)
  if (
    !microCompactImpact ||
    !topAssembledContributors ||
    !autoCompactSkipReason ||
    !pruneSkipReason ||
    projectedHistoryTokens == null ||
    projectedHistoryDeltaTokens == null ||
    fixedTokens == null ||
    totalTokens == null
  ) {
    return null
  }
  const remainingToEffectiveLimit = parseRequiredNullableNumber(record.remainingToEffectiveLimit)
  const remainingToAutoCompactLimit = parseRequiredNullableNumber(record.remainingToAutoCompactLimit)
  const shouldAutoCompact = parseRequiredNullableBoolean(record.shouldAutoCompact)
  if (!remainingToEffectiveLimit || !remainingToAutoCompactLimit || !shouldAutoCompact) return null
  return {
    fixedGroups,
    ...(assembledLedger ? { assembledLedger } : {}),
    ...(strategyCoordination ? { strategyCoordination } : {}),
    ...(strategyControlPlane ? { strategyControlPlane } : {}),
    ...(workingSetSignals ? { workingSetSignals } : {}),
    ...(toolResultBudgetImpact ? { toolResultBudgetImpact } : {}),
    microCompactImpact,
    ...(snipImpact ? { snipImpact } : {}),
    ...(collapseImpact ? { collapseImpact } : {}),
    ...(lifecycleMarkers ? { lifecycleMarkers } : {}),
    projectedHistoryTokens,
    projectedHistoryDeltaTokens,
    fixedTokens,
    totalTokens,
    remainingToEffectiveLimit: remainingToEffectiveLimit.value,
    remainingToAutoCompactLimit: remainingToAutoCompactLimit.value,
    shouldAutoCompact: shouldAutoCompact.value,
    ...(autoCompactSkipReason.present ? { autoCompactSkipReason: autoCompactSkipReason.value } : {}),
    ...(pruneSkipReason.present ? { pruneSkipReason: pruneSkipReason.value } : {}),
    topAssembledContributors,
  }
}

function parseWorkingSetSignals(value: unknown): RpcWorkingSetSignals | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const recentFileCount = asFiniteNumber(record.recentFileCount)
  const hasPlanState = typeof record.hasPlanState === 'boolean' ? record.hasPlanState : null
  const hasTodoState = typeof record.hasTodoState === 'boolean' ? record.hasTodoState : null
  const modeState =
    record.modeState === 'normal' || record.modeState === 'acceptEdits' || record.modeState === 'plan'
      ? record.modeState
      : null
  const keepMinTokensBoost = asFiniteNumber(record.keepMinTokensBoost)
  const keepMinUserTurnsBoost = asFiniteNumber(record.keepMinUserTurnsBoost)
  const taskStateKinds = record.taskStateKinds == null ? undefined : parseWorkingSetTaskStateKinds(record.taskStateKinds)
  if (record.taskStateKinds != null && !taskStateKinds) return null
  const selectionReasons = parseOptionalStringList(record.selectionReasons)
  if (record.selectionReasons !== undefined && !selectionReasons) return null
  const anchorKind =
    record.anchorKind === 'none' ||
    record.anchorKind === 'read' ||
    record.anchorKind === 'filesystem_cluster' ||
    record.anchorKind === 'task_execution_cluster'
      ? record.anchorKind
      : null
  const anchorToolNames = parseRequiredStringList(record.anchorToolNames)
  const anchorBacktrackTurns = asFiniteNumber(record.anchorBacktrackTurns)
  const anchorMaxBacktrackTurns = asFiniteNumber(record.anchorMaxBacktrackTurns)
  if (
    recentFileCount == null ||
    hasPlanState == null ||
    hasTodoState == null ||
    !modeState ||
    keepMinTokensBoost == null ||
    keepMinUserTurnsBoost == null ||
    !anchorKind ||
    !anchorToolNames ||
    anchorBacktrackTurns == null ||
    anchorMaxBacktrackTurns == null
  ) {
    return null
  }
  return {
    recentFileCount,
    hasPlanState,
    hasTodoState,
    modeState,
    keepMinTokensBoost,
    keepMinUserTurnsBoost,
    ...(taskStateKinds ? { taskStateKinds } : {}),
    ...(selectionReasons ? { selectionReasons: selectionReasons.value } : {}),
    anchorKind,
    anchorToolNames: anchorToolNames.value,
    anchorBacktrackTurns,
    anchorMaxBacktrackTurns,
  }
}

function parseWorkingSetTaskStateKinds(
  value: unknown,
): Array<'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'> | null {
  if (!Array.isArray(value)) return null
  const out: Array<'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'> = []
  for (const item of value) {
    if (item !== 'recent_files' && item !== 'plan_state' && item !== 'todo_state' && item !== 'mode_state') {
      return null
    }
    out.push(item)
  }
  return out
}

function parseAssembledLedger(value: unknown): RpcAssembledLedgerRow[] | null {
  if (!Array.isArray(value)) return null
  const rows: RpcAssembledLedgerRow[] = []
  for (const entry of value) {
    const row = asOptionalRecord(entry)
    if (!row) return null
    const kind =
      row.kind === 'system_total' ||
      row.kind === 'request_history' ||
      row.kind === 'tool_result_group' ||
      row.kind === 'tool_result_budget_savings' ||
      row.kind === 'fixed_group' ||
      row.kind === 'fixed_total' ||
      row.kind === 'assembled_total'
        ? row.kind
        : null
    const key = typeof row.key === 'string' && row.key.trim() ? row.key : null
    const label = typeof row.label === 'string' && row.label.trim() ? row.label : null
    const tokens = asFiniteNumber(row.tokens)
    const messageCount = row.messageCount == null ? undefined : asFiniteNumber(row.messageCount)
    const blockCount = row.blockCount == null ? undefined : asFiniteNumber(row.blockCount)
    if (!kind || !key || !label || tokens == null) return null
    if (row.messageCount != null && messageCount == null) return null
    if (row.blockCount != null && blockCount == null) return null
    rows.push({
      kind,
      key,
      label,
      tokens,
      ...(messageCount != null ? { messageCount } : {}),
      ...(blockCount != null ? { blockCount } : {}),
    })
  }
  return rows
}

function parseLatestCompactBoundary(value: unknown): RpcLatestCompactBoundary | null {
  return parseCompactBoundarySummary(value)
}

function parseStrictLatestCompactBoundaryField(
  record: Record<string, unknown>,
): { value: RpcLatestCompactBoundary | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, 'latestCompactBoundary')) return null
  const value = record.latestCompactBoundary
  if (value === null) return { value: null }
  const parsed = parseLatestCompactBoundary(value)
  return parsed ? { value: parsed } : null
}

function parseOptionalNullableLatestCompactBoundaryField(
  record: Record<string, unknown>,
  fieldName: string,
): { present: boolean; value: RpcLatestCompactBoundary | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, fieldName)) return { present: false, value: null }
  const value = record[fieldName]
  if (value === null) return { present: true, value: null }
  const parsed = parseLatestCompactBoundary(value)
  return parsed ? { present: true, value: parsed } : null
}

function parseDurableSnipSummary(value: unknown): DurableSnipSummary | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const stage = record.stage === 'snip' ? 'snip' : null
  const status = record.status === 'no_state' || record.status === 'active' ? record.status : null
  const applied = typeof record.applied === 'boolean' ? record.applied : null
  const reason = typeof record.reason === 'string' ? record.reason : null
  const removedMessageCount = asFiniteNumber(record.removedMessageCount)
  const droppedOrphanToolBlockCount = asFiniteNumber(record.droppedOrphanToolBlockCount)
  const removalRangeCount = asFiniteNumber(record.removalRangeCount)
  if (
    !stage ||
    !status ||
    applied == null ||
    reason == null ||
    removedMessageCount == null ||
    droppedOrphanToolBlockCount == null ||
    removalRangeCount == null
  ) {
    return null
  }
  return {
    stage,
    status,
    applied,
    reason,
    removedMessageCount,
    droppedOrphanToolBlockCount,
    removalRangeCount,
  }
}

function parseOptionalNullableDurableSnipField(
  record: Record<string, unknown>,
  fieldName: string,
): { present: boolean; value: DurableSnipSummary | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, fieldName)) return { present: false, value: null }
  const value = record[fieldName]
  if (value === null) return { present: true, value: null }
  const parsed = parseDurableSnipSummary(value)
  return parsed ? { present: true, value: parsed } : null
}

function parseRequiredStringList(value: unknown): { value: string[] } | null {
  if (!Array.isArray(value)) return null
  const rows: string[] = []
  for (const row of value) {
    if (typeof row !== 'string') return null
    rows.push(row)
  }
  return { value: rows }
}

function parseRequiredNullableString(value: unknown): { value: string | null } | null {
  if (value === null) return { value: null }
  return typeof value === 'string' ? { value } : null
}

function parseOptionalStringList(value: unknown): { value: string[] } | null | undefined {
  if (value === undefined) return undefined
  return parseRequiredStringList(value)
}

function parseRequiredNullableNumber(value: unknown): { value: number | null } | null {
  if (value === null) return { value: null }
  const parsed = asFiniteNumber(value)
  return parsed == null ? null : { value: parsed }
}

function parseRequiredNullableBoolean(value: unknown): { value: boolean | null } | null {
  if (value === null) return { value: null }
  return typeof value === 'boolean' ? { value } : null
}

function parseOptionalNullableStringField(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: string | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { present: false, value: null }
  const value = record[key]
  if (value === null) return { present: true, value: null }
  return typeof value === 'string' ? { present: true, value } : null
}
