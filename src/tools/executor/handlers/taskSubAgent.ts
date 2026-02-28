import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../index'
import type { ManagedTaskResult, TaskManager } from '../../runtime/taskManager'
import { formatToolCallParts, formatToolResult } from '../../../utils/toolFormatting'
import type { StreamEvent, TokenUsage } from '../../../streaming/types'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { loadRuntimeConfig } from '../../../env/config.js'
import { parseModelTier, resolveModelForTier, type ModelTier } from '../../../env/modelTier.js'
import { getKnownContextWindowTokens } from '../../../chat/context/modelWindow.js'

type NestedToolEntry = {
  id: string
  name: string
  input: Record<string, any>
  status: 'running' | 'completed' | 'error'
  header: string
  summary?: string
  rawResult?: string
}

const MAX_VISIBLE_TOOL_USES = 2
const MAX_LINE_CHARS = 80
const MAX_ENTRIES = 200
const MAX_LISTED_PATHS = 25
const MAX_RESPONSE_CHARS = 10_000
const TASK_MODEL_USAGE_ERROR = 'Error: model must be one of: sonnet, opus, haiku.'

export function createTaskSubAgentToolHandler(deps: {
  registry: SubAgentRegistry
  runner: SubAgentRunner
  taskManager: TaskManager
}): ToolHandler {
  return {
    canHandle(name: string): boolean {
      return name === 'Task'
    },

    async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
      const input = requirePlainObject(call.input || {}, 'Task.input')
      assertNoExtraKeys(input, ['description', 'prompt', 'subagent_type', 'model', 'resume', 'run_in_background'], 'Task.input')

      const description = (input as any).description
      const subagentType = (input as any).subagent_type
      const prompt = (input as any).prompt
      const model = (input as any).model
      const resume = (input as any).resume
      const runInBackground = Boolean((input as any).run_in_background)

      if (
        typeof description !== 'string' ||
        !description.trim() ||
        typeof subagentType !== 'string' ||
        typeof prompt !== 'string'
      ) {
        return {
          tool_use_id: call.id,
          content: 'Error: Missing required fields description, subagent_type, or prompt.',
          is_error: true,
        }
      }

      const { tier: explicitModelTier, error: explicitModelError } = parseExplicitModelTier(model)
      if (explicitModelError) {
        return { tool_use_id: call.id, content: explicitModelError, is_error: true }
      }

      const agent = deps.registry.get(subagentType)
      if (!agent) {
        return {
          tool_use_id: call.id,
          content: `Error: Agent type '${subagentType}' not found.`,
          is_error: true,
        }
      }

      const currentCfg = await loadRuntimeConfig(process.env, ctx.cwd ?? process.cwd())
      const agentModelTier = parseModelTier(agent.model)
      const selectedModelTier =
        explicitModelTier ??
        (agentModelTier === null ? undefined : agentModelTier) ??
        parseModelTier(currentCfg.llm.defaultTier) ??
        'sonnet'
      const resolvedModel = resolveModelForTier({
        tier: selectedModelTier,
        env: process.env,
        configuredModel: currentCfg.llm.configuredModel,
        configuredTierModels: currentCfg.llm.tierModels,
      })
      const contextWindowTokens =
        currentCfg.llm.contextWindowTokens ??
        getKnownContextWindowTokens({ provider: currentCfg.llm.provider, model: resolvedModel })
      const promptBudget = contextWindowTokens
        ? {
            contextWindowTokens,
            effectiveContextWindowPercent: currentCfg.context.effectiveContextWindowPercent,
            autoCompactLimitPercent: currentCfg.context.autoCompactTokenLimitPercent,
            baselineTokens: currentCfg.context.baselineTokens,
          }
        : null

      const run = async (
        signal?: AbortSignal,
        opts?: { emitUi?: boolean; updateTask?: (result: ManagedTaskResult) => void; agentId?: string },
      ): Promise<{ agent_id: string; summary: string; json: string; is_error?: boolean }> => {
        const startedAtMs = Date.now()
        const entries: NestedToolEntry[] = []
        let toolUses = 0
        const usageTotal: TokenUsage = {}

        const scheduleTaskUpdate = opts?.updateTask
          ? createThrottledUpdater(() => {
              opts.updateTask?.({ content: renderNestedLines(entries, toolUses).join('\n') })
            })
          : null

        const emitProgress = (): void => {
          scheduleTaskUpdate?.()
          if (!opts?.emitUi) return
          if (!ctx.onEvent || signal?.aborted) return
          ctx.onEvent({
            type: 'tool_update',
            id: call.id,
            middleLines: renderNestedLines(entries, toolUses),
            transcriptLines: renderTaskTranscriptLines({
              taskPrompt: prompt,
              entries,
              responseText: '',
            }),
            toolUses,
            usage: usageTotal,
            nestedTools: entries.map((e) => ({
              id: e.id,
              name: e.name,
              input: e.input,
              status: e.status,
              summary: e.summary,
            })),
          })
        }

        const onSubEvent = (ev: StreamEvent): void => {
          if (!ev || typeof ev !== 'object') return

          if (ev.type === 'usage') {
            addUsage(usageTotal, ev.usage)
            emitProgress()
            return
          }

          if (ev.type === 'tool_start') {
            toolUses++
            const header = formatNestedHeader(ev.name, {})
            entries.push({
              id: ev.id,
              name: ev.name,
              input: {},
              status: 'running',
              header,
            })
            trimEntries(entries)
            emitProgress()
            return
          }

          if (ev.type === 'tool_input') {
            const idx = entries.findIndex((e) => e.id === ev.id)
            if (idx >= 0) {
              const input = (ev.input && typeof ev.input === 'object' ? (ev.input as any) : {}) as Record<
                string,
                any
              >
              const compact = compactInputForNestedUi(entries[idx]!.name, input)
              entries[idx] = {
                ...entries[idx]!,
                input: compact,
                header: formatNestedHeader(entries[idx]!.name, compact),
              }
              emitProgress()
            }
            return
          }

          if (ev.type === 'tool_end') {
            const idx = entries.findIndex((e) => e.id === ev.id)
            if (idx >= 0) {
              const raw = ev.result?.content ?? ''
              const display =
                ev.result?.is_error && typeof raw === 'string' && raw.startsWith('Error: ')
                  ? raw.slice('Error: '.length)
                  : raw

              const formatted = formatToolResult(entries[idx]!.name, String(display || ''), Boolean(ev.result?.is_error))

              entries[idx] = {
                ...entries[idx]!,
                status: ev.result?.is_error ? 'error' : 'completed',
                summary: formatted.summary,
                rawResult: String(display || ''),
              }
              emitProgress()
            }
          }

          if (ev.type === 'tool_update') {
            // Nested tools emit tool_update when they are about to block on user input.
            // Propagate so the UI can render the approval prompt and the REPL can
            // enter prompt mode (hide the input bar).
            emitProgress()
          }
        }

        const parentMode = ctx.getReplMode?.() ?? ctx.replMode
        const subMode = parentMode === 'acceptEdits' ? 'acceptEdits' : 'normal'

        const result = await deps.runner.run({
          agent,
          task: prompt,
          model: resolvedModel,
          promptBudget,
          resume: typeof resume === 'string' && resume.trim() ? resume.trim() : undefined,
          agentId: opts?.agentId,
          replMode: subMode,
          interactive: opts?.emitUi !== false,
          signal,
          onEvent: onSubEvent,
        })
        const summary = result.summary || ''
        const response = result.response || ''
        const limited = summary.length > 500 ? summary.slice(0, 500) + '…' : summary

        scheduleTaskUpdate?.flush()

        const durationMs = Date.now() - startedAtMs
        const transcriptLines = renderTaskTranscriptLines({
          taskPrompt: prompt,
          entries,
          responseText: response,
          doneLine: renderDoneLine({
            toolUses,
            usage: usageTotal,
            durationMs,
            isError: !result.success,
          }),
        })

        const payload: Record<string, any> = {
          agent_id: result.agentId,
          status: result.success ? 'completed' : 'error',
          summary: limited || (result.success ? '(no output)' : ''),
          ...(response.trim() ? { response: response.trim() } : {}),
          transcript: transcriptLines,
          ...(result.artifacts && result.artifacts.length > 0 ? { artifacts: result.artifacts } : {}),
          ...(!result.success && result.error ? { error: result.error } : {}),
          ...(toolUses ? { tool_uses: toolUses } : {}),
          ...(Object.keys(usageTotal).length > 0 ? { usage: usageTotal } : {}),
        }

        return {
          agent_id: result.agentId,
          summary:
            limited ||
            (result.success ? '(no output)' : `Error: ${result.error || 'Agent failed'}`),
          json: JSON.stringify(payload, null, 2),
          is_error: !result.success,
        }
      }

      if (runInBackground) {
        const label = `Task(${String(subagentType)}): ${description.trim()}`
        const taskId = deps.taskManager.create({
          kind: 'agent',
          label,
          run: ({ id, signal, updateResult }) =>
            run(signal, {
              emitUi: false,
              updateTask: updateResult,
              agentId: typeof resume === 'string' && resume.trim() ? undefined : id,
            }).then(({ summary, is_error }) => ({ content: summary, ...(is_error ? { is_error } : {}) })),
        })

        const agentId =
          typeof resume === 'string' && resume.trim()
            ? resume.trim()
            : taskId
        return {
          tool_use_id: call.id,
          content: JSON.stringify({ task_id: taskId, agent_id: agentId, status: 'running' }, null, 2),
        }
      }

      const result = await run(ctx.signal, { emitUi: true })
      return {
        tool_use_id: call.id,
        content: result.json,
        ...(result.is_error ? { is_error: true } : {}),
      }
    },
  }
}

