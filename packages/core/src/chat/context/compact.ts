import type { PromptMessage } from '../../prompts'
import { createHash } from 'node:crypto'
import { estimatePromptTokens } from './estimate'

const CONTINUED_SESSION_SUMMARY_PREFIX =
  'This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:'
const RECENT_FILES_REHYDRATION_PREFIX = 'Recent files to keep in working memory:'
const AUTO_COMPACT_KEEP_MIN_TOKENS = 1200
const AUTO_COMPACT_KEEP_MIN_USER_TURNS = 1
const AUTO_COMPACT_RECENT_FILE_TOKEN_BOOST = 200
const AUTO_COMPACT_PLAN_STATE_TOKEN_BOOST = 250
const AUTO_COMPACT_TODO_STATE_TOKEN_BOOST = 250
const AUTO_COMPACT_MODE_STATE_TOKEN_BOOST = 150
const AUTO_COMPACT_TASK_EXECUTION_CLUSTER_TOKEN_BOOST = 250
const READ_WORKING_SET_MAX_BACKTRACK_TURNS = 1
const FILESYSTEM_CLUSTER_WORKING_SET_MAX_BACKTRACK_TURNS = 2
const TASK_EXECUTION_CLUSTER_WORKING_SET_MAX_BACKTRACK_TURNS = 3
const WORKING_SET_FILESYSTEM_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob'])
const WORKING_SET_EXECUTION_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'TodoWrite'])
const WORKING_SET_ANCHOR_TOOL_NAMES = new Set([
  ...WORKING_SET_FILESYSTEM_TOOL_NAMES,
  ...WORKING_SET_EXECUTION_TOOL_NAMES,
])

export type CompactBoundaryTrigger = 'manual' | 'auto' | 'reactive'
export type CompactTriggerReasonKind = 'auto_threshold' | 'manual' | 'reactive_error'
export type CompactTriggerReason = {
  kind: CompactTriggerReasonKind
  detail?: string
}
export type CompactBoundarySummaryKind = 'model_summary' | 'session_memory'
export type CompactBoundaryKeepStrategy =
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

export type AutoCompactWorkingSetSignals = {
  recentFileCount: number
  hasPlanState: boolean
  hasTodoState: boolean
  modeState: 'normal' | 'acceptEdits' | 'plan'
  keepMinTokensBoost: number
  keepMinUserTurnsBoost: number
  taskStateKinds: CompactRehydrationItemKind[]
  selectionReasons: string[]
  anchorKind: 'none' | 'read' | 'filesystem_cluster' | 'task_execution_cluster'
  anchorToolNames: string[]
  anchorBacktrackTurns: number
  anchorMaxBacktrackTurns: number
}

export type WorkingSetAnchorInfo = {
  kind: 'read' | 'filesystem_cluster' | 'task_execution_cluster'
  toolNames: string[]
  turnPosition: number
  maxBacktrackTurns: number
}

export type WorkingSetSignalAnchor = {
  kind: WorkingSetAnchorInfo['kind']
  toolNames: string[]
  backtrackTurns: number
  maxBacktrackTurns: number
}

export type CompactRehydrationItemKind = 'recent_files' | 'plan_state' | 'todo_state' | 'mode_state'
export type CompactRehydrationItemPriority = 'high' | 'medium'
export type CompactRehydrationItemStatus = 'planned' | 'applied'

export type CompactRehydrationItem = {
  kind: CompactRehydrationItemKind
  priority: CompactRehydrationItemPriority
  status: CompactRehydrationItemStatus
}

export type CompactRehydrationPlan = {
  schemaVersion: 1
  items: CompactRehydrationItem[]
}

export type CompactRehydrationCost = {
  sectionCount: number
  estimatedTokens: number
}

export type CompactPreservedSegment = {
  schemaVersion: 1
  continuationMessageCount: number
  preservedTailMessageCount: number
  summaryFingerprint: string
  headFingerprint: string | null
  tailFingerprint: string | null
}

export type CompactBoundaryMeta = {
  schemaVersion: 1
  trigger?: CompactBoundaryTrigger
  triggerReason?: CompactTriggerReason
  preTokens?: number
  summaryKind?: CompactBoundarySummaryKind
  keepStrategy?: CompactBoundaryKeepStrategy
  rehydrationPlan?: CompactRehydrationPlan
  rehydrationCost?: CompactRehydrationCost
  preservedSegment?: CompactPreservedSegment
}

