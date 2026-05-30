import fs from 'node:fs'
import path from 'node:path'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath'
import { makeSystemReminderBlock } from '../../prompts/authoring'
import type { PromptBlock } from '../../prompts'
import type { PromptMessage } from '../../prompts'
import type {
  CompactBoundaryKeepStrategy,
  CompactBoundarySummaryKind,
  CompactBoundaryTrigger,
  CompactRehydrationPlan,
} from './compact'
import {
  estimateCompactRehydrationCost,
  findLatestCompactBoundary,
  isCompactionSummaryUserMessage,
  sanitizeReminderText,
} from './compact'
import { buildPostCompactRehydration } from './postCompactRehydration'

const SESSION_MEMORY_RECENT_FILES_LIMIT = 5
const SESSION_MEMORY_RECENT_PROMPTS_LIMIT = 3
const SESSION_MEMORY_RECENT_SKILLS_LIMIT = 3
const SESSION_MEMORY_RECENT_SUBAGENT_TYPES_LIMIT = 3
const SESSION_MEMORY_RECENT_DEFERRED_TOOL_NAMES_LIMIT = 3
const SESSION_MEMORY_RECENT_TASK_HINTS_LIMIT = 3
const SESSION_MEMORY_RECENT_TASK_CONTINUITY_HINTS_LIMIT = 3
const SESSION_MEMORY_SUMMARY_RECENT_FILES_LIMIT = 3
const SESSION_MEMORY_SUMMARY_RECENT_SKILLS_LIMIT = 2
const SESSION_MEMORY_SUMMARY_RECENT_SUBAGENT_TYPES_LIMIT = 2
const SESSION_MEMORY_SUMMARY_RECENT_DEFERRED_TOOL_NAMES_LIMIT = 2
const SESSION_MEMORY_SUMMARY_RECENT_TASK_HINTS_LIMIT = 2
const SESSION_MEMORY_SUMMARY_RECENT_TASK_CONTINUITY_HINTS_LIMIT = 2
const SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS = 96
const SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS = 160
const SESSION_MEMORY_SUMMARY_SKILL_MAX_CHARS = 80
const SESSION_MEMORY_SUMMARY_SUBAGENT_TYPE_MAX_CHARS = 80
const SESSION_MEMORY_SUMMARY_FILE_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_PLAN_PATH_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_PLAN_EXCERPT_MAX_CHARS = 240
const SESSION_MEMORY_SUMMARY_TODO_MAX_CHARS = 240
const SESSION_MEMORY_SUMMARY_WORKSPACE_MAX_CHARS = 180
const SESSION_MEMORY_SUMMARY_MEMORY_PATH_MAX_CHARS = 180

export type SessionMemoryTaskContinuityHint = {
  schemaVersion: 1
  subagentType: string
  description: string
  runInBackgroundRequested: boolean
  resumeHint: string | null
  lastObservedStatus: 'completed' | 'background_requested' | 'unknown'
  lastSummary: string | null
  evidenceSource: 'task_tool_use' | 'task_tool_result'
  evidenceConfidence: 'high' | 'medium' | 'low'
}

export type SessionMemoryRestoreDiagnostics = {
  schemaVersion: 1
  status: 'pending'
  source: 'session_memory_sidecar'
  confidence: 'high' | 'medium' | 'low'
}

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
    recentSkills: string[]
    recentSubagentTypes: string[]
    recentDeferredToolNames: string[]
    recentTaskHints: string[]
    recentTaskContinuityHints: SessionMemoryTaskContinuityHint[]
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

export type SessionMemoryRestoreSummary = {
  schemaVersion: 1
  mode: SessionMemoryDraft['activeTask']['mode']
  recentFiles: string[]
  recentUserPrompts: string[]
  recentSkills: string[]
  recentSubagentTypes: string[]
  recentDeferredToolNames: string[]
  recentTaskHints: string[]
  recentTaskContinuityHints: SessionMemoryTaskContinuityHint[]
  restoreDiagnostics: SessionMemoryRestoreDiagnostics
  planPath: string | null
  planExcerpt: string | null
  todoSummary: string | null
}

