import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, StreamSink } from '../streaming/types'
import type { ContextBudgetConfig } from './context/budget'
import { pruneForPromptBudget } from './context/prune'
import type { HooksRuntime } from '../hooks/runtime'
import type { AuditLog } from '../adapters/audit/auditLog.js'
import { appendHookRunAuditEvents } from '../hooks/audit.js'

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
  audit?: AuditLog
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
	      let pendingUserPromptSubmitText: string[] | null = null
	      const audit = deps.audit
	      const hooksDebugEnabled = (() => {
	        const raw = String(process.env.FORMAX_HOOKS_DEBUG ?? '').trim().toLowerCase()
	        return raw === '1' || raw === 'true' || raw === 'yes'
	      })()

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

      const runUserPromptSubmit = async (): Promise<void> => {
        if (!deps.hooks) return

        const prompt = extractPromptText(user)
        if (!prompt) return

        const res = await deps.hooks.runUserPromptSubmit({ prompt, cwd, signal })

        appendHookRunAuditEvents({
          audit,
          hooksDebugEnabled,
          tool: { name: 'UserPromptSubmit', toolUseId: 'user_prompt' },
          agentDepth: executorCtxBase.agentDepth,
          eventName: 'UserPromptSubmit',
          runs: res.runs,
        })

        if (res.additionalContext.length > 0) {
          const combined = res.additionalContext.join('\n\n')
          pendingUserPromptSubmitText = [
            `<system-reminder>\nUserPromptSubmit hook additional context:\n${combined}\n</system-reminder>`,
          ]
        }
      }

      await runUserPromptSubmit()

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

          appendHookRunAuditEvents({
            audit,
            hooksDebugEnabled,
            tool: { name: call.name, toolUseId: call.id },
            agentDepth: executorCtxBase.agentDepth,
            eventName: 'PostToolUse',
            runs: post.runs,
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
        let iteration = 0
        while (true) {
          const systemForThisCall = system

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
          const injectedWithUserPromptSubmit = buildMessagesWithUserPromptSubmitText(
            injectedMessages,
            pendingUserPromptSubmitText,
          )
          pendingUserPromptSubmitText = null

          const messagesForCall =
            promptBudget?.contextWindowTokens
              ? pruneForPromptBudget({
                  system: systemForThisCall,
                  messages: injectedWithUserPromptSubmit,
                  contextWindowTokens: promptBudget.contextWindowTokens,
                  effectiveContextWindowPercent: promptBudget.effectiveContextWindowPercent,
                  autoCompactLimitPercent: promptBudget.autoCompactLimitPercent,
                  baselineTokens: promptBudget.baselineTokens,
                }).messages
              : injectedWithUserPromptSubmit

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

function extractPromptText(user: PromptMessage): string {
  if (user.role !== 'user' || !Array.isArray(user.content)) return ''
  const texts = user.content
    .filter((b) => (b as any)?.type === 'text' && typeof (b as any)?.text === 'string')
    .map((b) => String((b as any).text))
    .filter(Boolean)
  return texts.join('\n').trim()
}

function buildMessagesWithUserPromptSubmitText(messages: ChatHistory, extra: string[] | null): ChatHistory {
  if (!extra || extra.length === 0) return messages

  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user' || !Array.isArray(last.content)) return messages

  // Only inject on the *initial* user prompt message. Tool-loop user messages
  // contain tool_result blocks and should not receive UserPromptSubmit output.
  if (last.content.some((b) => (b as any)?.type === 'tool_result')) return messages

  const nextBlocks: PromptBlock[] = [...last.content]
  for (const text of extra) nextBlocks.push({ type: 'text', text })

  return [...messages.slice(0, -1), { ...last, content: nextBlocks }]
}