function isToolResultMessage(msg: PromptMessage): boolean {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return false
  return msg.content.some((b: any) => b?.type === 'tool_result')
}

function extractLeadingText(msg: PromptMessage): string {
  if (!Array.isArray(msg.content)) return ''
  for (const block of msg.content) {
    if (block?.type === 'text' && typeof (block as any).text === 'string') {
      return String((block as any).text)
    }
  }
  return ''
}

function findLastNonToolUserIndices(messages: PromptMessage[]): number[] {
  const out: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === 'user' && !isToolResultMessage(msg)) out.push(i)
  }
  return out
}

function collectSuccessfulToolResultIds(messages: PromptMessage[]): Set<string> {
  const out = new Set<string>()
  for (const message of messages) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_result') continue
      if (block?.is_error === true) continue
      if (typeof block?.tool_use_id === 'string' && block.tool_use_id.length > 0) {
        out.add(block.tool_use_id)
      }
    }
  }
  return out
}

export function buildAutoCompactKeepStrategy(keepLastTurns: number): CompactBoundaryKeepStrategy {
  return {
    kind: 'keep_combo',
    keepLastTurns: clampCount(keepLastTurns),
    keepMinTokens: AUTO_COMPACT_KEEP_MIN_TOKENS,
    keepMinUserTurns: AUTO_COMPACT_KEEP_MIN_USER_TURNS,
  }
}

export function deriveAutoCompactWorkingSetSignals(args: {
  mode: 'normal' | 'acceptEdits' | 'plan'
  rehydration?: {
    recentFiles?: string[]
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  }
  workingSetAnchor?: WorkingSetSignalAnchor | null
}): AutoCompactWorkingSetSignals {
  const recentFileCount = Math.min(
    3,
    Array.isArray(args.rehydration?.recentFiles)
      ? args.rehydration!.recentFiles.map((value) => String(value || '').trim()).filter(Boolean).length
      : 0,
  )
  const hasPlanState = Boolean(
    String(args.rehydration?.planPath ?? '').trim() ||
      String(args.rehydration?.planExcerpt ?? '').trim() ||
      args.mode === 'plan',
  )
  const hasTodoState = Boolean(String(args.rehydration?.todoSummary ?? '').trim())
  const taskStateKinds: CompactRehydrationItemKind[] = [
    ...(recentFileCount > 0 ? (['recent_files'] as const) : []),
    ...(hasPlanState ? (['plan_state'] as const) : []),
    ...(hasTodoState ? (['todo_state'] as const) : []),
    ...(args.mode !== 'normal' ? (['mode_state'] as const) : []),
  ]
  const keepMinTokensBoost =
    recentFileCount * AUTO_COMPACT_RECENT_FILE_TOKEN_BOOST +
    (hasPlanState ? AUTO_COMPACT_PLAN_STATE_TOKEN_BOOST : 0) +
    (hasTodoState ? AUTO_COMPACT_TODO_STATE_TOKEN_BOOST : 0) +
    (args.mode !== 'normal' ? AUTO_COMPACT_MODE_STATE_TOKEN_BOOST : 0) +
    (args.workingSetAnchor?.kind === 'task_execution_cluster' ? AUTO_COMPACT_TASK_EXECUTION_CLUSTER_TOKEN_BOOST : 0)
  const keepMinUserTurnsBoost =
    (recentFileCount >= 2 || hasPlanState || hasTodoState ? 1 : 0) +
    (args.workingSetAnchor?.kind === 'task_execution_cluster' && taskStateKinds.length > 0 ? 1 : 0)
  const selectionReasons = buildWorkingSetSelectionReasons({
    mode: args.mode,
    taskStateKinds,
    workingSetAnchor: args.workingSetAnchor ?? null,
  })

  return {
    recentFileCount,
    hasPlanState,
    hasTodoState,
    modeState: args.mode,
    keepMinTokensBoost,
    keepMinUserTurnsBoost,
    taskStateKinds,
    selectionReasons,
    anchorKind: args.workingSetAnchor?.kind ?? 'none',
    anchorToolNames: args.workingSetAnchor?.toolNames ?? [],
    anchorBacktrackTurns: args.workingSetAnchor?.backtrackTurns ?? 0,
    anchorMaxBacktrackTurns: args.workingSetAnchor?.maxBacktrackTurns ?? 0,
  }
}