export function extractSessionMemoryRestoreState(value: unknown): {
  mode: SessionMemoryDraft['activeTask']['mode']
  planPath: string | null
} | null {
  if (!isRecord(value)) return null
  const activeTask = value.activeTask
  if (!isRecord(activeTask)) return null

  const mode = activeTask.mode
  if (mode !== 'normal' && mode !== 'acceptEdits' && mode !== 'plan') return null

  return {
    mode,
    planPath: readNullableString(activeTask.planPath, null),
  }
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
      recentSkills: collectRecentSuccessfulToolInputStrings(args.previousHistory, {
        toolName: 'Skill',
        inputKey: 'skill',
        limit: SESSION_MEMORY_RECENT_SKILLS_LIMIT,
      }),
      recentSubagentTypes: collectRecentSuccessfulToolInputStrings(args.previousHistory, {
        toolName: 'Task',
        inputKey: 'subagent_type',
        limit: SESSION_MEMORY_RECENT_SUBAGENT_TYPES_LIMIT,
      }),
      recentDeferredToolNames: collectRecentDeferredToolNames(
        args.previousHistory,
        SESSION_MEMORY_RECENT_DEFERRED_TOOL_NAMES_LIMIT,
      ),
      recentTaskHints: collectRecentTaskHints(args.previousHistory, SESSION_MEMORY_RECENT_TASK_HINTS_LIMIT),
      recentTaskContinuityHints: collectRecentTaskContinuityHints(
        args.previousHistory,
        SESSION_MEMORY_RECENT_TASK_CONTINUITY_HINTS_LIMIT,
      ),
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
      recentSkills: mergeRecentStrings({
        newer: nextActiveTask.recentSkills,
        older: base.activeTask.recentSkills,
        limit: SESSION_MEMORY_RECENT_SKILLS_LIMIT,
      }),
      recentSubagentTypes: mergeRecentStrings({
        newer: nextActiveTask.recentSubagentTypes,
        older: base.activeTask.recentSubagentTypes,
        limit: SESSION_MEMORY_RECENT_SUBAGENT_TYPES_LIMIT,
      }),
      recentDeferredToolNames: mergeRecentStrings({
        newer: nextActiveTask.recentDeferredToolNames,
        older: base.activeTask.recentDeferredToolNames,
        limit: SESSION_MEMORY_RECENT_DEFERRED_TOOL_NAMES_LIMIT,
      }),
      recentTaskHints: mergeRecentStrings({
        newer: nextActiveTask.recentTaskHints,
        older: base.activeTask.recentTaskHints,
        limit: SESSION_MEMORY_RECENT_TASK_HINTS_LIMIT,
      }),
      recentTaskContinuityHints: mergeRecentTaskContinuityHints({
        newer: nextActiveTask.recentTaskContinuityHints,
        older: base.activeTask.recentTaskContinuityHints,
        limit: SESSION_MEMORY_RECENT_TASK_CONTINUITY_HINTS_LIMIT,
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

  const recentPrompts = normalizeStringList(draft.activeTask.recentUserPrompts)
  if (recentPrompts.length > 0) {
    lines.push('Recent user requests:')
    for (const prompt of recentPrompts.slice(0, SESSION_MEMORY_RECENT_PROMPTS_LIMIT)) {
      lines.push(`- ${truncateForSummary(prompt, SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS)}`)
    }
  }

  const recentFiles = normalizeStringList(draft.activeTask.recentFiles)
  if (recentFiles.length > 0) {
    lines.push('Working-set files:')
    for (const filePath of recentFiles.slice(0, SESSION_MEMORY_SUMMARY_RECENT_FILES_LIMIT)) {
      lines.push(`- ${truncateForSummary(filePath, SESSION_MEMORY_SUMMARY_FILE_MAX_CHARS)}`)
    }
  }

  const recentSkills = normalizeStringList(draft.activeTask.recentSkills)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_SKILLS_LIMIT)
  if (recentSkills.length > 0) {
    lines.push(`Recent skills: ${recentSkills.map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_SKILL_MAX_CHARS)).join(', ')}`)
  }

  const recentSubagentTypes = normalizeStringList(draft.activeTask.recentSubagentTypes)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_SUBAGENT_TYPES_LIMIT)
  if (recentSubagentTypes.length > 0) {
    lines.push(
      `Recent subagent types: ${recentSubagentTypes
        .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_SUBAGENT_TYPE_MAX_CHARS))
        .join(', ')}`,
    )
  }

  const recentDeferredToolNames = normalizeStringList(draft.activeTask.recentDeferredToolNames)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_DEFERRED_TOOL_NAMES_LIMIT)
  if (recentDeferredToolNames.length > 0) {
    lines.push(`Recent deferred tool hints from prior ToolSearch calls (not currently loaded): ${recentDeferredToolNames.join(', ')}`)
  }

  const recentTaskHints = normalizeStringList(draft.activeTask.recentTaskHints)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_TASK_HINTS_LIMIT)
  if (recentTaskHints.length > 0) {
    lines.push('Recent delegated task hints:')
    for (const hint of recentTaskHints) lines.push(`- ${truncateForSummary(hint, SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS)}`)
  }

  const recentTaskContinuityHints = normalizeTaskContinuityHints(draft.activeTask.recentTaskContinuityHints)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_TASK_CONTINUITY_HINTS_LIMIT)
  if (recentTaskContinuityHints.length > 0) {
    lines.push('Structured delegated task continuity hints (best-effort; tasks are not resumed automatically):')
    for (const hint of recentTaskContinuityHints) {
      const parts = [`${hint.subagentType}: ${hint.description}`]
      if (hint.runInBackgroundRequested) parts.push('(background requested; not resumed)')
      if (hint.resumeHint) parts.push(`(prior resume hint ${hint.resumeHint})`)
      if (hint.lastObservedStatus !== 'unknown') parts.push(`(${hint.lastObservedStatus})`)
      lines.push(`- ${truncateForSummary(parts.join(' '), SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS)}`)
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

export function buildSessionMemoryRestoreReminderBlock(draft: SessionMemoryDraft): PromptBlock | null {
  const summary = buildSessionMemoryCompactionSummary(draft).trim()
  if (!summary) return null
  const body = sanitizeReminderText(summary).replace(
    /^Session memory recap:/,
    'Restored session memory for the next turn only:',
  )
  return makeSystemReminderBlock(body)
}

export function buildSessionMemoryRestoreSummary(draft: SessionMemoryDraft): SessionMemoryRestoreSummary {
  const recentFiles = normalizeStringList(draft.activeTask.recentFiles)
    .slice(0, SESSION_MEMORY_SUMMARY_RECENT_FILES_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_FILE_MAX_CHARS))

  const recentUserPrompts = normalizeStringList(draft.activeTask.recentUserPrompts)
    .slice(0, SESSION_MEMORY_RECENT_PROMPTS_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS))

  const recentSkills = normalizeStringList(draft.activeTask.recentSkills)
    .slice(0, SESSION_MEMORY_RECENT_SKILLS_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_SKILL_MAX_CHARS))

  const recentSubagentTypes = normalizeStringList(draft.activeTask.recentSubagentTypes)
    .slice(0, SESSION_MEMORY_RECENT_SUBAGENT_TYPES_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_SUBAGENT_TYPE_MAX_CHARS))

  const recentDeferredToolNames = normalizeStringList(draft.activeTask.recentDeferredToolNames)
    .slice(0, SESSION_MEMORY_RECENT_DEFERRED_TOOL_NAMES_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_SKILL_MAX_CHARS))

  const recentTaskHints = normalizeStringList(draft.activeTask.recentTaskHints)
    .slice(0, SESSION_MEMORY_RECENT_TASK_HINTS_LIMIT)
    .map((value) => truncateForSummary(value, SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS))
  const recentTaskContinuityHints = normalizeTaskContinuityHints(draft.activeTask.recentTaskContinuityHints)
    .slice(0, SESSION_MEMORY_RECENT_TASK_CONTINUITY_HINTS_LIMIT)
    .map(truncateTaskContinuityHintForSummary)

  return {
    schemaVersion: 1,
    mode: draft.activeTask.mode,
    recentFiles,
    recentUserPrompts,
    recentSkills,
    recentSubagentTypes,
    recentDeferredToolNames,
    recentTaskHints,
    recentTaskContinuityHints,
    restoreDiagnostics: {
      schemaVersion: 1,
      status: 'pending',
      source: 'session_memory_sidecar',
      confidence: 'high',
    },
    planPath: truncateNullableSummaryField(draft.activeTask.planPath, SESSION_MEMORY_SUMMARY_PLAN_PATH_MAX_CHARS),
    planExcerpt: truncateNullableSummaryField(
      draft.activeTask.planExcerpt,
      SESSION_MEMORY_SUMMARY_PLAN_EXCERPT_MAX_CHARS,
    ),
    todoSummary: truncateNullableSummaryField(draft.activeTask.todoSummary, SESSION_MEMORY_SUMMARY_TODO_MAX_CHARS),
  }
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

