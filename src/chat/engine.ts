import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, StreamSink } from '../streaming/types'
import { readTodos } from '../tools/runtime/todosFile'
import { buildTodoStaleReminderBody } from '../prompts/reminders/todos'
import type { ContextBudgetConfig } from './context/budget'
import { pruneForPromptBudget } from './context/prune'

export type ChatHistory = PromptMessage[]

export interface ChatEngine {
  runTurn(args: {
    history: ChatHistory
    user: PromptMessage
    system: PromptBlock[]
    tools: ToolDefinition[]
    onEvent: StreamSink
    cwd: string
    signal?: AbortSignal
    promptBudget?: ContextBudgetConfig | null
    exec?: Partial<
      Pick<
        ExecutionContext,
        | 'agentDepth'
        | 'allowTools'
        | 'denyTools'
        | 'replMode'
        | 'getReplMode'
        | 'setReplMode'
        | 'getPlanPath'
        | 'planPath'
        | 'interactive'
      >
    >
}): Promise<ChatHistory>
}

function isToolUseBlock(
  block: PromptBlock,
): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } {
  if (!block || typeof block !== 'object') return false
  if ((block as any).type !== 'tool_use') return false
  return typeof (block as any).id === 'string' && typeof (block as any).name === 'string'
}

export function createChatEngine(deps: {
  client: LlmStreamClient
  executor: ToolExecutor
}): ChatEngine {
  return {
    async runTurn({
      history,
      user,
      system,
      tools,
      onEvent,
      cwd,
      signal,
      promptBudget,
      exec,
    }): Promise<ChatHistory> {
      const loopMessages: ChatHistory = [...history, user]

      const executorCtxBase: ExecutionContext = {
        cwd,
        signal,
        onEvent,
        agentDepth: exec?.agentDepth ?? 0,
        interactive: exec?.interactive,
        replMode: exec?.replMode,
        getReplMode: exec?.getReplMode,
        setReplMode: exec?.setReplMode,
        getPlanPath: exec?.getPlanPath,
        planPath: exec?.planPath,
        allowTools: exec?.allowTools,
        denyTools: exec?.denyTools,
      }

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        return deps.executor(call, executorCtxBase)
      }

      try {
        const todoStaleThreshold = 2
        const shouldInjectTodoReminders = (exec?.agentDepth ?? 0) === 0
        let nonTodoToolUsesSinceLastTodoWrite = shouldInjectTodoReminders
          ? countNonTodoToolUsesSinceLastTodoWrite(history)
          : 0

        let iteration = 0
        while (true) {
          const prunedLoopMessages =
            promptBudget?.contextWindowTokens
              ? pruneForPromptBudget({
                  system,
                  messages: loopMessages,
                  contextWindowTokens: promptBudget.contextWindowTokens,
                  effectiveContextWindowPercent: promptBudget.effectiveContextWindowPercent,
                  autoCompactLimitPercent: promptBudget.autoCompactLimitPercent,
                  baselineTokens: promptBudget.baselineTokens,
                }).messages
              : loopMessages

          if (prunedLoopMessages !== loopMessages) {
            loopMessages.length = 0
            loopMessages.push(...prunedLoopMessages)
          }

          const { assistantBlocks, stopReason, toolResults } =
            await deps.client.streamOnce({
              messages: loopMessages.slice(),
              system,
              tools,
              onEvent,
              executeTool,
              signal,
            })

          const toolUseBlocks = assistantBlocks.filter(isToolUseBlock)

          loopMessages.push({ role: 'assistant', content: assistantBlocks })

          if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
            break
          }

          const toolNameById = shouldInjectTodoReminders ? new Map(toolUseBlocks.map((b) => [b.id, b.name])) : null
          const todoStaleReminder = shouldInjectTodoReminders ? buildTodoStaleReminder(cwd) : null

          const amendedToolResults = toolResults.map((r) => {
            const toolName = toolNameById?.get(r.tool_use_id)
            const ok = !r.is_error

            if (toolName === 'TodoWrite') {
              if (ok) nonTodoToolUsesSinceLastTodoWrite = 0
              return r
            }

            if (shouldInjectTodoReminders) {
              nonTodoToolUsesSinceLastTodoWrite++
              if (todoStaleReminder && nonTodoToolUsesSinceLastTodoWrite >= todoStaleThreshold) {
                return {
                  ...r,
                  content: appendReminderToToolResultContent(r.content, todoStaleReminder),
                }
              }
            }

            return r
          })

          loopMessages.push(
            ...amendedToolResults.map((r) => ({
              role: 'user' as const,
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: r.tool_use_id,
                  content: r.content,
                  ...(r.is_error ? { is_error: true } : {}),
                },
              ],
            })),
          )

          iteration++
          if (iteration > 50) {
            throw new Error('Tool loop exceeded iteration limit')
          }
        }

        onEvent({ type: 'complete' })
        return loopMessages
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e))
        onEvent({ type: 'error', error: err })
        throw err
      }
    },
  }
}

function buildTodoStaleReminder(cwd: string): string | null {
  const { exists, todos } = readTodos(cwd)
  if (!exists || todos === null || todos.length === 0) return null
  const body = buildTodoStaleReminderBody(todos)
  if (!body) return null
  return `<system-reminder>\n${body}\n</system-reminder>`
}

function appendReminderToToolResultContent(base: unknown, reminder: string): string {
  const text = typeof base === 'string' ? base : String(base ?? '')
  return text.trim() ? `${text}\n\n${reminder}` : reminder
}

function countNonTodoToolUsesSinceLastTodoWrite(history: ChatHistory): number {
  const toolNameById = new Map<string, string>()
  let count = 0

  for (const msg of history) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (isToolUseBlock(block)) toolNameById.set(block.id, block.name)
      }
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const tr = block as any
        if (tr?.type !== 'tool_result') continue
        if (typeof tr?.tool_use_id !== 'string') continue

        const toolName = toolNameById.get(tr.tool_use_id)
        if (!toolName) continue

        const ok = !tr.is_error
        if (toolName === 'TodoWrite') {
          if (ok) count = 0
          continue
        }

        count++
      }
    }
  }

  return count
}