function parseExplicitModelTier(rawModel: unknown): { tier?: ModelTier; error?: string } {
  if (rawModel === undefined || rawModel === null || rawModel === '') return {}
  const raw = String(rawModel).trim().toLowerCase()
  if (!raw) return { error: TASK_MODEL_USAGE_ERROR }
  const parsed = parseModelTier(raw)
  if (!parsed) return { error: `Error: Unsupported model: ${raw}` }
  return { tier: parsed }
}

function formatNestedHeader(name: string, input: Record<string, any>): string {
  const compactInput = compactInputForHeader(name, input)
  const { toolName, params } = formatToolCallParts(name, compactInput, { preferRelativePaths: true })
  const normalized = toSingleLine(`${toolName}(${params})`).trim()
  return truncateLine(normalized, MAX_LINE_CHARS)
}

function renderNestedLines(entries: NestedToolEntry[], toolUses: number): string[] {
  const visibleEntries = entries.slice(-MAX_VISIBLE_TOOL_USES)
  const hiddenToolUses = Math.max(0, toolUses - visibleEntries.length)

  const lines: string[] = []
  for (let i = 0; i < visibleEntries.length; i++) {
    const e = visibleEntries[i]!
    const branch = i === visibleEntries.length - 1 ? '└' : '├'
    const text =
      e.status !== 'running' && e.summary
        ? truncateLine(toSingleLine(e.summary).trim(), MAX_LINE_CHARS)
        : truncateLine(toSingleLine(e.header).trim(), MAX_LINE_CHARS)
    lines.push(`${branch} ${text}`)
  }

  if (hiddenToolUses > 0) {
    lines.push(`+${hiddenToolUses} more tool uses (ctrl+o to expand)`)
  }

  return lines
}

