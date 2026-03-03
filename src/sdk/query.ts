import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeBundle } from '../runtime/createRuntime.js'
import { createRuntime } from '../runtime/createRuntime.js'
import { buildSystemPrompt } from '../prompts/system.js'
import type { PromptBlock, PromptMessage } from '../prompts/index.js'
import type { StopReason, StreamEvent, TokenUsage } from '../streaming/types.js'
import { buildSkillToolSpecForCwd } from '../tools/modules/skill/index.js'
import type { ToolDefinition } from '../tools/types.js'
import type {
  ApprovalInputResponse,
  AskUserQuestionInputResponse,
  AskUserQuestionRequest,
  AssistantMessage,
  InputRequestMessage,
  InputRequestResponse,
  QueryArgs,
  QueryMessage,
  ResultMessage,
  SystemPromptInput,
} from './types.js'

type QueueResolver<T> = (value: IteratorResult<T>) => void

const USAGE_KEYS: Array<keyof TokenUsage> = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
]

function hasUsageValue(usage: TokenUsage): boolean {
  for (const key of USAGE_KEYS) {
    if (typeof usage[key] === 'number') return true
  }
  return false
}

function mergeUsageTotals(target: TokenUsage, incoming: TokenUsage | undefined): void {
  if (!incoming) return
  for (const key of USAGE_KEYS) {
    const value = incoming[key]
    if (typeof value !== 'number') continue
    const existing = typeof target[key] === 'number' ? target[key] : 0
    target[key] = existing + value
  }
}

function normalizePromptInput(input?: SystemPromptInput): PromptBlock[] {
  if (!input) return []
  if (Array.isArray(input)) return input
  return [{ type: 'text', text: String(input), cache_control: { type: 'ephemeral' } }]
}

function patchToolsForTurn(tools: ToolDefinition[], cwd: string): ToolDefinition[] {
  // Skill tool spec depends on workspace state and should be refreshed each turn.
  return tools.map((tool) => (tool.name === 'Skill' ? buildSkillToolSpecForCwd(cwd) : tool))
}

function filterToolsForQuery(args: {
  tools: ToolDefinition[]
  allowedTools?: string[]
  disallowedTools?: string[]
}): ToolDefinition[] {
  const disallowed = new Set(args.disallowedTools ?? [])
  const allowAll = args.allowedTools?.includes('*') ?? false
  const allowed = args.allowedTools ? new Set(args.allowedTools) : null

  return args.tools.filter((tool) => {
    if (disallowed.has(tool.name)) return false
    if (!allowed) return true
    if (allowAll) return true
    return allowed.has(tool.name)
  })
}

function toUserPromptMessage(prompt: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  }
}

function cloneHistory(history: PromptMessage[] | undefined): PromptMessage[] {
  if (!history || history.length === 0) return []
  return history.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? [...message.content] : [],
  }))
}

function extractLastAssistantMessage(history: PromptMessage[]): { text: string; blocks: PromptBlock[] } | null {
  for (let idx = history.length - 1; idx >= 0; idx -= 1) {
    const message = history[idx]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const blocks = [...message.content]
    const text = blocks
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        if ((block as { type?: unknown }).type !== 'text') return ''
        const value = (block as { text?: unknown }).text
        return typeof value === 'string' ? value : ''
      })
      .join('')
      .trim()
    return { text, blocks }
  }

  return null
}

function createAsyncIteratorQueue<T>(): {
  push: (value: T) => void
  close: () => void
  next: () => Promise<IteratorResult<T>>
} {
  const values: T[] = []
  const waiters: QueueResolver<T>[] = []
  let closed = false

  const push = (value: T) => {
    if (closed) return
    const waiter = waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    values.push(value)
  }

  const close = () => {
    if (closed) return
    closed = true
    while (waiters.length > 0) {
      const waiter = waiters.shift()!
      waiter({ value: undefined as never, done: true })
    }
  }

  const next = async (): Promise<IteratorResult<T>> => {
    if (values.length > 0) {
      const value = values.shift()!
      return { value, done: false }
    }
    if (closed) return { value: undefined as never, done: true }
    return await new Promise<IteratorResult<T>>((resolve) => {
      waiters.push(resolve)
    })
  }

  return { push, close, next }
}

