import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeBundle } from '../../runtime/createRuntime.js'
import { createRuntime } from '../../runtime/createRuntime.js'
import { buildSystemPrompt } from '../../prompts/system.js'
import type { PromptBlock, PromptMessage } from '../../prompts/index.js'
import type { StopReason, StreamEvent, TokenUsage } from '../../streaming/types.js'
import { buildSkillToolSpecForCwd } from '../../tools/modules/skill/index.js'
import type { ReplMode } from '../../tools/executor/index.js'
import type { ToolDefinition } from '../../tools/types.js'
import type {
  AssistantMessage,
  PermissionMode,
  Query,
  QueryArgs,
  QueryMessage,
  ResultMessage,
  ThinkingConfig,
  SystemPromptPresetInput,
  SystemPromptInput,
} from '../types.js'
import {
  asValidationError,
  parsePromptHistory,
  parseQueryArgsInput,
  parseSDKUserMessageInput,
  parseStopReason,
  parseStreamEvent,
  parseTokenUsage,
  parseToolDefinitions,
} from '../validation.js'
import { handleInputRequestEvent } from './inputRequests.js'
import {
  buildStructuredOutputRetryPrompt,
  buildStructuredOutputSystemPrompt,
  parseAndValidateStructuredOutput,
  validateStructuredOutputValue,
} from '../structuredOutput.js'

type QueueResolver<T> = (value: IteratorResult<T>) => void

const USAGE_KEYS: Array<keyof TokenUsage> = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
]

const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput'
const STRUCTURED_OUTPUT_TOOL_DESCRIPTION =
  'Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output.'

const SUPPORTED_PERMISSION_MODE_TO_REPL_MODE: Record<'default' | 'acceptEdits' | 'plan', ReplMode> = {
  default: 'normal',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
}

function buildStructuredOutputToolDefinition(schema: Record<string, unknown>): ToolDefinition {
  // Match official SDK behavior: StructuredOutput.input_schema is derived directly
  // from outputFormat.schema on each query invocation.
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    description: STRUCTURED_OUTPUT_TOOL_DESCRIPTION,
    input_schema: schema,
  }
}

function isStructuredOutputToolCall(
  call: unknown,
): call is { id: string; name: string; input: unknown } {
  if (!call || typeof call !== 'object') return false
  const record = call as { id?: unknown; name?: unknown }
  return typeof record.id === 'string' && record.name === STRUCTURED_OUTPUT_TOOL_NAME
}

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
  if (isSystemPromptPresetInput(input)) {
    return normalizePromptInput(input.append)
  }
  return [{ type: 'text', text: String(input), cache_control: { type: 'ephemeral' } }]
}

function isSystemPromptPresetInput(input: unknown): input is SystemPromptPresetInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const record = input as Record<string, unknown>
  return record.type === 'preset' && record.preset === 'claude_code'
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

function resolveExecutionReplMode(args: {
  replMode?: ReplMode
  permissionMode?: PermissionMode
}): ReplMode | undefined {
  const mappedPermissionMode = (() => {
    if (!args.permissionMode) return undefined
    if (args.permissionMode === 'dontAsk' || args.permissionMode === 'bypassPermissions') {
      throw new Error(
        `options.permissionMode (${args.permissionMode}) is not supported in Formax SDK yet`,
      )
    }
    return SUPPORTED_PERMISSION_MODE_TO_REPL_MODE[args.permissionMode]
  })()

  if (args.replMode && mappedPermissionMode && args.replMode !== mappedPermissionMode) {
    throw new Error(
      `options.replMode (${args.replMode}) conflicts with options.permissionMode (${args.permissionMode} -> ${mappedPermissionMode})`,
    )
  }

  return args.replMode ?? mappedPermissionMode
}