export function buildWorkingSetAwareCompactKeepStrategy(args: {
  keepLastTurns: number
  mode: 'normal' | 'acceptEdits' | 'plan'
  history?: PromptMessage[]
  rehydration?: {
    recentFiles?: string[]
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  }
}): CompactBoundaryKeepStrategy {
  const keepLastTurns = clampCount(args.keepLastTurns)
  const baseSignals = deriveAutoCompactWorkingSetSignals({
    mode: args.mode,
    rehydration: args.rehydration,
  })
  const historyAnchor = Array.isArray(args.history)
    ? resolveWorkingSetSignalAnchor({
        messages: args.history,
        keepLastTurns,
        keepMinUserTurns: AUTO_COMPACT_KEEP_MIN_USER_TURNS + baseSignals.keepMinUserTurnsBoost,
      })
    : null
  const signals = deriveAutoCompactWorkingSetSignals({
    mode: args.mode,
    rehydration: args.rehydration,
    workingSetAnchor: historyAnchor,
  })
  return {
    kind: 'keep_combo',
    keepLastTurns,
    keepMinTokens: AUTO_COMPACT_KEEP_MIN_TOKENS + signals.keepMinTokensBoost,
    keepMinUserTurns: AUTO_COMPACT_KEEP_MIN_USER_TURNS + signals.keepMinUserTurnsBoost,
  }
}

export function selectTailForCompaction(
  messages: PromptMessage[],
  keepStrategy: number | CompactBoundaryKeepStrategy,
): PromptMessage[] {
  if (messages.length === 0) return []

  const userTurnIndices = findLastNonToolUserIndices(messages)
  if (userTurnIndices.length === 0) return []

  const strategy =
    typeof keepStrategy === 'number'
      ? ({
          kind: 'keep_last_turns',
          keepLastTurns: clampCount(keepStrategy),
        } satisfies CompactBoundaryKeepStrategy)
      : normalizeKeepStrategy(keepStrategy)

  if (strategy.kind === 'keep_last_turns') {
    if (strategy.keepLastTurns <= 0) return []
    const startUserIndex = userTurnIndices[Math.max(0, userTurnIndices.length - strategy.keepLastTurns)] as number
    return messages.slice(startUserIndex)
  }

  let startTurnPosition = userTurnIndices.length
  const requiredTurns = Math.max(strategy.keepLastTurns, strategy.keepMinUserTurns)
  if (requiredTurns > 0) {
    startTurnPosition = Math.max(0, userTurnIndices.length - requiredTurns)
  }

  const workingSetAnchor = findLatestWorkingSetAnchor(messages, userTurnIndices)
  const workingSetTurnPosition = workingSetAnchor?.turnPosition ?? null
  if (
    workingSetTurnPosition != null &&
    workingSetTurnPosition < startTurnPosition &&
    startTurnPosition - workingSetTurnPosition <= workingSetAnchor.maxBacktrackTurns
  ) {
    startTurnPosition = workingSetTurnPosition
  }

  let tail = sliceTailFromUserTurn(messages, userTurnIndices, startTurnPosition)
  while (
    strategy.keepMinTokens > 0 &&
    startTurnPosition > 0 &&
    estimateHistoryTokens(tail) < strategy.keepMinTokens
  ) {
    startTurnPosition -= 1
    tail = sliceTailFromUserTurn(messages, userTurnIndices, startTurnPosition)
  }

  return tail
}

export function collectRecentReadFilesForRehydration(messages: PromptMessage[], limit = 3): string[] {
  const keep = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (keep <= 0 || messages.length === 0) return []

  const successfulToolResultIds = collectSuccessfulToolResultIds(messages)
  if (successfulToolResultIds.size === 0) return []

  const deduped = new Set<string>()
  const recentFiles: string[] = []

  for (let index = messages.length - 1; index >= 0 && recentFiles.length < keep; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      if (block?.name !== 'Read') continue
      if (!successfulToolResultIds.has(String(block?.id ?? ''))) continue
      const filePath = typeof block?.input?.file_path === 'string' ? block.input.file_path.trim() : ''
      if (!filePath || deduped.has(filePath)) continue
      deduped.add(filePath)
      recentFiles.push(filePath)
      if (recentFiles.length >= keep) break
    }
  }

  return recentFiles
}