function combineSignals(signalA: AbortSignal | undefined, signalB: AbortSignal): AbortSignal {
  if (!signalA) return signalB
  if (signalA.aborted || signalB.aborted) {
    const aborted = new AbortController()
    aborted.abort()
    return aborted.signal
  }

  const combined = new AbortController()
  const onAbort = () => combined.abort()
  signalA.addEventListener('abort', onAbort, { once: true })
  signalB.addEventListener('abort', onAbort, { once: true })
  return combined.signal
}

function buildFinalUsage(args: {
  eventTotals: TokenUsage
  eventCount: number
  streamTotals: TokenUsage
  streamCount: number
}): TokenUsage | null {
  if (args.eventCount > 0 && hasUsageValue(args.eventTotals)) return args.eventTotals
  if (args.streamCount > 0 && hasUsageValue(args.streamTotals)) return args.streamTotals
  return null
}

function patchClientStreamOnce(args: {
  runtime: RuntimeBundle
  onStopReason: (reason: StopReason) => void
  onUsage: (usage: TokenUsage) => void
}): (() => void) | null {
  const client = args.runtime.client as { streamOnce?: unknown }
  const original = client.streamOnce
  if (typeof original !== 'function') return null

  ;(client as { streamOnce: unknown }).streamOnce = async (...streamArgs: unknown[]) => {
    const out = await (original as (...methodArgs: unknown[]) => Promise<any>).call(client, ...streamArgs)
    args.onStopReason((out?.stopReason ?? null) as StopReason)
    if (out?.usage && typeof out.usage === 'object') {
      args.onUsage(out.usage as TokenUsage)
    }
    return out
  }

  return () => {
    ;(client as { streamOnce: unknown }).streamOnce = original
  }
}

function normalizeDisallowedTools(args: {
  interactive: boolean
  disallowedTools?: string[]
}): string[] | undefined {
  const merged = new Set(args.disallowedTools ?? [])
  if (!args.interactive) {
    // Without an answer submission API, AskUserQuestion would deadlock.
    merged.add('AskUserQuestion')
  }
  return merged.size > 0 ? [...merged] : undefined
}

function emitMessage(args: {
  emit: (message: QueryMessage) => void
  callback?: (message: QueryMessage) => void
  message: QueryMessage
}): void {
  args.emit(args.message)
  if (!args.callback) return
  try {
    args.callback(args.message)
  } catch {
    // SDK callback failures should not break engine execution.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isApprovalInputResponse(value: unknown): value is ApprovalInputResponse {
  return isRecord(value) && typeof value.decision === 'string'
}

function isAskUserQuestionInputResponse(value: unknown): value is AskUserQuestionInputResponse {
  return isRecord(value) && isRecord(value.answers)
}

function toApprovalAnswers(
  response: InputRequestResponse,
): Record<string, string> {
  if (!isApprovalInputResponse(response)) {
    return { decision: 'deny' }
  }

  const decisionRaw = String(response.decision || '').trim().toLowerCase()
  const decision =
    decisionRaw === 'approve' ||
    decisionRaw === 'approve_remember' ||
    decisionRaw === 'feedback' ||
    decisionRaw === 'deny'
      ? decisionRaw
      : 'deny'

  const out: Record<string, string> = {
    decision,
  }

  const scopeRaw = typeof response.scope === 'string' ? response.scope.trim().toLowerCase() : ''
  if (scopeRaw === 'session' || scopeRaw === 'project' || scopeRaw === 'global') {
    out.scope = scopeRaw
  }

  if (typeof response.feedback === 'string' && response.feedback.trim()) {
    out.feedback = response.feedback
  }

  return out
}

function toAskUserAnswers(
  response: InputRequestResponse,
): Record<string, string> {
  if (!isAskUserQuestionInputResponse(response)) return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.answers)) {
    out[String(key)] = String(value ?? '')
  }
  return out
}

function normalizeAskUserQuestions(raw: unknown): AskUserQuestionRequest[] {
  if (!Array.isArray(raw)) return []

  return raw.map((entry) => {
    const record = isRecord(entry) ? entry : {}
    const optionsRaw = Array.isArray(record.options) ? record.options : []
    const options = optionsRaw.map((opt) => {
      const optRecord = isRecord(opt) ? opt : {}
      return {
        label: String(optRecord.label ?? ''),
        description: String(optRecord.description ?? ''),
      }
    })

    const fieldId = typeof record.fieldId === 'string' && record.fieldId.trim() ? record.fieldId.trim() : undefined
    return {
      question: String(record.question ?? ''),
      header: String(record.header ?? ''),
      ...(fieldId ? { fieldId } : {}),
      options,
      multiSelect: Boolean(record.multiSelect),
    }
  })
}