function mapThinkingConfigToEnabled(thinking?: ThinkingConfig): boolean | undefined {
  if (!thinking) return undefined
  if (thinking.type === 'enabled') return true
  if (thinking.type === 'disabled') return false
  // `adaptive` keeps runtime default behavior.
  return undefined
}

function resolveThinkingEnabled(args: {
  thinking?: ThinkingConfig
  maxThinkingTokens?: number
  thinkingEnabled?: boolean
}): boolean | undefined {
  const mappedThinking = mapThinkingConfigToEnabled(args.thinking)
  const hasThinkingOption = args.thinking !== undefined
  const mappedMaxThinkingTokens =
    args.maxThinkingTokens === undefined || hasThinkingOption
      ? undefined
      : args.maxThinkingTokens > 0
  if (
    mappedThinking !== undefined &&
    args.thinkingEnabled !== undefined &&
    args.thinkingEnabled !== mappedThinking
  ) {
    throw new Error(
      `options.thinkingEnabled (${String(args.thinkingEnabled)}) conflicts with options.thinking (${args.thinking?.type ?? 'unknown'})`,
    )
  }
  return args.thinkingEnabled ?? mappedThinking ?? mappedMaxThinkingTokens
}

function assertMaxTurnsSupported(maxTurns?: number): void {
  if (maxTurns === undefined) return
  if (maxTurns > 1) {
    throw new Error(
      `options.maxTurns (${maxTurns}) is not supported in Formax SDK yet (only maxTurns=1 is currently supported)`,
    )
  }
}

function assertMaxBudgetUsdSupported(maxBudgetUsd?: number): void {
  if (maxBudgetUsd === undefined) return
  throw new Error(
    `options.maxBudgetUsd (${maxBudgetUsd}) is not supported in Formax SDK yet`,
  )
}

function assertResumeOptionsSupported(args: {
  resume?: string
  sessionId?: string
  resumeSessionAt?: string
}): void {
  if (args.resume !== undefined) {
    throw new Error(
      `options.resume (${args.resume}) is not supported in Formax SDK yet`,
    )
  }
  if (args.sessionId !== undefined) {
    throw new Error(
      `options.sessionId (${args.sessionId}) is not supported in Formax SDK yet`,
    )
  }
  if (args.resumeSessionAt !== undefined) {
    throw new Error(
      `options.resumeSessionAt (${args.resumeSessionAt}) is not supported in Formax SDK yet`,
    )
  }
}

function toUserPromptMessage(prompt: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  }
}

function promptMessageToText(message: PromptMessage): string {
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      if ((block as { type?: unknown }).type !== 'text') return ''
      const text = (block as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Request aborted')
  }
}