export function markCompactRehydrationApplied(
  plan: CompactRehydrationPlan,
  appliedKinds: CompactRehydrationItemKind[],
): CompactRehydrationPlan {
  if (!Array.isArray(plan.items) || plan.items.length === 0 || appliedKinds.length === 0) return plan
  const applied = new Set(appliedKinds)
  return {
    ...plan,
    items: plan.items.map((item) =>
      applied.has(item.kind)
        ? {
            ...item,
            status: 'applied',
          }
        : item,
    ),
  }
}

export function buildCompactionSummaryUserText(
  summary: string,
  rehydration?: {
    recentFiles?: string[]
    modeText?: string | null
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  },
): string {
  const trimmed = String(summary || '').trim()
  const recentFiles = Array.isArray(rehydration?.recentFiles)
    ? rehydration!.recentFiles.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const rehydrationSuffix =
    buildRehydrationSuffix({
      recentFiles,
      modeText: rehydration?.modeText ?? null,
      planPath: rehydration?.planPath ?? null,
      planExcerpt: rehydration?.planExcerpt ?? null,
      todoSummary: rehydration?.todoSummary ?? null,
    })
  return (
    '<system-reminder>\n' +
    `${CONTINUED_SESSION_SUMMARY_PREFIX}\n` +
    `${trimmed}${rehydrationSuffix}\n` +
    '</system-reminder>'
  )
}

export function estimateCompactRehydrationCost(rehydration?: {
  recentFiles?: string[]
  modeText?: string | null
  planPath?: string | null
  planExcerpt?: string | null
  todoSummary?: string | null
}): CompactRehydrationCost {
  const sections = buildRehydrationSections({
    recentFiles: Array.isArray(rehydration?.recentFiles) ? rehydration!.recentFiles : [],
    modeText: rehydration?.modeText ?? null,
    planPath: rehydration?.planPath ?? null,
    planExcerpt: rehydration?.planExcerpt ?? null,
    todoSummary: rehydration?.todoSummary ?? null,
  })

  if (sections.length === 0) {
    return {
      sectionCount: 0,
      estimatedTokens: 0,
    }
  }

  return {
    sectionCount: sections.length,
    estimatedTokens: estimatePromptTokens({
      system: [],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: sections.join('\n\n') }] as any,
        },
      ],
    }),
  }
}

export function buildCompactBoundaryMessage(args: {
  trigger: CompactBoundaryTrigger
  triggerReason?: CompactTriggerReason
  preTokens: number
  summaryKind: CompactBoundarySummaryKind
  keepStrategy: CompactBoundaryKeepStrategy
  rehydrationPlan?: CompactRehydrationPlan
  rehydrationCost?: CompactRehydrationCost
  preservedSegment?: CompactPreservedSegment
}): PromptMessage {
  return {
    role: 'assistant',
    content: [],
    meta: {
      compactBoundary: {
        schemaVersion: 1,
        trigger: args.trigger,
        ...(args.triggerReason ? { triggerReason: args.triggerReason } : {}),
        preTokens: Math.max(0, Math.round(args.preTokens)),
        summaryKind: args.summaryKind,
        keepStrategy: args.keepStrategy,
        ...(args.rehydrationPlan ? { rehydrationPlan: args.rehydrationPlan } : {}),
        ...(args.rehydrationCost ? { rehydrationCost: args.rehydrationCost } : {}),
        ...(args.preservedSegment ? { preservedSegment: args.preservedSegment } : {}),
      },
    },
  }
}

