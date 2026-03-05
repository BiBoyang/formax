import type { PromptBlock, PromptMessage } from '../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types'
import type { ExecutionContext, ToolExecutor } from '../tools/executor'
import type { LlmStreamClient, StreamSink } from '../streaming/types'
import type { ContextBudgetConfig } from './context/budget'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pruneForPromptBudget } from './context/prune'
import type { HooksRuntime } from '../hooks/runtime'
import type { AuditLog } from '../adapters/audit/auditLog.js'
import { appendHookRunAuditEvents } from '../hooks/audit.js'
import { randomUUID } from 'node:crypto'
import { createRuntimeFlags, type RuntimeFlags } from '../config/runtimeFlags.js'

export type ChatHistory = PromptMessage[]

export interface ChatEngine {
  beginNewSession?: (args?: { source?: 'startup' | 'clear' | 'resume' }) => void
  runTurn(args: {
    history: ChatHistory
    user: PromptMessage
    system: PromptBlock[]
    tools: ToolDefinition[]
    resolveToolsForCall?: () => ToolDefinition[]
    onEvent: StreamSink
    cwd: string
    signal?: AbortSignal
    promptBudget?: ContextBudgetConfig | null
    model?: string
    thinkingEnabled?: boolean
    exec?: Partial<
      Pick<
        ExecutionContext,
        | 'agentDepth'
        | 'allowTools'
        | 'denyTools'
        | 'replMode'
        | 'getReplMode'
        | 'setReplMode'
        | 'trace'
        | 'getPlanPath'
        | 'planPath'
        | 'interactive'
        | 'toolExposureSessionKey'
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
  runtimeFlags?: RuntimeFlags
}): ChatEngine {
  let sessionId = randomUUID()
  let sessionStartSource: 'startup' | 'clear' | 'resume' = 'startup'
  let pendingSessionStartText: string[] | null = null
  let pendingStopText: string[] | null = null
  let didAttemptSessionStart = false
  const runtimeFlags = deps.runtimeFlags ?? createRuntimeFlags()
  const hooksDebugEnabled = runtimeFlags.hooksDebugEnabled

  return {
    beginNewSession: (args) => {
      sessionId = randomUUID()
      sessionStartSource = args?.source ?? 'startup'
      pendingSessionStartText = null
      pendingStopText = null
      didAttemptSessionStart = false
    },
    async runTurn({
      history,
      user,
      system,
      tools,
      resolveToolsForCall,
      onEvent,
      cwd,
      signal,
      promptBudget,
      model,
      thinkingEnabled,
      exec,
    }): Promise<ChatHistory> {
      const loopMessages: ChatHistory = [...history, user]
      const pendingPostToolUseTextByToolUseId = new Map<string, string[]>()
      let pendingUserPromptSubmitText: string[] | null = null
      const audit = deps.audit
      const withTrace = (toolUseId: string) => {
        if (!exec?.trace) return { toolUseId }
        return {
          ...exec.trace,
          toolUseId,
        }
      }

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
        trace: exec?.trace,
        toolExposureSessionKey: exec?.toolExposureSessionKey,
        deferredToolSoftFallback: runtimeFlags.deferredToolSoftFallbackEnabled,
      }

      const runSessionStart = async (): Promise<void> => {
        if (!deps.hooks) return
        if (didAttemptSessionStart) return
        didAttemptSessionStart = true

        const res = await deps.hooks.runSessionStart({ sessionId, cwd, signal, source: sessionStartSource })

        appendHookRunAuditEvents({
          audit,
          hooksDebugEnabled,
          tool: { name: 'SessionStart', toolUseId: 'session_start' },
          agentDepth: executorCtxBase.agentDepth,
          eventName: 'SessionStart',
          runs: res.runs,
          trace: withTrace('session_start'),
        })

        if (res.additionalContext.length > 0) {
          const combined = res.additionalContext.join('\n\n')
          pendingSessionStartText = [
            `<system-reminder>\nSessionStart hook additional context:\n${combined}\n</system-reminder>`,
          ]
        }
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
          trace: withTrace('user_prompt'),
        })

        if (res.additionalContext.length > 0) {
          const combined = res.additionalContext.join('\n\n')
          pendingUserPromptSubmitText = [
            `<system-reminder>\nUserPromptSubmit hook additional context:\n${combined}\n</system-reminder>`,
          ]
        }
      }

      await runSessionStart()
      await runUserPromptSubmit()

      const runStop = async (): Promise<void> => {
        if (!deps.hooks) return

        const res = await deps.hooks.runStop({ sessionId, cwd, stopHookActive: false, signal })

        appendHookRunAuditEvents({
          audit,
          hooksDebugEnabled,
          tool: { name: 'Stop', toolUseId: 'stop' },
          agentDepth: executorCtxBase.agentDepth,
          eventName: 'Stop',
          runs: res.runs,
          trace: withTrace('stop'),
        })

        if (res.additionalContext.length > 0) {
          const combined = res.additionalContext.join('\n\n')
          pendingStopText = [`<system-reminder>\nStop hook additional context:\n${combined}\n</system-reminder>`]
        }
      }

