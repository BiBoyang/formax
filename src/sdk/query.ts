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
  AssistantMessage,
  InputRequestMessage,
  QueryArgs,
  QueryMessage,
  ResultMessage,
  SystemPromptInput,
} from './types.js'
import {
  asValidationError,
  parseApprovalInputResponse,
  parseAskUserQuestionInputResponse,
  parsePromptHistory,
  parseQueryArgsInput,
  parseStopReason,
  parseStreamEvent,
  parseTokenUsage,
  parseToolDefinitions,
} from './validation.js'

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
    args.onStopReason(parseStopReason(out?.stopReason ?? null))
    const usage = parseTokenUsage(out?.usage)
    if (usage) args.onUsage(usage)
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

function toApprovalAnswers(
  response: ReturnType<typeof parseApprovalInputResponse>,
): Record<string, string> {
  if (!response) {
    return { decision: 'deny' }
  }
  const out: Record<string, string> = {
    decision: response.decision,
  }
  if (response.scope) out.scope = response.scope
  if (typeof response.feedback === 'string' && response.feedback.trim()) {
    out.feedback = response.feedback
  }

  return out
}

function toAskUserAnswers(
  response: ReturnType<typeof parseAskUserQuestionInputResponse>,
): Record<string, string> {
  if (!response) return {}

  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.answers)) {
    out[String(key)] = String(value ?? '')
  }
  return out
}

export async function* query(args: QueryArgs): AsyncGenerator<QueryMessage, void, unknown> {
  const sessionId = randomUUID()
  const startedAt = Date.now()
  const queue = createAsyncIteratorQueue<QueryMessage>()
  const controller = new AbortController()
  let runSignal: AbortSignal = controller.signal

  const run = (async () => {
    let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null
    let restorePatchedStreamOnce: (() => void) | null = null
    let messageCallback: ((message: QueryMessage) => void) | undefined
    const pendingInputResolutions = new Set<Promise<void>>()
    let nextHistory: PromptMessage[] = []
    let lastStopReason: StopReason = null
    let usageModel: string | undefined
    let streamUsageCount = 0
    let usageEventCount = 0
    const streamUsageTotals: TokenUsage = {}
    const eventUsageTotals: TokenUsage = {}
    let lastStepUsage: TokenUsage | undefined

    try {
      const rawOptions =
        args && typeof args === 'object' && !Array.isArray(args) && (args as { options?: unknown }).options
          ? ((args as { options?: unknown }).options as unknown)
          : undefined
      if (
        rawOptions &&
        typeof rawOptions === 'object' &&
        !Array.isArray(rawOptions) &&
        typeof (rawOptions as { onMessage?: unknown }).onMessage === 'function'
      ) {
        messageCallback = (rawOptions as { onMessage: (message: QueryMessage) => void }).onMessage
      }

      const parsedArgs = parseQueryArgsInput(args)
      const options = parsedArgs.options ?? {}
      messageCallback = options.onMessage
      const cwd = path.resolve(options.cwd ?? process.cwd())
      const env = options.env ?? process.env
      const history = cloneHistory(parsedArgs.history)
      nextHistory = history
      const interactive = options.interactive === true
      const disallowedTools = normalizeDisallowedTools({
        interactive,
        disallowedTools: options.disallowedTools,
      })
      runSignal = combineSignals(options.signal, controller.signal)

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

      const tools = parseToolDefinitions(
        filterToolsForQuery({
          tools: patchToolsForTurn(runtime.tools, cwd),
          allowedTools: options.allowedTools,
          disallowedTools,
        }),
      )

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
        const parsedEvent = parseStreamEvent(event)

        if (parsedEvent.type === 'usage') {
          usageEventCount += 1
          mergeUsageTotals(eventUsageTotals, parsedEvent.usage)
          lastStepUsage = parsedEvent.usage
          if (parsedEvent.model) usageModel = parsedEvent.model
        }

        if (parsedEvent.type === 'approval_request') {
          const requestMessage: InputRequestMessage = {
            type: 'input_request',
            subtype: 'approval_request',
            session_id: sessionId,
            uuid: randomUUID(),
            tool_use_id: parsedEvent.toolUseId,
            tool_name: parsedEvent.toolName,
            action: parsedEvent.action,
            effective_decision: parsedEvent.effectiveDecision,
            ...(parsedEvent.suggestions ? { suggestions: parsedEvent.suggestions } : {}),
            ...(parsedEvent.workspaceRequest !== undefined
              ? { workspace_request: parsedEvent.workspaceRequest }
              : {}),
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
                const parsedResponse = parseApprovalInputResponse(response)
                runtime.userInputManager.submitAnswers(
                  parsedEvent.toolUseId,
                  toApprovalAnswers(parsedResponse),
                )
              } catch (error) {
                runtime.userInputManager.reject(
                  parsedEvent.toolUseId,
                  asValidationError(error, 'Invalid approval input response'),
                )
              }
            })()

            pendingInputResolutions.add(task)
            void task.finally(() => {
              pendingInputResolutions.delete(task)
            })
          }
        }

        if (parsedEvent.type === 'ask_user_question') {
          const requestMessage: InputRequestMessage = {
            type: 'input_request',
            subtype: 'ask_user_question',
            session_id: sessionId,
            uuid: randomUUID(),
            tool_use_id: parsedEvent.toolUseId,
            questions: parsedEvent.questions,
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
                const parsedResponse = parseAskUserQuestionInputResponse(response)
                runtime.userInputManager.submitAnswers(
                  parsedEvent.toolUseId,
                  toAskUserAnswers(parsedResponse),
                )
              } catch (error) {
                runtime.userInputManager.reject(
                  parsedEvent.toolUseId,
                  asValidationError(error, 'Invalid ask_user_question input response'),
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
            event: parsedEvent,
          },
        })
      }

      nextHistory = await runtime.engine.runTurn({
        history,
        user: toUserPromptMessage(parsedArgs.prompt),
        system,
        tools,
        onEvent,
        cwd,
        signal: runSignal,
        model,
        thinkingEnabled: options.thinkingEnabled ?? runtime.cfg.llm.thinkingMode,
        exec: {
          interactive,
          replMode: options.replMode,
          ...(options.allowedTools ? { allowTools: options.allowedTools } : {}),
          ...(disallowedTools ? { denyTools: disallowedTools } : {}),
        },
      })

      nextHistory = parsePromptHistory(nextHistory)
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
      const message = asValidationError(error, 'Invalid query arguments or runtime event').message
      const safeHistory = (() => {
        try {
          return parsePromptHistory(nextHistory)
        } catch {
          return [] as PromptMessage[]
        }
      })()
      const usage = buildFinalUsage({
        eventTotals: eventUsageTotals,
        eventCount: usageEventCount,
        streamTotals: streamUsageTotals,
        streamCount: streamUsageCount,
      })

      emitMessage({
        emit: queue.push,
        callback: messageCallback,
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
          history: safeHistory,
          duration_ms: Math.max(0, Date.now() - startedAt),
          error: message,
        },
      })
    } finally {
      if (!runSignal.aborted && pendingInputResolutions.size > 0) {
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