export function buildDefaultCompactRehydrationPlan(args: {
  mode: 'normal' | 'acceptEdits' | 'plan'
  planPath: string | null
  hasTodoState?: boolean
}): CompactRehydrationPlan {
  const items: CompactRehydrationItem[] = [
    {
      kind: 'recent_files',
      priority: 'high',
      status: 'planned',
    },
  ]

  if (args.planPath || args.mode === 'plan') {
    items.push({
      kind: 'plan_state',
      priority: 'high',
      status: 'planned',
    })
  }

  if (args.hasTodoState) {
    items.push({
      kind: 'todo_state',
      priority: 'high',
      status: 'planned',
    })
  }

  if (args.mode !== 'normal') {
    items.push({
      kind: 'mode_state',
      priority: 'medium',
      status: 'planned',
    })
  }

  return {
    schemaVersion: 1,
    items,
  }
}

export function isCompactBoundaryMessage(msg: PromptMessage | null | undefined): boolean {
  return msg?.role === 'assistant' && msg?.meta?.compactBoundary?.schemaVersion === 1
}

export function readCompactBoundaryMeta(msg: PromptMessage | null | undefined): CompactBoundaryMeta | null {
  return isCompactBoundaryMessage(msg) ? (msg!.meta!.compactBoundary as CompactBoundaryMeta) : null
}

export function findLatestCompactBoundary(messages: PromptMessage[]): CompactBoundaryMeta | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = readCompactBoundaryMeta(messages[index])
    if (meta) return meta
  }
  return null
}

export function findLatestCompactBoundaryIndex(messages: PromptMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCompactBoundaryMessage(messages[index])) return index
  }
  return -1
}

export function stripCompactBoundaryMessages(messages: PromptMessage[]): PromptMessage[] {
  if (!messages.some((message) => isCompactBoundaryMessage(message))) return messages
  return messages.filter((message) => !isCompactBoundaryMessage(message))
}

export function getContinuationMessagesAfterLatestCompactBoundary(messages: PromptMessage[]): PromptMessage[] {
  const latestBoundaryIndex = findLatestCompactBoundaryIndex(messages)
  if (latestBoundaryIndex < 0) return stripCompactBoundaryMessages(messages)
  return stripCompactBoundaryMessages(messages.slice(latestBoundaryIndex + 1))
}

export function buildActiveHistoryFromSessionReplay(messages: PromptMessage[]): PromptMessage[] {
  return getContinuationMessagesAfterLatestCompactBoundary(messages)
}

export function buildSessionReplayHistoryWithActiveContinuation(args: {
  replayHistory: PromptMessage[]
  activeHistory: PromptMessage[]
}): PromptMessage[] {
  const latestBoundaryIndex = findLatestCompactBoundaryIndex(args.replayHistory)
  if (latestBoundaryIndex < 0) return args.activeHistory
  return [...args.replayHistory.slice(0, latestBoundaryIndex + 1), ...args.activeHistory]
}

export function resolveHistoryForCompaction(args: {
  previousHistory: PromptMessage[]
  allowPartial: boolean
  preferLatestBoundaryTailSource?: boolean
}): {
  history: PromptMessage[]
  tailSourceHistory: PromptMessage[]
  partial: boolean
} {
  const latestBoundaryIndex = findLatestCompactBoundaryIndex(args.previousHistory)
  const continuation = getContinuationMessagesAfterLatestCompactBoundary(args.previousHistory)
  const boundaryTailSource =
    continuation.length > 0 && continuation[0]?.role === 'user' ? continuation.slice(1) : continuation

  if (!args.allowPartial) {
    return {
      history: args.previousHistory,
      tailSourceHistory:
        args.preferLatestBoundaryTailSource && latestBoundaryIndex >= 0 && boundaryTailSource.length > 0
          ? boundaryTailSource
          : args.previousHistory,
      partial: false,
    }
  }

  const partial = latestBoundaryIndex >= 0 && continuation.length > 0
  return {
    history: partial ? continuation : args.previousHistory,
    tailSourceHistory: partial ? boundaryTailSource : args.previousHistory,
    partial,
  }
}

export function isCompactionSummaryUserMessage(msg: PromptMessage): boolean {
  if (!msg || msg.role !== 'user') return false
  if (isToolResultMessage(msg)) return false
  const raw = extractLeadingText(msg)
  const text = unwrapSystemReminder(raw)
  return text.startsWith(CONTINUED_SESSION_SUMMARY_PREFIX)
}

