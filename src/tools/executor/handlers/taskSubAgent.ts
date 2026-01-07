import type { SubAgentRegistry } from '../../../subagents/registry'
import type { SubAgentRunner } from '../../../subagents/runner'
import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../index'
import type { TaskManager } from '../../runtime/taskManager'
import { formatToolCallParts, formatToolResult } from '../../../utils/toolFormatting'
import type { StreamEvent, TokenUsage } from '../../../streaming/types'

type NestedToolEntry = {
  id: string
  name: string
  input: Record<string, any>
  status: 'running' | 'completed' | 'error'
  header: string
  summary?: string
}

const MAX_VISIBLE_TOOL_USES = 2
const MAX_LINE_CHARS = 80

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
      const input = call.input || {}
      const subagentType = (input as any).subagent_type
      const prompt = (input as any).prompt
      const runInBackground = Boolean((input as any).run_in_background)

      if (typeof subagentType !== 'string' || typeof prompt !== 'string') {
        return {
          tool_use_id: call.id,
          content: 'Error: Missing required fields subagent_type or prompt.',
          is_error: true,
        }
      }

      const agent = deps.registry.get(subagentType)
      if (!agent) {
        return {
          tool_use_id: call.id,
          content: `Error: Sub-agent type '${subagentType}' not found.`,
          is_error: true,
        }
      }

      const run = async (
        signal?: AbortSignal,
        opts?: { emitUi?: boolean },
      ): Promise<{ content: string; is_error?: boolean }> => {
        const entries: NestedToolEntry[] = []
        let toolUses = 0
        const usageTotal: TokenUsage = {}

        const emitProgress = (): void => {
          if (!opts?.emitUi) return
          if (!ctx.onEvent || signal?.aborted) return
          ctx.onEvent({
            type: 'tool_update',
            id: call.id,
            middleLines: renderNestedLines(entries, toolUses),
            toolUses,
            usage: usageTotal,
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
              entries[idx] = {
                ...entries[idx]!,
                input,
                header: formatNestedHeader(entries[idx]!.name, input),
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
              }
              emitProgress()
            }
          }
        }

        const result = await deps.runner.run({ agent, task: prompt, signal, onEvent: onSubEvent })
        const summary = result.summary || ''
        const limited = summary.length > 500 ? summary.slice(0, 500) + '…' : summary

        if (result.artifacts && result.artifacts.length > 0) {
          return {
            content: JSON.stringify({ summary: limited, artifacts: result.artifacts }, null, 2),
            is_error: !result.success,
          }
        }

        return {
          content:
            limited ||
            (result.success ? '(no output)' : `Error: ${result.error || 'Sub-agent failed'}`),
          is_error: !result.success,
        }
      }

      if (runInBackground) {
        const label = `Task(${String(subagentType)})`
        const taskId = deps.taskManager.create({
          kind: 'agent',
          label,
          run: ({ signal }) => run(signal, { emitUi: false }),
        })
        return {
          tool_use_id: call.id,
          content: JSON.stringify({ task_id: taskId, status: 'running' }, null, 2),
        }
      }

      const result = await run(ctx.signal, { emitUi: true })
      return {
        tool_use_id: call.id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      }
    },
  }
}

function formatNestedHeader(name: string, input: Record<string, any>): string {
  const compactInput = compactInputForHeader(name, input)
  const { toolName, params } = formatToolCallParts(name, compactInput)
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
  if (entries.length <= 30) return
  entries.splice(0, entries.length - 30)
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
