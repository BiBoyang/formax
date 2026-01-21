import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, StreamSink } from '../streaming/types'
import { readTodos } from '../tools/runtime/todosFile'
import { buildTodoStaleReminderBody } from '../prompts/reminders/todos'
import type { ContextBudgetConfig } from './context/budget'
import { pruneForPromptBudget } from './context/prune'
import type { HooksRuntime } from '../hooks/runtime'

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
  hooks?: HooksRuntime
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
      const pendingPostToolUseTextByToolUseId = new Map<string, string[]>()

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
        hooks: deps.hooks,
      }

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        const res = await deps.executor(call, executorCtxBase)

        if (deps.hooks) {
          onEvent({ type: 'tool_update', id: call.id, middleLines: ['Running PostToolUse hook…'] })
          const post = await deps.hooks.runPostToolUse({
            toolUseId: call.id,
            toolName: call.name,
            toolInput: call.input ?? {},
            toolResult: res,
            cwd,
            signal,
          })

          const lines: string[] = []

          if (post.blockingErrors.length > 0) {
            onEvent({ type: 'tool_update', id: call.id, middleLines: [`PostToolUse:${call.name} hook returned blocking error`] })
            for (const b of post.blockingErrors) {
              const stderr = b.stderr.trim()
              if (!stderr) continue
              lines.push(
                `<system-reminder>\nPostToolUse:${call.name} hook blocking error from command: "${b.command}":\n${stderr}\n</system-reminder>`,
              )
            }
          }

          if (post.additionalContext.length > 0) {
            const combined = post.additionalContext.join('\n\n')
            lines.push(
              `<system-reminder>\nPostToolUse:${call.name} hook additional context:\n${combined}\n</system-reminder>`,
            )
          }

          if (lines.length > 0) {
            pendingPostToolUseTextByToolUseId.set(call.id, lines)
          }
        }

        return res
      }

      try {
        const todoStaleThreshold = 2
        const shouldInjectTodoReminders = (exec?.agentDepth ?? 0) === 0
        let nonTodoToolUsesSinceLastTodoWrite = shouldInjectTodoReminders
          ? countNonTodoToolUsesSinceLastTodoWrite(history)
          : 0
        let shouldIncludeTodoStaleReminder = false

        let iteration = 0
        while (true) {
          const todoStaleReminder =
            shouldInjectTodoReminders && shouldIncludeTodoStaleReminder ? buildTodoStaleReminder(cwd) : null

          const systemForThisCall =
            todoStaleReminder
              ? [
                  ...system,
                  {
                    type: 'text',
                    text: todoStaleReminder,
                    cache_control: { type: 'ephemeral' },
                  },
                ]
              : system

          // IMPORTANT:
          // - PostToolUse.additionalContext should affect the *next* model call.
          // - It should NOT be persisted into long-term chat history (to avoid context pollution).
          // We therefore patch the messages we send to the model, but we keep `loopMessages` intact.
          if (promptBudget?.contextWindowTokens) {
            const prunedBase = pruneForPromptBudget({
              system: systemForThisCall,
              messages: loopMessages,
              contextWindowTokens: promptBudget.contextWindowTokens,
              effectiveContextWindowPercent: promptBudget.effectiveContextWindowPercent,
              autoCompactLimitPercent: promptBudget.autoCompactLimitPercent,
              baselineTokens: promptBudget.baselineTokens,
            }).messages

            if (prunedBase !== loopMessages) {
              loopMessages.length = 0
              loopMessages.push(...prunedBase)
            }
          }

          const injectedMessages = buildMessagesWithPostToolUseText(loopMessages, pendingPostToolUseTextByToolUseId)
          const messagesForCall =
            promptBudget?.contextWindowTokens
              ? pruneForPromptBudget({
                  system: systemForThisCall,
                  messages: injectedMessages,
                  contextWindowTokens: promptBudget.contextWindowTokens,
                  effectiveContextWindowPercent: promptBudget.effectiveContextWindowPercent,
                  autoCompactLimitPercent: promptBudget.autoCompactLimitPercent,
                  baselineTokens: promptBudget.baselineTokens,
                }).messages
              : injectedMessages

          const { assistantBlocks, stopReason, toolResults } =
            await deps.client.streamOnce({
              messages: messagesForCall.slice(),
              system: systemForThisCall,
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

          if (shouldInjectTodoReminders) {
            const toolNameById = new Map(toolUseBlocks.map((b) => [b.id, b.name]))
            for (const r of toolResults) {
              const toolName = toolNameById.get(r.tool_use_id)
              if (!toolName) continue

              const ok = !r.is_error
              if (toolName === 'TodoWrite') {
                if (ok) nonTodoToolUsesSinceLastTodoWrite = 0
                continue
              }

              nonTodoToolUsesSinceLastTodoWrite++
            }

            shouldIncludeTodoStaleReminder = nonTodoToolUsesSinceLastTodoWrite >= todoStaleThreshold
          }

          loopMessages.push(
            ...toolResults.map((r) => ({
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

function buildMessagesWithPostToolUseText(
  messages: ChatHistory,
  pendingByToolUseId: Map<string, string[]>,
): ChatHistory {
  if (pendingByToolUseId.size === 0) return messages

  const used = new Set<string>()

  const patched = messages.map((m) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m

    let changed = false
    const nextBlocks: PromptBlock[] = []

    for (const block of m.content) {
      nextBlocks.push(block)

      const toolUseId = (block as any)?.type === 'tool_result' ? String((block as any)?.tool_use_id ?? '') : ''
      if (!toolUseId) continue

      const extra = pendingByToolUseId.get(toolUseId)
      if (!extra || extra.length === 0) continue

      for (const text of extra) {
        nextBlocks.push({ type: 'text', text })
      }

      used.add(toolUseId)
      changed = true
    }

    if (!changed) return m
    return { ...m, content: nextBlocks }
  })

  for (const id of used) pendingByToolUseId.delete(id)
  return patched
}

function buildTodoStaleReminder(cwd: string): string | null {
  const { exists, todos } = readTodos(cwd)
  if (!exists || todos === null || todos.length === 0) return null
  const body = buildTodoStaleReminderBody(todos)
  if (!body) return null
  return `<system-reminder>\n${body}\n</system-reminder>`
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