export function buildCompactPreservedSegmentMeta(args: {
  summaryMessage: PromptMessage
  preservedTail: PromptMessage[]
}): CompactPreservedSegment {
  const head = args.preservedTail[0] ?? null
  const tail = args.preservedTail[args.preservedTail.length - 1] ?? null
  return {
    schemaVersion: 1,
    continuationMessageCount: 1 + args.preservedTail.length,
    preservedTailMessageCount: args.preservedTail.length,
    summaryFingerprint: fingerprintPromptMessage(args.summaryMessage),
    headFingerprint: head ? fingerprintPromptMessage(head) : null,
    tailFingerprint: tail ? fingerprintPromptMessage(tail) : null,
  }
}

export function continuationMatchesPreservedSegment(args: {
  boundary: CompactBoundaryMeta | null | undefined
  continuationMessages: PromptMessage[]
}): boolean {
  const preservedSegment = args.boundary?.preservedSegment
  if (!preservedSegment) return false
  if (args.continuationMessages.length !== preservedSegment.continuationMessageCount) return false
  const summaryMessage = args.continuationMessages[0]
  if (!summaryMessage) return false
  if (fingerprintPromptMessage(summaryMessage) !== preservedSegment.summaryFingerprint) return false

  const preservedTail = args.continuationMessages.slice(1)
  if (preservedTail.length !== preservedSegment.preservedTailMessageCount) return false
  if (preservedTail.length === 0) {
    return preservedSegment.headFingerprint == null && preservedSegment.tailFingerprint == null
  }

  return (
    fingerprintPromptMessage(preservedTail[0]!) === preservedSegment.headFingerprint &&
    fingerprintPromptMessage(preservedTail[preservedTail.length - 1]!) === preservedSegment.tailFingerprint
  )
}

export function rebuildHistoryAfterCompaction(args: {
  summary: string
  previousHistory: PromptMessage[]
  tailSourceHistory?: PromptMessage[]
  keepStrategy: CompactBoundaryKeepStrategy
  rehydration?: {
    recentFiles?: string[]
    modeText?: string | null
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  }
  boundaryMeta: {
    trigger: CompactBoundaryTrigger
    triggerReason?: CompactTriggerReason
    preTokens: number
    summaryKind: CompactBoundarySummaryKind
    keepStrategy: CompactBoundaryKeepStrategy
    rehydrationPlan?: CompactRehydrationPlan
    rehydrationCost?: CompactRehydrationCost
    preservedSegment?: CompactPreservedSegment
  }
}): PromptMessage[] {
  const summaryText = buildCompactionSummaryUserText(args.summary, args.rehydration)
  const summaryMsg: PromptMessage = {
    role: 'user',
    content: [{ type: 'text', text: summaryText }] as any,
  }

  const tail = selectTailForCompaction(args.tailSourceHistory ?? args.previousHistory, args.keepStrategy)
  return [
    buildCompactBoundaryMessage({
      ...args.boundaryMeta,
      preservedSegment: args.boundaryMeta.preservedSegment ?? buildCompactPreservedSegmentMeta({
        summaryMessage: summaryMsg,
        preservedTail: tail,
      }),
    }),
    summaryMsg,
    ...tail,
  ]
}

export function fingerprintPromptMessage(message: PromptMessage): string {
  const normalized = JSON.stringify({
    role: message.role,
    content: Array.isArray(message.content) ? message.content : [],
  })
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16)
}

function estimateHistoryTokens(messages: PromptMessage[]): number {
  if (messages.length === 0) return 0
  return estimatePromptTokens({
    system: [],
    messages,
  })
}

function sliceTailFromUserTurn(messages: PromptMessage[], userTurnIndices: number[], turnPosition: number): PromptMessage[] {
  if (turnPosition >= userTurnIndices.length) return []
  const startUserIndex = userTurnIndices[turnPosition]
  return typeof startUserIndex === 'number' ? messages.slice(startUserIndex) : []
}