      const executeTool = async (call: ToolCall): Promise<ToolResult> => {
        const res = await deps.executor(call, executorCtxBase)

        if (deps.hooks) {
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
            trace: withTrace(call.id),
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
        const recentTools: string[] = []
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
          const preCallExtra =
            pendingStopText || pendingSessionStartText || pendingUserPromptSubmitText
              ? [
                  ...(pendingStopText ?? []),
                  ...(pendingSessionStartText ?? []),
                  ...(pendingUserPromptSubmitText ?? []),
                ]
              : null
          const injectedWithUserPromptSubmit = buildMessagesWithUserPromptSubmitText(injectedMessages, preCallExtra)
          pendingUserPromptSubmitText = null
          pendingSessionStartText = null
          pendingStopText = null

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
          const toolsForCall = resolveToolsForCall?.() ?? tools
          executorCtxBase.allowTools = intersectAllowTools({
            requestedAllowTools: exec?.allowTools,
            exposedTools: toolsForCall,
          })
          if (runtimeFlags.requestDryRunEnabled) {
            const dump = await writeRequestDryRunSnapshot({
              cwd,
              outputDir: runtimeFlags.requestDryRunOutputDir,
              model,
              thinkingEnabled,
              system: systemForThisCall,
              messages: messagesForCall,
              tools: toolsForCall,
              iteration,
            })
            const dryRunNotice =
              '[dry-run] Request payload captured. No network request was sent.\n' +
              `Path: ${dump.filePath}`
            onEvent({ type: 'assistant_delta', text: dryRunNotice })
            loopMessages.push({
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: dryRunNotice,
                },
              ],
            })
            break
          }

          const { assistantBlocks, stopReason, toolResults } =
            await deps.client.streamOnce({
              messages: messagesForCall.slice(),
              system: systemForThisCall,
              tools: toolsForCall,
              onEvent,
              executeTool,
              signal,
              model,
              thinkingEnabled,
            })

          const toolUseBlocks = assistantBlocks.filter(isToolUseBlock)

          loopMessages.push({ role: 'assistant', content: assistantBlocks })

          if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
            break
          }

          // Defensive: if the stream claims tool_use but no tool results are produced, the next
          // iteration would repeat the same tool_use(s) and potentially spin until hitting the cap.
          if (toolResults.length === 0) {
            throw new Error('Tool loop produced no tool_results (stream bug)')
          }

          loopMessages.push(
            ...toolResults.map((r) => ({
              role: 'user' as const,
              content: buildToolResultMessageBlocks(r),
            })),
          )

          for (const b of toolUseBlocks) {
            recentTools.push(String(b.name))
          }
          if (recentTools.length > 20) recentTools.splice(0, recentTools.length - 20)

          iteration++
        }

        await runStop()

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

function buildToolResultMessageBlocks(result: ToolResult): PromptBlock[] {
  const blocks: PromptBlock[] = [
    {
      type: 'tool_result',
      tool_use_id: result.tool_use_id,
      content: result.content,
      ...(result.is_error ? { is_error: true } : {}),
    },
  ]

  for (const text of result.extraTextBlocks ?? []) {
    blocks.push({ type: 'text', text: String(text) })
  }

  return blocks
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

function intersectAllowTools(args: {
  requestedAllowTools: string[] | undefined
  exposedTools: ToolDefinition[]
}): string[] {
  const exposedNames = Array.from(new Set(args.exposedTools.map((tool) => tool.name)))
  if (!args.requestedAllowTools || args.requestedAllowTools.length === 0) return exposedNames
  if (args.requestedAllowTools.includes('*')) return exposedNames

  const requested = new Set(args.requestedAllowTools)
  return exposedNames.filter((name) => requested.has(name))
}

async function writeRequestDryRunSnapshot(args: {
  cwd: string
  outputDir: string | null
  model: string | undefined
  thinkingEnabled: boolean | undefined
  system: PromptBlock[]
  messages: PromptMessage[]
  tools: ToolDefinition[]
  iteration: number
}): Promise<{ filePath: string }> {
  const targetDir = resolveRequestDryRunOutputDir(args.cwd, args.outputDir)
  await fs.mkdir(targetDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${ts}__iter-${args.iteration + 1}__${randomUUID()}.json`
  const filePath = path.join(targetDir, fileName)
  const payload = {
    kind: 'formax_request_preview_v1',
    createdAt: new Date().toISOString(),
    iteration: args.iteration + 1,
    cwd: args.cwd,
    model: args.model ?? null,
    thinkingEnabled: args.thinkingEnabled ?? null,
    system: args.system,
    messages: args.messages,
    tools: args.tools,
  }

  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { filePath }
}

function resolveRequestDryRunOutputDir(cwd: string, outputDir: string | null): string {
  const explicit = String(outputDir || '').trim()
  if (explicit) return path.resolve(cwd, explicit)
  return path.resolve(cwd, 'proxy', 'request-dry-run')
}