export async function* query(args: QueryArgs): AsyncGenerator<QueryMessage, void, unknown> {
  const options = args.options ?? {}
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const history = cloneHistory(args.history)
  const interactive = options.interactive === true
  const disallowedTools = normalizeDisallowedTools({
    interactive,
    disallowedTools: options.disallowedTools,
  })

  const sessionId = randomUUID()
  const startedAt = Date.now()
  const queue = createAsyncIteratorQueue<QueryMessage>()
  const controller = new AbortController()
  const signal = combineSignals(options.signal, controller.signal)

  const run = (async () => {
    let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null
    let restorePatchedStreamOnce: (() => void) | null = null
    const pendingInputResolutions = new Set<Promise<void>>()
    let nextHistory: PromptMessage[] = history
    let lastStopReason: StopReason = null
    let usageModel: string | undefined
    let streamUsageCount = 0
    let usageEventCount = 0
    const streamUsageTotals: TokenUsage = {}
    const eventUsageTotals: TokenUsage = {}
    let lastStepUsage: TokenUsage | undefined

    try {
      runtime = await createRuntime({ cwd, env })
      const model = String(options.model || runtime.cfg.llm.model || '').trim() || runtime.cfg.llm.model
      const promptProfile = options.promptProfile ?? runtime.cfg.ui.promptProfile

      restorePatchedStreamOnce = patchClientStreamOnce({
        runtime,
        onStopReason: (reason) => {
          lastStopReason = reason
        },
        onUsage: (usage) => {
          streamUsageCount += 1
          mergeUsageTotals(streamUsageTotals, usage)
        },
      })

      const tools = filterToolsForQuery({
        tools: patchToolsForTurn(runtime.tools, cwd),
        allowedTools: options.allowedTools,
        disallowedTools,
      })

      emitMessage({
        emit: queue.push,
        callback: options.onMessage,
        message: {
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          cwd,
          model,
          tools,
        },
      })

      const defaultSystem = buildSystemPrompt({
        allowedSubagents: runtime.allowedSubagents,
        cwd,
        model,
        profile: promptProfile,
      })
      const systemOverride = normalizePromptInput(options.systemPrompt)
      const appendSystem = normalizePromptInput(options.appendSystemPrompt)
      const system = [...(systemOverride.length > 0 ? systemOverride : defaultSystem), ...appendSystem]

      const onEvent = (event: StreamEvent) => {
        if (event.type === 'usage') {
          usageEventCount += 1
          mergeUsageTotals(eventUsageTotals, event.usage)
          lastStepUsage = event.usage
          if (event.model) usageModel = event.model
        }

        if (event.type === 'approval_request') {
          const requestMessage: InputRequestMessage = {
            type: 'input_request',
            subtype: 'approval_request',
            session_id: sessionId,
            uuid: randomUUID(),
            tool_use_id: event.toolUseId,
            tool_name: event.toolName,
            action: event.action,
            effective_decision: event.effectiveDecision,
            ...(event.suggestions ? { suggestions: event.suggestions } : {}),
            ...(event.workspaceRequest !== undefined ? { workspace_request: event.workspaceRequest } : {}),
          }

          emitMessage({
            emit: queue.push,
            callback: options.onMessage,
            message: requestMessage,
          })

          if (runtime?.userInputManager) {
            const task = (async () => {
              try {
                const response = options.onInputRequest
                  ? await options.onInputRequest(requestMessage)
                  : null
                runtime.userInputManager.submitAnswers(
                  event.toolUseId,
                  toApprovalAnswers(response),
                )
              } catch (error) {
                runtime.userInputManager.reject(
                  event.toolUseId,
                  error instanceof Error ? error : new Error(String(error)),
                )
              }
            })()

            pendingInputResolutions.add(task)
            void task.finally(() => {
              pendingInputResolutions.delete(task)
            })
          }
        }

        if (event.type === 'ask_user_question') {
          const requestMessage: InputRequestMessage = {
            type: 'input_request',
            subtype: 'ask_user_question',
            session_id: sessionId,
            uuid: randomUUID(),
            tool_use_id: event.toolUseId,
            questions: normalizeAskUserQuestions(event.questions),
          }

          emitMessage({
            emit: queue.push,
            callback: options.onMessage,
            message: requestMessage,
          })

          if (runtime?.userInputManager) {
            const task = (async () => {
              try {
                const response = options.onInputRequest
                  ? await options.onInputRequest(requestMessage)
                  : null
                runtime.userInputManager.submitAnswers(
                  event.toolUseId,
                  toAskUserAnswers(response),
                )
              } catch (error) {
                runtime.userInputManager.reject(
                  event.toolUseId,
                  error instanceof Error ? error : new Error(String(error)),
                )
              }
            })()

            pendingInputResolutions.add(task)
            void task.finally(() => {
              pendingInputResolutions.delete(task)
            })
          }
        }

        if (!options.includePartialMessages) return

        emitMessage({
          emit: queue.push,
          callback: options.onMessage,
          message: {
            type: 'stream_event',
            session_id: sessionId,
            uuid: randomUUID(),
            parent_tool_use_id: null,
            event,
          },
        })
      }

      nextHistory = await runtime.engine.runTurn({
        history,
        user: toUserPromptMessage(args.prompt),
        system,
        tools,
        onEvent,
        cwd,
        signal,
        model,
        thinkingEnabled: options.thinkingEnabled ?? runtime.cfg.llm.thinkingMode,
        exec: {
          interactive,
          replMode: options.replMode,
          ...(options.allowedTools ? { allowTools: options.allowedTools } : {}),
          ...(disallowedTools ? { denyTools: disallowedTools } : {}),
        },
      })

      const assistantBlocks = extractLastAssistantMessage(nextHistory)
      let assistantMessage: AssistantMessage | null = null

      if (assistantBlocks) {
        assistantMessage = {
          type: 'assistant',
          session_id: sessionId,
          uuid: randomUUID(),
          text: assistantBlocks.text,
          blocks: assistantBlocks.blocks,
          ...(lastStepUsage ? { usage: lastStepUsage } : {}),
          ...(usageModel ? { model: usageModel } : {}),
        }
        emitMessage({
          emit: queue.push,
          callback: options.onMessage,
          message: assistantMessage,
        })
      }

      const usage = buildFinalUsage({
        eventTotals: eventUsageTotals,
        eventCount: usageEventCount,
        streamTotals: streamUsageTotals,
        streamCount: streamUsageCount,
      })

      const resultMessage: ResultMessage = {
        type: 'result',
        session_id: sessionId,
        uuid: randomUUID(),
        subtype: 'success',
        stop_reason: lastStopReason,
        result: assistantMessage?.text ?? '',
        usage,
        ...(usageModel ? { model: usageModel } : {}),
        assistant: assistantMessage,
        history: nextHistory,
        duration_ms: Math.max(0, Date.now() - startedAt),
      }

      emitMessage({
        emit: queue.push,
        callback: options.onMessage,
        message: resultMessage,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const usage = buildFinalUsage({
        eventTotals: eventUsageTotals,
        eventCount: usageEventCount,
        streamTotals: streamUsageTotals,
        streamCount: streamUsageCount,
      })

      emitMessage({
        emit: queue.push,
        callback: options.onMessage,
        message: {
          type: 'result',
          session_id: sessionId,
          uuid: randomUUID(),
          subtype: 'error_during_execution',
          stop_reason: lastStopReason,
          result: '',
          usage,
          ...(usageModel ? { model: usageModel } : {}),
          assistant: null,
          history: nextHistory,
          duration_ms: Math.max(0, Date.now() - startedAt),
          error: message,
        },
      })
    } finally {
      if (!signal.aborted && pendingInputResolutions.size > 0) {
        await Promise.allSettled(Array.from(pendingInputResolutions))
      }
      restorePatchedStreamOnce?.()
    }
  })()

  void run.finally(() => {
    queue.close()
  })

  try {
    while (true) {
      const item = await queue.next()
      if (item.done) break
      yield item.value
    }
  } finally {
    controller.abort()
    await run
  }
}
