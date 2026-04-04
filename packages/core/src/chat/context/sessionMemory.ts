import fs from 'node:fs'
import path from 'node:path'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath'
import type { PromptMessage } from '../../prompts'
import type {
  CompactBoundaryKeepStrategy,
  CompactBoundarySummaryKind,
  CompactBoundaryTrigger,
  CompactRehydrationPlan,
} from './compact'
import { estimateCompactRehydrationCost, findLatestCompactBoundary, isCompactionSummaryUserMessage } from './compact'
import { buildPostCompactRehydration } from './postCompactRehydration'

const SESSION_MEMORY_RECENT_FILES_LIMIT = 5
const SESSION_MEMORY_RECENT_PROMPTS_LIMIT = 3
const SESSION_MEMORY_SUMMARY_RECENT_FILES_LIMIT = 3
const SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS = 160
const SESSION_MEMORY_SUMMARY_FILE_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_PLAN_PATH_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_PLAN_EXCERPT_MAX_CHARS = 240
const SESSION_MEMORY_SUMMARY_TODO_MAX_CHARS = 240
const SESSION_MEMORY_SUMMARY_WORKSPACE_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_MEMORY_PATH_MAX_CHARS = 180

export type SessionMemoryDraft = {
  schemaVersion: 1
  durableFacts: {
    workspaceRoot: string
    projectMemoryPath: string
  }
  activeTask: {
    mode: 'normal' | 'acceptEdits' | 'plan'
    recentFiles: string[]
    recentUserPrompts: string[]
    planPath: string | null
    planExcerpt: string | null
    todoSummary: string | null
  }
  currentStrategy: {
    lastCompactTrigger: CompactBoundaryTrigger | null
    summaryKind: CompactBoundarySummaryKind | null
    keepStrategy: CompactBoundaryKeepStrategy | null
    rehydrationPlan: CompactRehydrationPlan | null
  }
}

export type SessionMemoryDraftPatch = {
  durableFacts?: Partial<SessionMemoryDraft['durableFacts']>
  activeTask?: Partial<SessionMemoryDraft['activeTask']>
  currentStrategy?: Partial<SessionMemoryDraft['currentStrategy']>
}

export function buildSessionMemoryDraft(args: {
  cwd: string
  mode: 'normal' | 'acceptEdits' | 'plan'
  planPath: string | null
  previousHistory: PromptMessage[]
  autoMemoryConfigDir?: string
  resolveRealPath?: (cwd: string) => string
}): SessionMemoryDraft {
  const workspaceRoot = resolveCanonicalWorkspaceRoot({
    cwd: args.cwd,
    resolveRealPath: args.resolveRealPath,
  })
  const rehydration = buildPostCompactRehydration({
    cwd: args.cwd,
    mode: args.mode,
    planPath: args.planPath,
    previousHistory: args.previousHistory,
  })
  const latestBoundary = findLatestCompactBoundary(args.previousHistory)
  const projectMemoryPath = path.join(
    buildAutoMemoryDirectoryPath({
      cwd: args.cwd,
      ...(args.autoMemoryConfigDir ? { configDir: args.autoMemoryConfigDir } : {}),
      ...(args.resolveRealPath ? { resolveRealPath: args.resolveRealPath } : {}),
    }),
    'MEMORY.md',
  )

  return {
    schemaVersion: 1,
    durableFacts: {
      workspaceRoot,
      projectMemoryPath,
    },
    activeTask: {
      mode: args.mode,
      recentFiles: rehydration.recentFiles.slice(0, SESSION_MEMORY_RECENT_FILES_LIMIT),
      recentUserPrompts: collectRecentUserPrompts(args.previousHistory, SESSION_MEMORY_RECENT_PROMPTS_LIMIT),
      planPath: rehydration.planPath,
      planExcerpt: rehydration.planExcerpt,
      todoSummary: rehydration.todoSummary,
    },
    currentStrategy: {
      lastCompactTrigger: latestBoundary?.trigger ?? null,
      summaryKind: latestBoundary?.summaryKind ?? null,
      keepStrategy: latestBoundary?.keepStrategy ?? null,
      rehydrationPlan: latestBoundary?.rehydrationPlan ?? null,
    },
  }
}