function trimEntries(entries: NestedToolEntry[]): void {
  if (entries.length <= MAX_ENTRIES) return
  entries.splice(0, entries.length - MAX_ENTRIES)
}

function addUsage(total: TokenUsage, snapshot: TokenUsage): void {
  if (typeof snapshot.input_tokens === 'number') total.input_tokens = (total.input_tokens ?? 0) + snapshot.input_tokens
  if (typeof snapshot.output_tokens === 'number') total.output_tokens = (total.output_tokens ?? 0) + snapshot.output_tokens
  if (typeof snapshot.cache_read_input_tokens === 'number') {
    total.cache_read_input_tokens = (total.cache_read_input_tokens ?? 0) + snapshot.cache_read_input_tokens
  }
  if (typeof snapshot.cache_creation_input_tokens === 'number') {
    total.cache_creation_input_tokens =
      (total.cache_creation_input_tokens ?? 0) + snapshot.cache_creation_input_tokens
  }
}

function compactInputForHeader(name: string, input: Record<string, any>): Record<string, any> {
  const n = String(name || '')
  if (n === 'Read' || n === 'Write' || n === 'Edit' || n === 'NotebookEdit') {
    const raw = (input.file_path ?? input.path ?? input.notebook_path) as unknown
    if (typeof raw === 'string' && raw.trim()) {
      const base = basename(raw.trim())
      const next: Record<string, any> = { ...input }
      if (typeof input.file_path === 'string') next.file_path = base
      if (typeof input.path === 'string') next.path = base
      if (typeof input.notebook_path === 'string') next.notebook_path = base
      return next
    }
  }
  return input
}