async function nextAsyncIteratorWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  throwIfAborted(signal)

  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_resolve, reject) => {
        onAbort = () => reject(new Error('Request aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

async function resolvePromptInput(args: {
  prompt: QueryArgs['prompt']
  history: PromptMessage[]
  signal: AbortSignal
}): Promise<{ prompt: string; history: PromptMessage[] }> {
  if (typeof args.prompt === 'string') {
    return {
      prompt: args.prompt,
      history: args.history,
    }
  }

  const streamMessages: PromptMessage[] = []
  const iterator = args.prompt[Symbol.asyncIterator]()
  let completed = false

  try {
    while (true) {
      const next = await nextAsyncIteratorWithAbort(iterator, args.signal)
      if (next.done) {
        completed = true
        break
      }
      const rawMessage = next.value
      const parsedMessage = parseSDKUserMessageInput(rawMessage)
      streamMessages.push({
        role: 'user',
        content: parsedMessage.content.map((block) => ({
          type: 'text',
          text: block.text,
        })),
      })
    }
  } finally {
    if (!completed && typeof iterator.return === 'function') {
      try {
        const cleanup = iterator.return()
        if (cleanup && typeof (cleanup as Promise<unknown>).then === 'function') {
          void (cleanup as Promise<unknown>).catch(() => {})
        }
      } catch {
        // Best-effort cleanup for caller-provided async streams.
      }
    }
  }

  throwIfAborted(args.signal)

  if (streamMessages.length === 0) {
    throw new Error('Async prompt stream must yield at least one user message')
  }

  const lastMessage = streamMessages[streamMessages.length - 1]
  return {
    prompt: promptMessageToText(lastMessage),
    history: [...args.history, ...streamMessages.slice(0, -1)],
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

function extractLastStructuredOutputToolInput(
  history: PromptMessage[],
  startIndex = 0,
): { found: true; input: unknown } | { found: false } {
  const start = Number.isInteger(startIndex)
    ? Math.min(Math.max(startIndex, 0), history.length)
    : 0
  for (let idx = history.length - 1; idx >= start; idx -= 1) {
    const message = history[idx]
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (let blockIdx = message.content.length - 1; blockIdx >= 0; blockIdx -= 1) {
      const block = message.content[blockIdx]
      if (!block || typeof block !== 'object') continue
      if ((block as { type?: unknown }).type !== 'tool_use') continue
      const name = (block as { name?: unknown }).name
      if (name !== STRUCTURED_OUTPUT_TOOL_NAME) continue
      return {
        found: true,
        input: (block as { input?: unknown }).input,
      }
    }
  }

  return { found: false }
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

function combineOptionalSignals(
  signalA: AbortSignal | undefined,
  signalB: AbortSignal | undefined,
): AbortSignal | undefined {
  if (signalA && signalB) return combineSignals(signalA, signalB)
  return signalA ?? signalB
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
  interceptExecuteTool?: (call: unknown) => Promise<unknown | null> | unknown | null
}): (() => void) | null {
  const client = args.runtime.client as { streamOnce?: unknown }
  const original = client.streamOnce
  if (typeof original !== 'function') return null

  ;(client as { streamOnce: unknown }).streamOnce = async (...streamArgs: unknown[]) => {
    let methodArgs = streamArgs
    const firstArg = streamArgs[0]
    if (
      args.interceptExecuteTool &&
      firstArg &&
      typeof firstArg === 'object' &&
      !Array.isArray(firstArg) &&
      typeof (firstArg as { executeTool?: unknown }).executeTool === 'function'
    ) {
      const originalExecuteTool = (firstArg as { executeTool: (call: unknown) => Promise<unknown> }).executeTool
      const wrappedExecuteTool = async (call: unknown): Promise<unknown> => {
        const intercepted = await args.interceptExecuteTool!(call)
        if (intercepted != null) return intercepted
        return await originalExecuteTool(call)
      }
      const patchedFirstArg = {
        ...(firstArg as Record<string, unknown>),
        executeTool: wrappedExecuteTool,
      }
      methodArgs = [patchedFirstArg, ...streamArgs.slice(1)]
    }

    const out = await (original as (...methodArgs: unknown[]) => Promise<any>).call(client, ...methodArgs)
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
  outputFormatEnabled?: boolean
}): string[] | undefined {
  const merged = new Set(args.disallowedTools ?? [])
  if (!args.interactive) {
    // Without an answer submission API, AskUserQuestion would deadlock.
    merged.add('AskUserQuestion')
  }
  if (args.outputFormatEnabled) {
    // StructuredOutput is an internal synthetic tool used by SDK outputFormat.
    merged.delete(STRUCTURED_OUTPUT_TOOL_NAME)
  }
  return merged.size > 0 ? [...merged] : undefined
}

function normalizeAllowedTools(args: {
  allowedTools?: string[]
  outputFormatEnabled?: boolean
}): string[] | undefined {
  if (!args.allowedTools) return undefined
  const merged = new Set(args.allowedTools)
  if (args.outputFormatEnabled && !merged.has('*')) {
    merged.add(STRUCTURED_OUTPUT_TOOL_NAME)
  }
  return [...merged]
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

export function query(args: QueryArgs): Query {
  const interruptController = new AbortController()
  const iterator = runQuery(args, interruptController)
  const queryIterator = iterator as Query
  const abortQuery = () => {
    interruptController.abort()
  }
  queryIterator.interrupt = async () => {
    abortQuery()
  }
  queryIterator.close = () => {
    abortQuery()
  }
  return queryIterator
}

async function* runQuery(
  args: QueryArgs,
  interruptController: AbortController,
): AsyncGenerator<QueryMessage, void, unknown> {
  const sessionId = randomUUID()
  const startedAt = Date.now()
  const queue = createAsyncIteratorQueue<QueryMessage>()
  const controller = interruptController
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
      const outputFormat = options.outputFormat
      messageCallback = options.onMessage
      const cwd = path.resolve(options.cwd ?? process.cwd())
      const env = options.env ?? process.env
      const replMode = resolveExecutionReplMode({
        replMode: options.replMode,
        permissionMode: options.permissionMode,
      })
      assertMaxTurnsSupported(options.maxTurns)
      assertMaxBudgetUsdSupported(options.maxBudgetUsd)
      assertResumeOptionsSupported({
        resume: options.resume,
        sessionId: options.sessionId,
        resumeSessionAt: options.resumeSessionAt,
      })
      const thinkingEnabled = resolveThinkingEnabled({
        thinking: options.thinking,
        maxThinkingTokens: options.maxThinkingTokens,
        thinkingEnabled: options.thinkingEnabled,
      })
      const externalSignal = combineOptionalSignals(options.signal, options.abortController?.signal)
      runSignal = combineSignals(externalSignal, controller.signal)
      const baseHistory = cloneHistory(parsedArgs.history)
      const normalizedPrompt = await resolvePromptInput({
        prompt: parsedArgs.prompt,
        history: baseHistory,
        signal: runSignal,
      })
      const history = normalizedPrompt.history
      nextHistory = history
      const interactive = options.interactive === true
      const allowTools = normalizeAllowedTools({
        allowedTools: options.allowedTools,
        outputFormatEnabled: outputFormat?.type === 'json_schema',
      })
      const disallowedTools = normalizeDisallowedTools({
        interactive,
        disallowedTools: options.disallowedTools,
        outputFormatEnabled: outputFormat?.type === 'json_schema',
      })

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
        interceptExecuteTool:
          outputFormat?.type === 'json_schema'
            ? async (call) => {
                if (!isStructuredOutputToolCall(call)) return null
                return {
                  tool_use_id: call.id,
                  content: 'Structured output accepted.',
                  is_error: false,
                }
              }
            : undefined,
      })

      const filteredTools = filterToolsForQuery({
        tools: patchToolsForTurn(runtime.tools, cwd),
        allowedTools: allowTools,
        disallowedTools,
      })
      const tools = parseToolDefinitions(
        outputFormat?.type === 'json_schema'
          ? [...filteredTools, buildStructuredOutputToolDefinition(outputFormat.schema)]
          : filteredTools,
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
      const systemOverride = isSystemPromptPresetInput(options.systemPrompt)
        ? []
        : normalizePromptInput(options.systemPrompt)
      const presetAppend = isSystemPromptPresetInput(options.systemPrompt)
        ? normalizePromptInput(options.systemPrompt)
        : []
      const appendSystem = normalizePromptInput(options.appendSystemPrompt)
      const system = [
        ...(systemOverride.length > 0 ? systemOverride : defaultSystem),
        ...presetAppend,
        ...appendSystem,
      ]
      if (outputFormat?.type === 'json_schema') {
        system.push({
          type: 'text',
          text: buildStructuredOutputSystemPrompt(outputFormat.schema),
          cache_control: { type: 'ephemeral' },
        })
      }

      const onEvent = (event: StreamEvent) => {
        const parsedEvent = parseStreamEvent(event)

        if (parsedEvent.type === 'usage') {
          usageEventCount += 1
          mergeUsageTotals(eventUsageTotals, parsedEvent.usage)
          lastStepUsage = parsedEvent.usage
          if (parsedEvent.model) usageModel = parsedEvent.model
        }

        handleInputRequestEvent({
          event: parsedEvent,
          sessionId,
          emitMessage: (message) =>
            emitMessage({
              emit: queue.push,
              callback: options.onMessage,
              message,
            }),
          onInputRequest: options.onInputRequest,
          userInputManager: runtime?.userInputManager,
          addPendingResolution: (task) => {
            pendingInputResolutions.add(task)
            void task.finally(() => {
              pendingInputResolutions.delete(task)
            })
          },
        })

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

      const outputMaxRetries =
        outputFormat?.type === 'json_schema' ? Math.max(0, outputFormat.maxRetries ?? 0) : 0
      let currentHistory = history
      let currentPrompt = normalizedPrompt.prompt
      let lastStructuredValidationError: string | null = null
      let structuredOutputValue: unknown
      let assistantBlocks: { text: string; blocks: PromptBlock[] } | null = null
      let assistantMessage: AssistantMessage | null = null
      let didStructuredOutputFail = false

      for (let attempt = 0; attempt <= outputMaxRetries; attempt += 1) {
        nextHistory = await runtime.engine.runTurn({
          history: currentHistory,
          user: toUserPromptMessage(currentPrompt),
          system,
          tools,
          onEvent,
          cwd,
          signal: runSignal,
          model,
          thinkingEnabled: thinkingEnabled ?? runtime.cfg.llm.thinkingMode,
          exec: {
            interactive,
            replMode,
            ...(allowTools ? { allowTools } : {}),
            ...(disallowedTools ? { denyTools: disallowedTools } : {}),
          },
        })

        nextHistory = parsePromptHistory(nextHistory)
        assistantBlocks = extractLastAssistantMessage(nextHistory)

        if (!(outputFormat?.type === 'json_schema')) {
          break
        }

        const structuredToolResult = extractLastStructuredOutputToolInput(
          nextHistory,
          currentHistory.length,
        )
        if (structuredToolResult.found) {
          const validated = validateStructuredOutputValue({
            schema: outputFormat.schema,
            value: structuredToolResult.input,
          })
          if (validated.ok === true) {
            structuredOutputValue = validated.value
            lastStructuredValidationError = null
            break
          } else {
            lastStructuredValidationError = validated.error
          }
        } else if (!assistantBlocks) {
          lastStructuredValidationError = 'Model returned no assistant text for structured output'
        } else {
          const parsedStructured = parseAndValidateStructuredOutput({
            schema: outputFormat.schema,
            text: assistantBlocks.text,
          })
          if (parsedStructured.ok === true) {
            structuredOutputValue = parsedStructured.value
            lastStructuredValidationError = null
            break
          } else {
            lastStructuredValidationError = parsedStructured.error
          }
        }

        if (attempt >= outputMaxRetries) {
          didStructuredOutputFail = true
          break
        }

        currentHistory = nextHistory
        currentPrompt = buildStructuredOutputRetryPrompt({
          schema: outputFormat.schema,
          validationError: lastStructuredValidationError || 'unknown validation error',
        })
      }

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
        subtype: didStructuredOutputFail ? 'error_max_structured_output_retries' : 'success',
        stop_reason: lastStopReason,
        result: assistantMessage?.text ?? '',
        usage,
        ...(usageModel ? { model: usageModel } : {}),
        assistant: assistantMessage,
        ...(structuredOutputValue !== undefined ? { structured_output: structuredOutputValue } : {}),
        history: nextHistory,
        duration_ms: Math.max(0, Date.now() - startedAt),
        ...(didStructuredOutputFail
          ? {
              error:
                lastStructuredValidationError || 'Unable to produce valid structured output before retry limit',
            }
          : {}),
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