export function mergeSessionMemoryDraft(base: SessionMemoryDraft, patch: SessionMemoryDraftPatch): SessionMemoryDraft {
  const nextDurableFacts: Partial<SessionMemoryDraft['durableFacts']> = patch.durableFacts ?? {}
  const nextActiveTask: Partial<SessionMemoryDraft['activeTask']> = patch.activeTask ?? {}
  const nextCurrentStrategy: Partial<SessionMemoryDraft['currentStrategy']> = patch.currentStrategy ?? {}

  return {
    schemaVersion: 1,
    durableFacts: {
      workspaceRoot: readNonEmptyString(nextDurableFacts.workspaceRoot) ?? base.durableFacts.workspaceRoot,
      projectMemoryPath: readNonEmptyString(nextDurableFacts.projectMemoryPath) ?? base.durableFacts.projectMemoryPath,
    },
    activeTask: {
      mode: nextActiveTask.mode ?? base.activeTask.mode,
      recentFiles: mergeRecentStrings({
        newer: nextActiveTask.recentFiles,
        older: base.activeTask.recentFiles,
        limit: SESSION_MEMORY_RECENT_FILES_LIMIT,
      }),
      recentUserPrompts: mergeRecentStrings({
        newer: nextActiveTask.recentUserPrompts,
        older: base.activeTask.recentUserPrompts,
        limit: SESSION_MEMORY_RECENT_PROMPTS_LIMIT,
      }),
      planPath: readNullableString(nextActiveTask.planPath, base.activeTask.planPath),
      planExcerpt: readNullableString(nextActiveTask.planExcerpt, base.activeTask.planExcerpt),
      todoSummary: readNullableString(nextActiveTask.todoSummary, base.activeTask.todoSummary),
    },
    currentStrategy: {
      lastCompactTrigger: readNullableValue(nextCurrentStrategy.lastCompactTrigger, base.currentStrategy.lastCompactTrigger),
      summaryKind: readNullableValue(nextCurrentStrategy.summaryKind, base.currentStrategy.summaryKind),
      keepStrategy: readNullableValue(nextCurrentStrategy.keepStrategy, base.currentStrategy.keepStrategy),
      rehydrationPlan: readNullableValue(nextCurrentStrategy.rehydrationPlan, base.currentStrategy.rehydrationPlan),
    },
  }
}

export function buildSessionMemoryCompactionSummary(draft: SessionMemoryDraft): string {
  const lines = ['Session memory recap:']

  const recentPrompts = draft.activeTask.recentUserPrompts
    .map((value) => readNonEmptyString(value))
    .filter((value): value is string => Boolean(value))
  if (recentPrompts.length > 0) {
    lines.push('Recent user requests:')
    for (const prompt of recentPrompts.slice(0, SESSION_MEMORY_RECENT_PROMPTS_LIMIT)) {
      lines.push(`- ${truncateForSummary(prompt, SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS)}`)
    }
  }

  const recentFiles = draft.activeTask.recentFiles
    .map((value) => readNonEmptyString(value))
    .filter((value): value is string => Boolean(value))
  if (recentFiles.length > 0) {
    lines.push('Working-set files:')
    for (const filePath of recentFiles.slice(0, SESSION_MEMORY_SUMMARY_RECENT_FILES_LIMIT)) {
      lines.push(`- ${truncateForSummary(filePath, SESSION_MEMORY_SUMMARY_FILE_MAX_CHARS)}`)
    }
  }

  if (draft.activeTask.mode !== 'normal') {
    lines.push(`Current mode: ${draft.activeTask.mode}`)
  }

  const planPath = readNonEmptyString(draft.activeTask.planPath)
  if (planPath) {
    lines.push(`Plan path: ${truncateForSummary(planPath, SESSION_MEMORY_SUMMARY_PLAN_PATH_MAX_CHARS)}`)
  }

  const planExcerpt = readNonEmptyString(draft.activeTask.planExcerpt)
  if (planExcerpt) {
    lines.push(`Plan excerpt: ${truncateForSummary(planExcerpt, SESSION_MEMORY_SUMMARY_PLAN_EXCERPT_MAX_CHARS)}`)
  }

  const todoSummary = readNonEmptyString(draft.activeTask.todoSummary)
  if (todoSummary) {
    lines.push(`Todo summary: ${truncateForSummary(todoSummary, SESSION_MEMORY_SUMMARY_TODO_MAX_CHARS)}`)
  }

  const strategyLines = formatStrategyLines(draft.currentStrategy)
  if (strategyLines.length > 0) {
    lines.push('Recent compact strategy:')
    lines.push(...strategyLines)
  }

  const workspaceRoot = readNonEmptyString(draft.durableFacts.workspaceRoot)
  if (workspaceRoot) {
    lines.push(`Workspace root: ${truncateForSummary(workspaceRoot, SESSION_MEMORY_SUMMARY_WORKSPACE_MAX_CHARS)}`)
  }

  const projectMemoryPath = readNonEmptyString(draft.durableFacts.projectMemoryPath)
  if (projectMemoryPath) {
    lines.push(`Project memory file: ${truncateForSummary(projectMemoryPath, SESSION_MEMORY_SUMMARY_MEMORY_PATH_MAX_CHARS)}`)
  }

  return lines.join('\n').trim()
}