function compactInputForNestedUi(name: string, input: Record<string, any>): Record<string, any> {
  const n = String(name || '')

  if (n === 'Write' || n === 'Edit') {
    const next: Record<string, any> = {}
    if (typeof input.file_path === 'string') next.file_path = input.file_path
    if (typeof input.path === 'string') next.path = input.path
    return next
  }

  if (n === 'NotebookEdit') {
    const next: Record<string, any> = {}
    if (typeof input.notebook_path === 'string') next.notebook_path = input.notebook_path
    if (typeof input.cell_id === 'string') next.cell_id = input.cell_id
    if (typeof input.cell_type === 'string') next.cell_type = input.cell_type
    if (typeof input.edit_mode === 'string') next.edit_mode = input.edit_mode
    return next
  }

  if (n === 'Bash') {
    const next: Record<string, any> = {}
    if (typeof input.command === 'string') next.command = input.command
    if (typeof input.cwd === 'string') next.cwd = input.cwd
    if (typeof input.timeout === 'number') next.timeout = input.timeout
    if (typeof input.run_in_background === 'boolean') next.run_in_background = input.run_in_background
    if (typeof input.description === 'string') next.description = input.description
    return next
  }

  if (n === 'AskUserQuestion') {
    const next: Record<string, any> = {}
    if (Array.isArray(input.questions)) next.questions = input.questions
    return next
  }

  if (n === 'Task') {
    const next: Record<string, any> = {}
    if (typeof input.subagent_type === 'string') next.subagent_type = input.subagent_type
    if (typeof input.description === 'string') next.description = input.description
    if (typeof input.prompt === 'string') next.prompt = input.prompt
    if (typeof input.run_in_background === 'boolean') next.run_in_background = input.run_in_background
    return next
  }

  return input
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : p
}

function toSingleLine(s: string): string {
  return (s || '').replace(/\s+/g, ' ')
}

function truncateLine(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  return s.slice(0, Math.max(0, maxChars - 1)) + '…'
}

function createThrottledUpdater(fn: () => void): (() => void) & { flush: () => void } {
  let pending = false
  let timer: NodeJS.Timeout | null = null

  const tick = () => {
    pending = false
    timer = null
    fn()
  }

  const schedule = () => {
    if (pending) return
    pending = true
    timer = setTimeout(tick, 100)
  }

  schedule.flush = () => {
    if (timer) clearTimeout(timer)
    pending = false
    timer = null
    fn()
  }

  return schedule
}