function collectSuccessfulToolResults(messages: PromptMessage[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const message of messages) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type !== 'tool_result') continue
      if (block?.is_error === true) continue
      if (typeof block?.tool_use_id === 'string' && block.tool_use_id.length > 0) {
        out.set(block.tool_use_id, block.content)
      }
    }
  }
  return out
}

function collectRecentSuccessfulToolInputStrings(
  messages: PromptMessage[],
  args: {
    toolName: string
    inputKey: string
    limit: number
  },
): string[] {
  const keep = Math.max(0, Math.floor(args.limit))
  if (keep <= 0) return []

  const successfulToolResults = collectSuccessfulToolResults(messages)
  if (successfulToolResults.size === 0) return []

  const values: string[] = []
  const seen = new Set<string>()
  for (let index = messages.length - 1; index >= 0 && values.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0 && values.length < keep; blockIndex -= 1) {
      const block = (message.content as any[])[blockIndex]
      if (block?.type !== 'tool_use' || block?.name !== args.toolName) continue
      if (typeof block?.id !== 'string' || !successfulToolResults.has(block.id)) continue
      const inputValue =
        block?.input && typeof block.input === 'object'
          ? readNonEmptyString((block.input as Record<string, unknown>)[args.inputKey])
          : null
      if (!inputValue || seen.has(inputValue)) continue
      seen.add(inputValue)
      values.push(inputValue)
    }
  }

  return values
}

