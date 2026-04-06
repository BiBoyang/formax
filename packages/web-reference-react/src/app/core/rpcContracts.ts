import type { ResolvedInput, ThreadMessage, ThreadSummary } from '../../types'
import {
  asResolvedInputs,
  asThreadMessages,
  asThreadReplay,
  asThreadSummaries,
  type ReplayStateSnapshot,
} from './rpcParsers'

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
  microCompactImpact: RpcMicroCompactImpact
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

export type RpcContextDiagnosticsPayload = {
  kind: 'formax.context_diagnostics'
  schemaVersion: 1
  mode: string
  model: string
  latestCompactBoundary: RpcLatestCompactBoundary | null
  latestRequestCollapse?: RpcLatestRequestCollapse | null
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

export type RpcInputSubmitResult = {
  status: string
}

export type RpcThreadReplayResult = {
  data: Array<{ replaySeq: number; method: string; params?: unknown }>
  nextCursor: number
  latestCursor: number
  hasGap: boolean
  state: ReplayStateSnapshot | null
}

export type RpcThreadMessagesResult = {
  data: ThreadMessage[]
  nextCursor: string | null
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
  latestRequestCollapse?: RpcLatestRequestCollapse | null
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
  return asThreadReplay(value)
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
  const latestRequestCollapse = parseOptionalNullableLatestRequestCollapseField(root, 'latestRequestCollapse')
  if (!latestRequestCollapse) return null
  return {
    thread: { id, cwd, createdAt, updatedAt },
    transcriptPreview,
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
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
  const notes = parseRequiredStringList(record.notes)
  if (!mode || !model || !snapshot || !nextTurnFixed || !latestCompactBoundary || !latestRequestCollapse || !notes) return null
  return {
    kind: 'formax.context_diagnostics',
    schemaVersion: 1,
    mode,
    model,
    latestCompactBoundary: latestCompactBoundary.value,
    ...(latestRequestCollapse.present ? { latestRequestCollapse: latestRequestCollapse.value } : {}),
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

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
  if (compactedBlocks == null || estimatedTokensSaved == null || keptRecentBlocks == null || !compactedToolNames) {
    return null
  }
  return {
    compactedBlocks,
    compactedToolNames: compactedToolNames.value,
    estimatedTokensSaved,
    keptRecentBlocks,
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

function parseCompactTriggerReason(value: unknown): RpcCompactTriggerReason | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const kind =
    record.kind === 'auto_threshold' || record.kind === 'manual' || record.kind === 'reactive_error'
      ? record.kind
      : null
  const detail = typeof record.detail === 'string' && record.detail.trim() ? record.detail : undefined
  if (!kind) return null
  return detail ? { kind, detail } : { kind }
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
    microCompactImpact,
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

function parseLatestCompactBoundary(value: unknown): RpcLatestCompactBoundary | null {
  if (value == null) return null
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1) return null

  const keepStrategy = parseKeepStrategy(record.keepStrategy)
  const rehydrationPlan = parseRehydrationPlan(record.rehydrationPlan)
  const rehydrationCost = parseRehydrationCost(record.rehydrationCost)
  const preservedSegment = parsePreservedSegment(record.preservedSegment)
  const triggerReason = record.triggerReason == null ? undefined : parseCompactTriggerReason(record.triggerReason)
  if (record.triggerReason != null && !triggerReason) return null
  const trigger =
    record.trigger === 'manual' || record.trigger === 'auto' || record.trigger === 'reactive' ? record.trigger : undefined
  const summaryKind =
    record.summaryKind === 'model_summary' || record.summaryKind === 'session_memory'
      ? record.summaryKind
      : undefined

  return {
    schemaVersion: 1,
    ...(trigger ? { trigger } : {}),
    ...(triggerReason ? { triggerReason } : {}),
    ...(asFiniteNumber(record.preTokens) != null ? { preTokens: asFiniteNumber(record.preTokens)! } : {}),
    ...(summaryKind ? { summaryKind } : {}),
    ...(keepStrategy ? { keepStrategy } : {}),
    ...(rehydrationPlan ? { rehydrationPlan } : {}),
    ...(rehydrationCost ? { rehydrationCost } : {}),
    ...(preservedSegment ? { preservedSegment } : {}),
  }
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

function parseRequiredStringList(value: unknown): { value: string[] } | null {
  if (!Array.isArray(value)) return null
  const rows: string[] = []
  for (const row of value) {
    if (typeof row !== 'string') return null
    rows.push(row)
  }
  return { value: rows }
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

function parseKeepStrategy(value: unknown): RpcCompactBoundaryKeepStrategy | null {
  const record = asOptionalRecord(value)
  if (!record || typeof record.kind !== 'string') return null
  if (record.kind === 'keep_last_turns') {
    const keepLastTurns = asFiniteNumber(record.keepLastTurns)
    return keepLastTurns == null ? null : { kind: 'keep_last_turns', keepLastTurns }
  }
  if (record.kind === 'keep_combo') {
    const keepLastTurns = asFiniteNumber(record.keepLastTurns)
    const keepMinTokens = asFiniteNumber(record.keepMinTokens)
    const keepMinUserTurns = asFiniteNumber(record.keepMinUserTurns)
    if (keepLastTurns == null || keepMinTokens == null || keepMinUserTurns == null) return null
    return { kind: 'keep_combo', keepLastTurns, keepMinTokens, keepMinUserTurns }
  }
  return null
}

function parseRehydrationPlan(value: unknown): RpcCompactRehydrationPlan | null {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.items)) return null
  const items: RpcCompactRehydrationPlan['items'] = []
  for (const row of record.items) {
    const item = asOptionalRecord(row)
    if (!item) return null
    const kind =
      item.kind === 'recent_files' || item.kind === 'plan_state' || item.kind === 'todo_state' || item.kind === 'mode_state'
        ? item.kind
        : null
    const priority = item.priority === 'high' || item.priority === 'medium' ? item.priority : null
    const status = item.status === 'planned' || item.status === 'applied' ? item.status : null
    if (!kind || !priority || !status) return null
    items.push({ kind, priority, status })
  }
  return { schemaVersion: 1, items }
}

function parseRehydrationCost(value: unknown): RpcCompactRehydrationCost | null {
  const record = asOptionalRecord(value)
  if (!record) return null
  const sectionCount = asFiniteNumber(record.sectionCount)
  const estimatedTokens = asFiniteNumber(record.estimatedTokens)
  if (sectionCount == null || estimatedTokens == null) return null
  return { sectionCount, estimatedTokens }
}

function parsePreservedSegment(value: unknown): RpcCompactPreservedSegment | null {
  const record = asOptionalRecord(value)
  if (!record || record.schemaVersion !== 1) return null
  const continuationMessageCount = asFiniteNumber(record.continuationMessageCount)
  const preservedTailMessageCount = asFiniteNumber(record.preservedTailMessageCount)
  const summaryFingerprint =
    typeof record.summaryFingerprint === 'string' && record.summaryFingerprint ? record.summaryFingerprint : null
  const headFingerprint =
    record.headFingerprint == null
      ? null
      : typeof record.headFingerprint === 'string'
        ? record.headFingerprint
        : null
  const tailFingerprint =
    record.tailFingerprint == null
      ? null
      : typeof record.tailFingerprint === 'string'
        ? record.tailFingerprint
        : null
  if (continuationMessageCount == null || preservedTailMessageCount == null || !summaryFingerprint) return null
  return {
    schemaVersion: 1,
    continuationMessageCount,
    preservedTailMessageCount,
    summaryFingerprint,
    headFingerprint,
    tailFingerprint,
  }
}