export function buildSessionMemoryCompactionRehydration(args: {
  draft: SessionMemoryDraft
  fallback?: {
    recentFiles?: string[]
    modeText?: string | null
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  }
}): {
  recentFiles: string[]
  modeText: string | null
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
} {
  const fallbackRecentFiles = Array.isArray(args.fallback?.recentFiles) ? args.fallback.recentFiles : []
  return {
    recentFiles: mergeRecentStrings({
      newer: args.draft.activeTask.recentFiles,
      older: fallbackRecentFiles,
      limit: 3,
    }),
    modeText:
      args.draft.activeTask.mode === 'normal'
        ? args.fallback?.modeText ?? null
        : `Current mode: ${args.draft.activeTask.mode}`,
    planPath: readNonEmptyString(args.draft.activeTask.planPath) ?? args.fallback?.planPath ?? null,
    planExcerpt: readNonEmptyString(args.draft.activeTask.planExcerpt) ?? args.fallback?.planExcerpt ?? null,
    todoSummary: readNonEmptyString(args.draft.activeTask.todoSummary) ?? args.fallback?.todoSummary ?? null,
  }
}

export function estimateSessionMemoryCompactionRehydrationCost(args: {
  draft: SessionMemoryDraft
  fallback?: {
    recentFiles?: string[]
    modeText?: string | null
    planPath?: string | null
    planExcerpt?: string | null
    todoSummary?: string | null
  }
}) {
  return estimateCompactRehydrationCost(
    buildSessionMemoryCompactionRehydration({
      draft: args.draft,
      fallback: args.fallback,
    }),
  )
}

function collectRecentUserPrompts(messages: PromptMessage[], limit: number): string[] {
  const keep = Math.max(0, Math.floor(limit))
  if (keep <= 0) return []

  const prompts: string[] = []
  for (let index = messages.length - 1; index >= 0 && prompts.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (isCompactionSummaryUserMessage(message)) continue
    if (!Array.isArray(message.content)) continue
    if (message.content.some((block: any) => block?.type === 'tool_result')) continue

    const text = extractLeadingText(message)
    if (!text) continue
    prompts.push(text)
  }

  return prompts
}

function formatStrategyLines(strategy: SessionMemoryDraft['currentStrategy']): string[] {
  const out: string[] = []
  if (strategy.lastCompactTrigger) {
    out.push(`- Trigger: ${strategy.lastCompactTrigger}`)
  }
  if (strategy.summaryKind) {
    out.push(`- Summary kind: ${strategy.summaryKind}`)
  }
  if (strategy.keepStrategy) {
    out.push(`- Keep strategy: ${formatKeepStrategy(strategy.keepStrategy)}`)
  }
  if (Array.isArray(strategy.rehydrationPlan?.items) && strategy.rehydrationPlan.items.length > 0) {
    out.push(
      `- Rehydration plan: ${strategy.rehydrationPlan.items
        .map((item) => `${item.kind}(${item.priority}/${item.status})`)
        .join(', ')}`,
    )
  }
  return out
}

function formatKeepStrategy(strategy: CompactBoundaryKeepStrategy): string {
  if (strategy.kind === 'keep_last_turns') {
    return `keep_last_turns(${strategy.keepLastTurns})`
  }
  return `keep_combo(turns=${strategy.keepLastTurns}, min_tokens=${strategy.keepMinTokens}, min_user_turns=${strategy.keepMinUserTurns})`
}

function truncateForSummary(value: string, maxChars: number): string {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  if (!Number.isFinite(maxChars) || maxChars <= 1 || normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 1)}…`
}

function extractLeadingText(message: PromptMessage): string {
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'text' && typeof (block as any).text === 'string') {
      const unwrapped = unwrapSystemReminder(String((block as any).text))
      if (unwrapped) return unwrapped
    }
  }
  return ''
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  const out = match ? String(match[1] || '').trim() : raw
  return out.trim()
}

function mergeRecentStrings(args: {
  newer: string[] | undefined
  older: string[]
  limit: number
}): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  const limit = Math.max(0, Math.floor(args.limit))
  for (const value of [...(args.newer ?? []), ...args.older]) {
    const normalized = readNonEmptyString(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
    if (merged.length >= limit) break
  }
  return merged
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readNullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null
  const normalized = readNonEmptyString(value)
  return normalized ?? fallback
}

function readNullableValue<T>(value: T | null | undefined, fallback: T | null): T | null {
  if (value === undefined) return fallback
  return value
}

function resolveCanonicalWorkspaceRoot(args: {
  cwd: string
  resolveRealPath?: (cwd: string) => string
}): string {
  const resolved = path.resolve(args.cwd)
  try {
    return args.resolveRealPath ? args.resolveRealPath(resolved) : fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}