function collectRecentDeferredToolNames(messages: PromptMessage[], limit: number): string[] {
  const keep = Math.max(0, Math.floor(limit))
  if (keep <= 0) return []

  const successfulToolResults = collectSuccessfulToolResults(messages)
  if (successfulToolResults.size === 0) return []

  const values: string[] = []
  const seen = new Set<string>()
  for (let index = messages.length - 1; index >= 0 && values.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0 && values.length < keep; blockIndex -= 1) {
      const block = (message.content as any[])[blockIndex]
      if (block?.type !== 'tool_use' || block?.name !== 'ToolSearch') continue
      if (typeof block?.id !== 'string' || !successfulToolResults.has(block.id)) continue
      for (const name of extractLoadedDeferredToolNames(successfulToolResults.get(block.id))) {
        if (seen.has(name)) continue
        seen.add(name)
        values.push(name)
        if (values.length >= keep) break
      }
    }
  }

  return values
}

function collectRecentTaskHints(messages: PromptMessage[], limit: number): string[] {
  const keep = Math.max(0, Math.floor(limit))
  if (keep <= 0) return []

  const successfulToolResults = collectSuccessfulToolResults(messages)
  if (successfulToolResults.size === 0) return []

  const values: string[] = []
  const seen = new Set<string>()
  for (let index = messages.length - 1; index >= 0 && values.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0 && values.length < keep; blockIndex -= 1) {
      const block = (message.content as any[])[blockIndex]
      if (block?.type !== 'tool_use' || block?.name !== 'Task') continue
      if (typeof block?.id !== 'string' || !successfulToolResults.has(block.id)) continue
      const input = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
      const subagentType = readNonEmptyString(input.subagent_type)
      const description = readNonEmptyString(input.description)
      if (!subagentType || !description) continue
      const parts = [`${subagentType}: ${description}`]
      if (input.run_in_background === true) parts.push('(background)')
      const resume = readNonEmptyString(input.resume)
      if (resume) parts.push(`(resume ${resume})`)
      const hint = parts.join(' ')
      if (seen.has(hint)) continue
      seen.add(hint)
      values.push(hint)
    }
  }

  return values
}