export function findLatestWorkingSetAnchor(
  messages: PromptMessage[],
  userTurnIndices: number[],
): WorkingSetAnchorInfo | null {
  if (messages.length === 0 || userTurnIndices.length === 0) return null
  const successfulToolResultIds = collectSuccessfulToolResultIds(messages)
  if (successfulToolResultIds.size === 0) return null

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue

    let matched = false
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      if (!WORKING_SET_ANCHOR_TOOL_NAMES.has(String(block?.name ?? ''))) continue
      if (!successfulToolResultIds.has(String(block?.id ?? ''))) continue
      matched = true
      break
    }

    if (!matched) continue

    const turnPosition = findUserTurnPositionAtOrBeforeIndex(userTurnIndices, messageIndex)
    if (turnPosition == null) return null
    const toolNames = collectWorkingSetAnchorToolNames(messages, userTurnIndices, turnPosition, successfulToolResultIds)
    if (toolNames.length === 0) return null
    const hasFilesystemTool = toolNames.some((toolName) => WORKING_SET_FILESYSTEM_TOOL_NAMES.has(toolName))
    const hasExecutionTool = toolNames.some((toolName) => WORKING_SET_EXECUTION_TOOL_NAMES.has(toolName))
    const kind =
      hasExecutionTool
        ? 'task_execution_cluster'
        : toolNames.length === 1 && toolNames[0] === 'Read'
          ? 'read'
          : 'filesystem_cluster'

    return {
      kind,
      toolNames,
      turnPosition,
      maxBacktrackTurns: hasExecutionTool
        ? TASK_EXECUTION_CLUSTER_WORKING_SET_MAX_BACKTRACK_TURNS
        : toolNames.length === 1 && toolNames[0] === 'Read'
          ? READ_WORKING_SET_MAX_BACKTRACK_TURNS
          : hasFilesystemTool
            ? FILESYSTEM_CLUSTER_WORKING_SET_MAX_BACKTRACK_TURNS
            : READ_WORKING_SET_MAX_BACKTRACK_TURNS,
    }
  }

  return null
}

function resolveLatestWorkingSetAnchor(messages: PromptMessage[]): WorkingSetAnchorInfo | null {
  return findLatestWorkingSetAnchor(messages, findLastNonToolUserIndices(messages))
}

export function resolveWorkingSetSignalAnchor(args: {
  messages: PromptMessage[]
  keepLastTurns: number
  keepMinUserTurns: number
}): WorkingSetSignalAnchor | null {
  const userTurnIndices = findLastNonToolUserIndices(args.messages)
  if (userTurnIndices.length === 0) return null
  const anchor = findLatestWorkingSetAnchor(args.messages, userTurnIndices)
  if (!anchor) return null

  const baselineStartTurnPosition = Math.max(
    0,
    userTurnIndices.length - Math.max(clampCount(args.keepLastTurns), clampCount(args.keepMinUserTurns)),
  )
  if (anchor.turnPosition >= baselineStartTurnPosition) {
    return {
      kind: anchor.kind,
      toolNames: anchor.toolNames,
      backtrackTurns: 0,
      maxBacktrackTurns: anchor.maxBacktrackTurns,
    }
  }

  const backtrackTurns = baselineStartTurnPosition - anchor.turnPosition
  if (backtrackTurns > anchor.maxBacktrackTurns) return null
  return {
    kind: anchor.kind,
    toolNames: anchor.toolNames,
    backtrackTurns,
    maxBacktrackTurns: anchor.maxBacktrackTurns,
  }
}

function collectWorkingSetAnchorToolNames(
  messages: PromptMessage[],
  userTurnIndices: number[],
  turnPosition: number,
  successfulToolResultIds: Set<string>,
): string[] {
  const startIndex = userTurnIndices[turnPosition]
  if (typeof startIndex !== 'number') return []
  const endIndex = turnPosition + 1 < userTurnIndices.length ? (userTurnIndices[turnPosition + 1] as number) : messages.length
  const names = new Set<string>()

  for (let index = startIndex; index < endIndex; index += 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      const toolName = String(block?.name ?? '')
      if (!WORKING_SET_ANCHOR_TOOL_NAMES.has(toolName)) continue
      if (!successfulToolResultIds.has(String(block?.id ?? ''))) continue
      names.add(toolName)
    }
  }

  return Array.from(names).sort()
}

