import type { PromptMessage } from '../../prompts'
import { estimatePromptTokens } from './estimate'

const CONTINUED_SESSION_SUMMARY_PREFIX =
  'This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:'
const RECENT_FILES_REHYDRATION_PREFIX = 'Recent files to keep in working memory:'
const AUTO_COMPACT_KEEP_MIN_TOKENS = 1200
const AUTO_COMPACT_KEEP_MIN_USER_TURNS = 1
const READ_WORKING_SET_MAX_BACKTRACK_TURNS = 1

export type CompactBoundaryTrigger = 'manual' | 'auto'
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

export type CompactBoundaryMeta = {
  schemaVersion: 1
  trigger?: CompactBoundaryTrigger
  preTokens?: number
  summaryKind?: CompactBoundarySummaryKind
  keepStrategy?: CompactBoundaryKeepStrategy
  rehydrationPlan?: CompactRehydrationPlan
  rehydrationCost?: CompactRehydrationCost
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

  const workingSetTurnPosition = findLatestReadWorkingSetTurnPosition(messages, userTurnIndices)
  if (
    workingSetTurnPosition != null &&
    workingSetTurnPosition < startTurnPosition &&
    startTurnPosition - workingSetTurnPosition <= READ_WORKING_SET_MAX_BACKTRACK_TURNS
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
  preTokens: number
  summaryKind: CompactBoundarySummaryKind
  keepStrategy: CompactBoundaryKeepStrategy
  rehydrationPlan?: CompactRehydrationPlan
  rehydrationCost?: CompactRehydrationCost
}): PromptMessage {
  return {
    role: 'assistant',
    content: [],
    meta: {
      compactBoundary: {
        schemaVersion: 1,
        trigger: args.trigger,
        preTokens: Math.max(0, Math.round(args.preTokens)),
        summaryKind: args.summaryKind,
        keepStrategy: args.keepStrategy,
        ...(args.rehydrationPlan ? { rehydrationPlan: args.rehydrationPlan } : {}),
        ...(args.rehydrationCost ? { rehydrationCost: args.rehydrationCost } : {}),
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

export function isCompactionSummaryUserMessage(msg: PromptMessage): boolean {
  if (!msg || msg.role !== 'user') return false
  if (isToolResultMessage(msg)) return false
  const raw = extractLeadingText(msg)
  const text = unwrapSystemReminder(raw)
  return text.startsWith(CONTINUED_SESSION_SUMMARY_PREFIX)
}

export function rebuildHistoryAfterCompaction(args: {
  summary: string
  previousHistory: PromptMessage[]
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
    preTokens: number
    summaryKind: CompactBoundarySummaryKind
    keepStrategy: CompactBoundaryKeepStrategy
    rehydrationPlan?: CompactRehydrationPlan
    rehydrationCost?: CompactRehydrationCost
  }
}): PromptMessage[] {
  const summaryText = buildCompactionSummaryUserText(args.summary, args.rehydration)
  const summaryMsg: PromptMessage = {
    role: 'user',
    content: [{ type: 'text', text: summaryText }] as any,
  }

  const tail = selectTailForCompaction(args.previousHistory, args.keepStrategy)
  return [buildCompactBoundaryMessage(args.boundaryMeta), summaryMsg, ...tail]
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

function findLatestReadWorkingSetTurnPosition(messages: PromptMessage[], userTurnIndices: number[]): number | null {
  if (messages.length === 0 || userTurnIndices.length === 0) return null
  const successfulToolResultIds = collectSuccessfulToolResultIds(messages)
  if (successfulToolResultIds.size === 0) return null

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue

    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_use') continue
      if (block?.name !== 'Read') continue
      if (!successfulToolResultIds.has(String(block?.id ?? ''))) continue
      return findUserTurnPositionAtOrBeforeIndex(userTurnIndices, messageIndex)
    }
  }

  return null
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

function sanitizeReminderText(value: string): string {
  return String(value || '').replace(/<\/?system-reminder>/gi, '[system-reminder]')
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  if (!match) return raw
  return String(match[1] || '').trim()
}