function collectRecentTaskContinuityHints(messages: PromptMessage[], limit: number): SessionMemoryTaskContinuityHint[] {
  const keep = Math.max(0, Math.floor(limit))
  if (keep <= 0) return []

  const successfulToolResults = collectSuccessfulToolResults(messages)
  if (successfulToolResults.size === 0) return []

  const values: SessionMemoryTaskContinuityHint[] = []
  const seen = new Set<string>()
  for (let index = messages.length - 1; index >= 0 && values.length < keep; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIndex = message.content.length - 1; blockIndex >= 0 && values.length < keep; blockIndex -= 1) {
      const block = (message.content as any[])[blockIndex]
      if (block?.type !== 'tool_use' || block?.name !== 'Task') continue
      if (typeof block?.id !== 'string' || !successfulToolResults.has(block.id)) continue
      const input = block.input && typeof block.input === 'object' ? block.input as Record<string, unknown> : {}
      const subagentType = readNonEmptyString(input.subagent_type)
      const description = readNonEmptyString(input.description)
      if (!subagentType || !description) continue
      const runInBackgroundRequested = input.run_in_background === true
      const resumeHint = readNonEmptyString(input.resume)
      const lastSummary = truncateNullableSummaryField(
        extractToolResultText(successfulToolResults.get(block.id)),
        SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS,
      )
      const hint: SessionMemoryTaskContinuityHint = {
        schemaVersion: 1,
        subagentType,
        description,
        runInBackgroundRequested,
        resumeHint,
        lastObservedStatus: runInBackgroundRequested ? 'background_requested' : 'completed',
        lastSummary,
        evidenceSource: lastSummary ? 'task_tool_result' : 'task_tool_use',
        evidenceConfidence: 'high',
      }
      const key = taskContinuityHintKey(hint)
      if (seen.has(key)) continue
      seen.add(key)
      values.push(hint)
    }
  }

  return values
}

function extractLoadedDeferredToolNames(content: unknown): string[] {
  const structuredNames = extractToolReferenceNames(content)
  if (structuredNames.length > 0) return structuredNames

  const text = extractToolResultText(content)
  if (!text) return []

  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inLoadedSection = false
  let inMatchedSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^currently loaded tools:\s*$/i.test(trimmed)) {
      inLoadedSection = true
      inMatchedSection = false
      continue
    }
    if (/^matched tools:\s*$/i.test(trimmed)) {
      inMatchedSection = true
      inLoadedSection = false
      continue
    }
    if (/^[A-Za-z].*:\s*$/.test(trimmed)) {
      inLoadedSection = false
      inMatchedSection = false
      continue
    }
    if (!inLoadedSection && !inMatchedSection) continue

    const match = /^-\s+(.+)$/.exec(trimmed)
    const name = readNonEmptyString(match?.[1])
    if (name) out.push(name)
  }

  return out
}

function extractToolReferenceNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const block of content as any[]) {
    if (block?.type !== 'tool_reference') continue
    const name = readNonEmptyString(block.tool_name) ?? readNonEmptyString(block.name)
    if (name) out.push(name)
  }
  return out
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content as any[]) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function normalizeTaskContinuityHints(value: unknown): SessionMemoryTaskContinuityHint[] {
  if (!Array.isArray(value)) return []
  const out: SessionMemoryTaskContinuityHint[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const hint = normalizeTaskContinuityHint(item)
    if (!hint) continue
    const key = taskContinuityHintKey(hint)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hint)
  }
  return out
}

function normalizeTaskContinuityHint(value: unknown): SessionMemoryTaskContinuityHint | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const subagentType = readNonEmptyString(value.subagentType)
  const description = readNonEmptyString(value.description)
  if (!subagentType || !description) return null
  const lastObservedStatus =
    value.lastObservedStatus === 'completed' ||
    value.lastObservedStatus === 'background_requested' ||
    value.lastObservedStatus === 'unknown'
      ? value.lastObservedStatus
      : 'unknown'
  const evidenceSource =
    value.evidenceSource === 'task_tool_result' || value.evidenceSource === 'task_tool_use'
      ? value.evidenceSource
      : 'task_tool_use'
  const evidenceConfidence =
    value.evidenceConfidence === 'high' || value.evidenceConfidence === 'medium' || value.evidenceConfidence === 'low'
      ? value.evidenceConfidence
      : 'medium'
  return {
    schemaVersion: 1,
    subagentType,
    description,
    runInBackgroundRequested: value.runInBackgroundRequested === true,
    resumeHint: readNullableString(value.resumeHint, null),
    lastObservedStatus,
    lastSummary: readNullableString(value.lastSummary, null),
    evidenceSource,
    evidenceConfidence,
  }
}

function mergeRecentTaskContinuityHints(args: {
  newer?: unknown
  older?: unknown
  limit: number
}): SessionMemoryTaskContinuityHint[] {
  const keep = Math.max(0, Math.floor(args.limit))
  if (keep <= 0) return []
  const out: SessionMemoryTaskContinuityHint[] = []
  const seen = new Set<string>()
  for (const hint of [...normalizeTaskContinuityHints(args.newer), ...normalizeTaskContinuityHints(args.older)]) {
    const key = taskContinuityHintKey(hint)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hint)
    if (out.length >= keep) break
  }
  return out
}

function truncateTaskContinuityHintForSummary(hint: SessionMemoryTaskContinuityHint): SessionMemoryTaskContinuityHint {
  return {
    ...hint,
    subagentType: truncateForSummary(hint.subagentType, SESSION_MEMORY_SUMMARY_SUBAGENT_TYPE_MAX_CHARS),
    description: truncateForSummary(hint.description, SESSION_MEMORY_SUMMARY_RECENT_PROMPT_MAX_CHARS),
    resumeHint: truncateNullableSummaryField(hint.resumeHint, SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS),
    lastSummary: truncateNullableSummaryField(hint.lastSummary, SESSION_MEMORY_SUMMARY_TASK_HINT_MAX_CHARS),
  }
}

function taskContinuityHintKey(hint: SessionMemoryTaskContinuityHint): string {
  return [
    hint.subagentType,
    hint.description,
    hint.runInBackgroundRequested ? 'background' : 'foreground',
    hint.resumeHint ?? '',
  ].join('\u0000')
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

function truncateNullableSummaryField(value: unknown, maxChars: number): string | null {
  const normalized = readNonEmptyString(value)
  return normalized ? truncateForSummary(normalized, maxChars) : null
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => readNonEmptyString(entry)).filter((entry): entry is string => Boolean(entry))
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