function buildWorkingSetSelectionReasons(args: {
  mode: 'normal' | 'acceptEdits' | 'plan'
  taskStateKinds: CompactRehydrationItemKind[]
  workingSetAnchor: {
    kind: WorkingSetAnchorInfo['kind']
    toolNames: string[]
    backtrackTurns: number
    maxBacktrackTurns: number
  } | null
}): string[] {
  const reasons = new Set<string>(args.taskStateKinds)
  if (args.workingSetAnchor) {
    reasons.add(
      `anchor:${args.workingSetAnchor.kind}:${args.workingSetAnchor.toolNames.length > 0 ? args.workingSetAnchor.toolNames.join('+') : 'none'}`,
    )
    if (args.workingSetAnchor.backtrackTurns > 0) {
      reasons.add('anchor_backtrack_applied')
    }
    if (args.workingSetAnchor.kind === 'task_execution_cluster' && args.taskStateKinds.length > 0) {
      reasons.add('task_execution_cluster_boost')
    }
  }
  if (args.taskStateKinds.includes('plan_state') && args.taskStateKinds.includes('todo_state')) {
    reasons.add('task_state_combo')
  }
  if (args.mode !== 'normal') {
    reasons.add(`mode:${args.mode}`)
  }
  return Array.from(reasons)
}

function findUserTurnPositionAtOrBeforeIndex(userTurnIndices: number[], messageIndex: number): number | null {
  for (let position = userTurnIndices.length - 1; position >= 0; position -= 1) {
    if ((userTurnIndices[position] ?? Number.POSITIVE_INFINITY) <= messageIndex) return position
  }
  return null
}

function normalizeKeepStrategy(value: CompactBoundaryKeepStrategy): CompactBoundaryKeepStrategy {
  if (value.kind === 'keep_last_turns') {
    return {
      kind: 'keep_last_turns',
      keepLastTurns: clampCount(value.keepLastTurns),
    }
  }

  return {
    kind: 'keep_combo',
    keepLastTurns: clampCount(value.keepLastTurns),
    keepMinTokens: clampCount(value.keepMinTokens),
    keepMinUserTurns: clampCount(value.keepMinUserTurns),
  }
}

function clampCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value!))
}

function buildRehydrationSuffix(args: {
  recentFiles: string[]
  modeText: string | null
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
}): string {
  const sections = buildRehydrationSections(args)
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : ''
}

function buildRehydrationSections(args: {
  recentFiles: string[]
  modeText: string | null
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
}): string[] {
  const sections: string[] = []
  const recentFiles = args.recentFiles.map((file) => sanitizeReminderText(file))
  const modeText = args.modeText ? sanitizeReminderText(args.modeText) : null
  const planPath = args.planPath ? sanitizeReminderText(args.planPath) : null
  const planExcerpt = args.planExcerpt ? sanitizeReminderText(args.planExcerpt) : null
  const todoSummary = args.todoSummary ? sanitizeReminderText(args.todoSummary) : null

  if (recentFiles.length > 0) {
    sections.push(`${RECENT_FILES_REHYDRATION_PREFIX}\n${recentFiles.map((file) => `- ${file}`).join('\n')}`)
  }

  if (modeText) {
    sections.push(`Mode state to keep in working memory:\n- ${modeText}`)
  }

  if (planPath || planExcerpt) {
    const lines = ['Plan state to keep in working memory:']
    if (planPath) lines.push(`- Plan path: ${planPath}`)
    if (planExcerpt) lines.push(`- Plan excerpt: ${planExcerpt}`)
    sections.push(lines.join('\n'))
  }

  if (todoSummary) {
    sections.push(`Todo state to keep in working memory:\n${todoSummary}`)
  }

  return sections
}

export function sanitizeReminderText(value: string): string {
  return String(value || '').replace(/<\/?system-reminder>/gi, '[system-reminder]')
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  if (!match) return raw
  return String(match[1] || '').trim()
}

/**
 * Count user turns that are not tool-result messages and not compaction summary messages.
 * Exported here (chat/context layer) so diagnostics code can use it without reaching into
 * features/repl layers.
 */
export function countNonToolUserTurns(history: PromptMessage[]): number {
  let n = 0
  for (const msg of history) {
    if (!msg || msg.role !== 'user') continue
    if (isCompactionSummaryUserMessage(msg)) continue
    const content = (msg as any).content
    if (!Array.isArray(content)) {
      n++
      continue
    }
    const hasToolResult = content.some((b: any) => b?.type === 'tool_result')
    if (!hasToolResult) n++
  }
  return n
}