function renderTaskTranscriptLines(args: {
  taskPrompt: string
  entries: NestedToolEntry[]
  responseText: string
  doneLine?: string
}): string[] {
  const lines: string[] = []

  const promptText = String(args.taskPrompt || '').trimEnd()
  if (promptText) {
    lines.push('Prompt:')
    const promptLines = splitLines(promptText)
    for (const l of promptLines) lines.push(`     ${l}`)
    lines.push(`> ${promptLines[0] || ''}`.trimEnd())
    for (const l of promptLines.slice(1)) lines.push(`  ${l}`)
    lines.push('')
  }

  for (const entry of args.entries) {
    const header = toSingleLine(entry.header).trim()
    if (!header) continue

    lines.push(header)

    if (entry.status === 'running') continue

    const block = renderNestedToolResultLines(entry)
    if (block.length) {
      lines.push('')
      for (const l of block) lines.push(l)
      lines.push('')
    }
  }

  const responseText = String(args.responseText || '').trimEnd()
  if (responseText) {
    lines.push('Response:')
    const { preview, truncated } = truncateTextByChars(responseText, MAX_RESPONSE_CHARS)
    for (const l of splitLines(preview)) lines.push(`     ${l}`)
    if (truncated) lines.push(`     …${truncated} chars truncated…`)
    lines.push('')
  }

  if (args.doneLine) lines.push(args.doneLine)

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function renderNestedToolResultLines(entry: NestedToolEntry): string[] {
  const raw = typeof entry.rawResult === 'string' ? entry.rawResult : ''
  const isError = entry.status === 'error'
  const formatted = formatToolResult(entry.name, raw, isError)

  const out: string[] = []
  if (formatted.summary) out.push(formatted.summary)

  const rawLines = splitLines(raw).map((l) => l.trimEnd()).filter((l) => l.length > 0)

  const tool = String(entry.name || '').trim()
  const isSearchLike = tool === 'Glob' || tool === 'Search' || tool === 'Grep'
  if (isSearchLike && rawLines.length > 0) {
    // Claude Code shows file lists for Search/Glob; keep it bounded.
    const listed = rawLines.slice(0, MAX_LISTED_PATHS)
    for (const l of listed) out.push(`     ${l}`)
    const remaining = rawLines.length - listed.length
    if (remaining > 0) out.push(`     … +${remaining} more`)
  }

  if (formatted.middleLines && formatted.middleLines.length) {
    for (const l of formatted.middleLines) out.push(`     ${l}`)
  }
  if (formatted.expandInfo) out.push(`     ${formatted.expandInfo}`)

  return out
}

function renderDoneLine(args: { toolUses: number; usage: TokenUsage; durationMs: number; isError: boolean }): string {
  if (args.isError) return 'Error'

  const toolUses = args.toolUses
  const toolUsesPart = `${toolUses} tool use${toolUses === 1 ? '' : 's'}`
  const tokens = formatTokenCount(sumTokens(args.usage))
  const tokensPart = tokens ? `${tokens} tokens` : ''
  const duration = formatDuration(args.durationMs)

  const parts = [toolUsesPart, tokensPart, duration].filter(Boolean).join(' · ')
  return `Done (${parts})`
}

function splitLines(s: string): string[] {
  return String(s || '').split(/\r?\n/)
}

function truncateTextByChars(text: string, maxChars: number): { preview: string; truncated: number } {
  const s = String(text || '')
  if (s.length <= maxChars) return { preview: s, truncated: 0 }
  return { preview: s.slice(0, maxChars).trimEnd(), truncated: s.length - maxChars }
}

function sumTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  )
}

function formatTokenCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v <= 0) return ''
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}

function formatDuration(ms: number): string {
  const s = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m}m` : `${m}m ${r}s`
}

export const taskSubAgentTestExports = {
  parseExplicitModelTier,
  formatNestedHeader,
  renderNestedLines,
  trimEntries,
  addUsage,
  compactInputForHeader,
  compactInputForNestedUi,
  basename,
  toSingleLine,
  truncateLine,
  createThrottledUpdater,
  renderTaskTranscriptLines,
  renderNestedToolResultLines,
  renderDoneLine,
  splitLines,
  truncateTextByChars,
  sumTokens,
  formatTokenCount,
  formatDuration,
}
