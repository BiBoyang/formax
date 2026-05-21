import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createSlashCommandRegistry } from '../../features/commands/registry.js'
import { getDefaultModels, inferModelMetadata } from '../../core/models/models.js'
import type { RuntimeBundle } from '../../runtime/createRuntime.js'
import { createRuntime } from '../../runtime/createRuntime.js'
import type { ContextBudgetConfig } from '../../chat/context/budget.js'
import { getKnownContextWindowTokens } from '../../chat/context/modelWindow.js'
import { prepareTurnRequestProjection } from '../../chat/context/turnRequestProjection.js'
import { isAnthropicCacheEditingEnabled } from '../../chat/context/cacheEditing.js'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  appendContextCollapseStoreEntry,
  createContextCollapseCommittedEntry,
  requestHistoryContainsExactMessage,
  type ContextCollapseStoreSnapshot,
} from '../../chat/context/contextCollapseStore.js'
import { readContextCollapseStoreSnapshotFromSession } from '../../features/repl/sessionSave/contextCollapseStoreEvents.js'
import { buildSystemPrompt, resolveSystemPromptVariant } from '../../prompts/system.js'
import type { PromptBlock, PromptMessage } from '../../prompts/index.js'
import type { StopReason, StreamEvent, TokenUsage } from '../../streaming/types.js'
import {
  patchToolsForTurnWithSkillDescriptions,
  resolveDeferredToolExposureForTurn,
} from '../../tools/runtime/deferredToolExposureResolver.js'
import type { ReplMode } from '../../tools/executor/index.js'
import type { ToolDefinition } from '../../tools/types.js'
import { AbortError } from '../errors.js'
import type {
  AccountInfo,
  AgentInfo,
  AssistantMessage,
  PermissionMode,
  Query,
  QueryArgs,
  QueryOptions,
  QueryMessage,
  SlashCommand,
  ModelInfo,
  ResultMessage,
  SystemMessage,
  ThinkingConfig,
  SystemPromptPresetInput,
  SystemPromptInput,
} from '../types.js'
import {
  asValidationError,
  parseAccountInfoOutput,
  parseAgentInfoListOutput,
  parseModelInfoListOutput,
  parsePromptHistory,
  parseQueryArgsInput,
  parseSlashCommandListOutput,
  parseSDKUserMessageInput,
  parseStopReason,
  parseStreamEvent,
  parseTokenUsage,
  parseToolDefinitions,
} from '../validation.js'
import { handleInputRequestEvent } from './inputRequests.js'
import { resolveQueryResumeResolution } from './resume.js'
import {
  initializeQuerySessionPersistence,
  persistQueryTurn,
  shutdownQuerySessionPersistence,
  type QuerySessionPersistence,
} from './persistence.js'
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
  'cache_deleted_input_tokens',
]

const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput'
const STRUCTURED_OUTPUT_TOOL_DESCRIPTION =
  'Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output.'

const SUPPORTED_PERMISSION_MODE_TO_REPL_MODE: Record<'default' | 'acceptEdits' | 'plan', ReplMode> = {
  default: 'normal',
  acceptEdits: 'acceptEdits',
  plan: 'plan',
}
const VALID_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions',
])

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

function selectToolsForQuery(args: {
  tools: ToolDefinition[]
  toolsOption?: QueryOptions['tools']
}): ToolDefinition[] {
  if (args.toolsOption === undefined) return args.tools
  if (!Array.isArray(args.toolsOption)) return args.tools
  if (args.toolsOption.length === 0) return []

  const requestedNames = Array.from(
    new Set(args.toolsOption.map((value) => String(value).trim()).filter(Boolean)),
  )
  if (requestedNames.length === 0) return []

  if (requestedNames.includes('default')) {
    if (requestedNames.length !== 1) {
      throw new Error(
        `options.tools cannot combine "default" with explicit tool names (${requestedNames.join(', ')})`,
      )
    }
    return args.tools
  }

  const availableByName = new Map(args.tools.map((tool) => [tool.name, tool] as const))
  const selected: ToolDefinition[] = []
  const unknown: string[] = []
  for (const name of requestedNames) {
    const found = availableByName.get(name)
    if (!found) {
      unknown.push(name)
      continue
    }
    if (selected.some((tool) => tool.name === name)) continue
    selected.push(found)
  }

  if (unknown.length > 0) {
    throw new Error(`options.tools includes unsupported tool(s): ${unknown.join(', ')}`)
  }
  return selected
}

function resolveExecutionReplMode(args: {
  replMode?: ReplMode
  permissionMode?: PermissionMode
}): ReplMode | undefined {
  const mappedPermissionMode = (() => {
    if (!args.permissionMode) return undefined
    if (args.permissionMode === 'dontAsk' || args.permissionMode === 'bypassPermissions') {
      return undefined
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
  void maxTurns
}

function assertMaxBudgetUsdSupported(maxBudgetUsd?: number): void {
  void maxBudgetUsd
}

function assertEffortOptionSupported(effort?: 'low' | 'medium' | 'high' | 'max'): void {
  void effort
}

function assertDebugOptionsSupported(args: {
  debug?: boolean
  debugFile?: string
}): void {
  void args
}

function resolveRuntimeEnv(args: {
  env: NodeJS.ProcessEnv
  debug?: boolean
}): NodeJS.ProcessEnv {
  if (args.debug !== true) return args.env
  return {
    ...args.env,
    FORMAX_HOOKS_DEBUG: '1',
  }
}

function resolveDebugFilePath(args: {
  cwd: string
  debugFile?: string
}): string | null {
  const raw = String(args.debugFile ?? '').trim()
  if (!raw) return null
  return path.resolve(args.cwd, raw)
}

async function appendDebugFileLine(debugFilePath: string | null, line: string): Promise<void> {
  if (!debugFilePath) return
  try {
    await fs.mkdir(path.dirname(debugFilePath), { recursive: true })
    await fs.appendFile(
      debugFilePath,
      `${new Date().toISOString()} ${line}\n`,
      'utf8',
    )
  } catch {
    // Debug-file logging should never break query execution.
  }
}

function emitStderr(stderr: ((data: string) => void) | undefined, data: string): void {
  if (!stderr) return
  try {
    stderr(data)
  } catch {
    // Ignore stderr callback failures to keep query execution stable.
  }
}

function assertProcessSpawnOptionsSupported(args: {
  pathToClaudeCodeExecutable?: string
  spawnClaudeCodeProcess?: (...spawnArgs: unknown[]) => unknown
}): void {
  void args
}

function assertCliExecutionOptionsSupported(args: {
  executable?: 'bun' | 'deno' | 'node'
  executableArgs?: string[]
  extraArgs?: Record<string, string | null>
  betas?: string[]
}): void {
  void args
}

function assertPermissionPromptOptionsSupported(args: {
  allowDangerouslySkipPermissions?: boolean
  permissionPromptToolName?: string
  promptSuggestions?: boolean
}): void {
  if (args.allowDangerouslySkipPermissions === true) {
    throw new Error(
      `options.allowDangerouslySkipPermissions (${args.allowDangerouslySkipPermissions}) is not supported in Formax SDK yet`,
    )
  }
  void args.permissionPromptToolName
  void args.promptSuggestions
}

function assertContinuationOptionsSupported(args: {
  fallbackModel?: string
}): void {
  void args
}

function assertStrictMcpConfigSupported(strictMcpConfig?: boolean): void {
  if (strictMcpConfig === undefined) return
  throw new Error(
    `options.strictMcpConfig (${strictMcpConfig}) is not supported in Formax SDK yet`,
  )
}

function assertFilesystemSandboxOptionsSupported(args: {
  additionalDirectories?: string[]
  sandbox?: unknown
}): void {
  void args.additionalDirectories
  if (args.sandbox !== undefined) {
    throw new Error('options.sandbox is not supported in Formax SDK yet')
  }
}

function assertAgentOptionsSupported(args: {
  agent?: string
  agents?: Record<string, unknown>
}): void {
  void args
}

function assertToolsAndMcpOptionsSupported(args: {
  mcpServers?: Record<string, unknown>
}): void {
  if (args.mcpServers !== undefined) {
    throw new Error('options.mcpServers is not supported in Formax SDK yet')
  }
}

function assertHookAndToolPermissionOptionsSupported(args: {
  hooks?: Record<string, unknown>
}): void {
  if (args.hooks !== undefined) {
    throw new Error('options.hooks is not supported in Formax SDK yet')
  }
}

function assertPluginAndElicitationOptionsSupported(args: {
  plugins?: unknown[]
  settingSources?: Array<'user' | 'project' | 'local'>
  onElicitation?: (...elicitationArgs: unknown[]) => unknown
}): void {
  void args.plugins
  void args.settingSources
  void args.onElicitation
}

function toUserPromptMessage(prompt: string, injectedBlocks: PromptBlock[] = []): PromptMessage {
  return {
    role: 'user',
    content: [...injectedBlocks, { type: 'text', text: prompt }],
  }
}

function stripInjectedBlocksFromHistory(history: PromptMessage[], userIndex: number, injectedCount: number): PromptMessage[] {
  if (injectedCount <= 0) return history
  const message = history[userIndex]
  if (!message || message.role !== 'user' || !Array.isArray(message.content)) return history
  if (message.content.length <= injectedCount) return history

  const stripped: PromptMessage = {
    ...message,
    content: message.content.slice(injectedCount),
  }
  return [...history.slice(0, userIndex), stripped, ...history.slice(userIndex + 1)]
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

function resolvePromptBudgetConfig(args: { runtime: RuntimeBundle; model: string }): ContextBudgetConfig | null {
  const contextWindowTokens =
    args.runtime.cfg.llm.contextWindowTokens ??
    getKnownContextWindowTokens({
      provider: args.runtime.cfg.llm.provider,
      model: args.model,
    })
  if (!contextWindowTokens) return null

  return {
    contextWindowTokens,
    effectiveContextWindowPercent: args.runtime.cfg.context.effectiveContextWindowPercent,
    autoCompactLimitPercent: args.runtime.cfg.context.autoCompactTokenLimitPercent,
    baselineTokens: args.runtime.cfg.context.baselineTokens,
  }
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

type QueryControlState = {
  started: boolean
  initSettled: boolean
  initializationPromise: Promise<SystemMessage>
  resolveInitialization: (value: SystemMessage) => void
  rejectInitialization: (reason: unknown) => void
  hasModelOverride: boolean
  modelOverride?: string
  hasPermissionModeOverride: boolean
  permissionModeOverride?: PermissionMode
  hasMaxThinkingTokensOverride: boolean
  maxThinkingTokensOverride: number | null
}

function assertCanMutateQueryControls(state: QueryControlState, methodName: string): void {
  if (!state.started) return
  throw new Error(`${methodName} is only supported before query iteration starts in Formax SDK`)
}

function applyQueryControlOverrides(
  options: QueryOptions,
  state: QueryControlState,
): QueryOptions {
  const next: QueryOptions = { ...options }
  if (state.hasModelOverride) {
    if (state.modelOverride === undefined) {
      delete next.model
    } else {
      next.model = state.modelOverride
    }
  }
  if (state.hasPermissionModeOverride) {
    next.permissionMode = state.permissionModeOverride
  }
  if (state.hasMaxThinkingTokensOverride) {
    if (state.maxThinkingTokensOverride === null) {
      delete next.maxThinkingTokens
    } else {
      next.maxThinkingTokens = state.maxThinkingTokensOverride
    }
  }
  return next
}

function resolveInitializationOnce(state: QueryControlState, message: SystemMessage): void {
  if (state.initSettled) return
  state.initSettled = true
  state.resolveInitialization(message)
}

function rejectInitializationOnce(state: QueryControlState, error: unknown): void {
  if (state.initSettled) return
  state.initSettled = true
  state.rejectInitialization(error)
}

function toAbortError(error: unknown, fallbackMessage: string): AbortError {
  if (error instanceof AbortError) return error
  if (error instanceof Error && error.message) return new AbortError(error.message)
  return new AbortError(fallbackMessage)
}

async function listSupportedCommands(args: QueryArgs, state: QueryControlState): Promise<SlashCommand[]> {
  try {
    const parsedArgs = parseQueryArgsInput(args)
    const options = applyQueryControlOverrides({ ...(parsedArgs.options ?? {}) }, state)
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const commands = createSlashCommandRegistry({ cwd })
      .list()
      .map((spec) => ({
        name: spec.command,
        command: spec.command,
        description: spec.description,
        source: spec.source,
        ...(spec.argHint
          ? {
              argumentHint: spec.argHint,
              argHint: spec.argHint,
            }
          : {}),
        ...(spec.implemented === undefined ? {} : { implemented: spec.implemented }),
      }))
    return parseSlashCommandListOutput(commands)
  } catch (error) {
    throw asValidationError(
      error,
      'Invalid query arguments or command output for query.supportedCommands',
    )
  }
}

async function listSupportedAgents(args: QueryArgs, state: QueryControlState): Promise<AgentInfo[]> {
  try {
    const parsedArgs = parseQueryArgsInput(args)
    const options = applyQueryControlOverrides({ ...(parsedArgs.options ?? {}) }, state)
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const env = options.env ?? process.env
    const runtime = await createRuntime({ cwd, env })
    const agents = runtime.allowedSubagents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      ...(typeof agent.model === 'string' && agent.model.trim().length > 0
        ? { model: agent.model.trim() }
        : {}),
    }))
    return parseAgentInfoListOutput(agents)
  } catch (error) {
    throw asValidationError(
      error,
      'Invalid query arguments or agent output for query.supportedAgents',
    )
  }
}

async function listSupportedModels(args: QueryArgs, state: QueryControlState): Promise<ModelInfo[]> {
  try {
    const parsedArgs = parseQueryArgsInput(args)
    const options = applyQueryControlOverrides({ ...(parsedArgs.options ?? {}) }, state)
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const env = options.env ?? process.env
    const runtime = await createRuntime({ cwd, env })
    const provider = String(runtime.cfg.llm.provider)
    const activeModel = String(runtime.cfg.llm.model || '').trim()
    const defaultModels = getDefaultModels(provider).map((model) => ({
      model: model.model,
      provider: model.provider,
      value: model.model,
      displayName: model.model,
      description: `${model.provider} model`,
      ...(model.supports_reasoning_effort === undefined
        ? {}
        : {
            supportsEffort: model.supports_reasoning_effort,
            supportsAdaptiveThinking: model.supports_reasoning_effort,
            ...(model.supports_reasoning_effort
              ? { supportedEffortLevels: ['low', 'medium', 'high', 'max'] as const }
              : {}),
          }),
      ...(model.max_tokens === undefined ? {} : { max_tokens: model.max_tokens }),
      ...(model.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: model.contextWindowTokens }),
      ...(model.supports_reasoning_effort === undefined
        ? {}
        : { supports_reasoning_effort: model.supports_reasoning_effort }),
      ...(model.supports_vision === undefined ? {} : { supports_vision: model.supports_vision }),
      ...(model.supports_function_calling === undefined
        ? {}
        : { supports_function_calling: model.supports_function_calling }),
    }))
    if (activeModel.length > 0 && !defaultModels.some((model) => model.model === activeModel)) {
      const inferredModelMetadata = inferModelMetadata({
        provider,
        model: activeModel,
      })
      const inferredSupportsReasoningEffort = inferredModelMetadata?.supports_reasoning_effort
      defaultModels.unshift({
        model: activeModel,
        provider,
        value: activeModel,
        displayName: activeModel,
        description: `${provider} model`,
        ...(inferredModelMetadata?.max_tokens === undefined
          ? {}
          : { max_tokens: inferredModelMetadata.max_tokens }),
        ...(inferredModelMetadata?.contextWindowTokens === undefined
          ? {}
          : { contextWindowTokens: inferredModelMetadata.contextWindowTokens }),
        ...(inferredModelMetadata?.supports_vision === undefined
          ? {}
          : { supports_vision: inferredModelMetadata.supports_vision }),
        ...(inferredModelMetadata?.supports_function_calling === undefined
          ? {}
          : { supports_function_calling: inferredModelMetadata.supports_function_calling }),
        ...(inferredSupportsReasoningEffort === undefined
          ? {}
          : {
              supportsEffort: inferredSupportsReasoningEffort,
              supportsAdaptiveThinking: inferredSupportsReasoningEffort,
              ...(inferredSupportsReasoningEffort
                ? { supportedEffortLevels: ['low', 'medium', 'high', 'max'] as const }
                : {}),
              supports_reasoning_effort: inferredSupportsReasoningEffort,
            }),
      })
    }
    return parseModelInfoListOutput(defaultModels)
  } catch (error) {
    throw asValidationError(
      error,
      'Invalid query arguments or model output for query.supportedModels',
    )
  }
}

async function queryAccountInfo(args: QueryArgs, state: QueryControlState): Promise<AccountInfo> {
  try {
    const parsedArgs = parseQueryArgsInput(args)
    const options = applyQueryControlOverrides({ ...(parsedArgs.options ?? {}) }, state)
    const cwd = path.resolve(options.cwd ?? process.cwd())
    const env = options.env ?? process.env
    const runtime = await createRuntime({ cwd, env })
    const model = String(options.model || runtime.cfg.llm.model || '').trim() || runtime.cfg.llm.model
    const apiKey = String(runtime.cfg.llm.apiKey || '').trim()
    const hasApiKey = apiKey.length > 0
    const inferTokenSource = (): 'env' | 'config' | undefined => {
      if (!hasApiKey) return undefined
      const configuredEnvApiKey = String(env.FORMAX_API_KEY || '').trim()
      if (configuredEnvApiKey && configuredEnvApiKey === apiKey) return 'env'
      return 'config'
    }
    const tokenSource = inferTokenSource()
    const apiKeySource = tokenSource ? (tokenSource === 'env' ? 'temporary' : 'user') : undefined
    return parseAccountInfoOutput({
      provider: runtime.cfg.llm.provider,
      model,
      ...(runtime.cfg.llm.baseUrl ? { baseUrl: runtime.cfg.llm.baseUrl } : {}),
      hasApiKey,
      ...(tokenSource ? { tokenSource } : {}),
      ...(apiKeySource ? { apiKeySource } : {}),
    })
  } catch (error) {
    throw asValidationError(
      error,
      'Invalid query arguments or account output for query.accountInfo',
    )
  }
}

export function query(args: QueryArgs): Query {
  const interruptController = new AbortController()
  let resolveInitialization: (value: SystemMessage) => void = () => {}
  let rejectInitialization: (reason: unknown) => void = () => {}
  const initializationPromise = new Promise<SystemMessage>((resolve, reject) => {
    resolveInitialization = resolve
    rejectInitialization = reject
  })
  // Most callers do not consume initializationResult(); prevent unhandled rejection noise
  // while preserving rejection semantics for explicit awaiters.
  void initializationPromise.catch(() => {})
  const controlState: QueryControlState = {
    started: false,
    initSettled: false,
    initializationPromise,
    resolveInitialization,
    rejectInitialization,
    hasModelOverride: false,
    modelOverride: undefined,
    hasPermissionModeOverride: false,
    permissionModeOverride: undefined,
    hasMaxThinkingTokensOverride: false,
    maxThinkingTokensOverride: null,
  }
  const iterator = runQuery(args, interruptController, controlState)
  const queryIterator = iterator as Query
  const abortQuery = (methodName: 'query.close' | 'query.interrupt' | 'query.stopTask') => {
    interruptController.abort()
    if (!controlState.started) {
      rejectInitializationOnce(
        controlState,
        new AbortError(`${methodName} was called before query iteration started`),
      )
    }
  }
  queryIterator.interrupt = async () => {
    abortQuery('query.interrupt')
  }
  queryIterator.close = () => {
    abortQuery('query.close')
  }
  queryIterator.initializationResult = async () => controlState.initializationPromise
  queryIterator.supportedCommands = async () => listSupportedCommands(args, controlState)
  queryIterator.supportedAgents = async () => listSupportedAgents(args, controlState)
  queryIterator.supportedModels = async () => listSupportedModels(args, controlState)
  queryIterator.accountInfo = async () => queryAccountInfo(args, controlState)
  queryIterator.mcpServerStatus = async () => {
    throw new Error('query.mcpServerStatus is not supported in Formax SDK yet')
  }
  queryIterator.setMcpServers = async () => {
    throw new Error('query.setMcpServers is not supported in Formax SDK yet')
  }
  queryIterator.reconnectMcpServer = async () => {
    throw new Error('query.reconnectMcpServer is not supported in Formax SDK yet')
  }
  queryIterator.toggleMcpServer = async () => {
    throw new Error('query.toggleMcpServer is not supported in Formax SDK yet')
  }
  queryIterator.streamInput = async () => {
    throw new Error('query.streamInput is not supported in Formax SDK yet')
  }
  queryIterator.stopTask = async () => {
    abortQuery('query.stopTask')
  }
  queryIterator.rewindFiles = async () => {
    return {
      canRewind: false,
      error: 'query.rewindFiles is not supported in Formax SDK yet',
    }
  }
  queryIterator.setModel = async (model?: string) => {
    assertCanMutateQueryControls(controlState, 'query.setModel')
    controlState.hasModelOverride = true
    controlState.modelOverride = model
  }
  queryIterator.setPermissionMode = async (mode: PermissionMode) => {
    assertCanMutateQueryControls(controlState, 'query.setPermissionMode')
    if (!VALID_PERMISSION_MODES.has(mode)) {
      throw new Error(
        `query.setPermissionMode expects one of ${Array.from(VALID_PERMISSION_MODES).join(', ')} (received ${String(mode)})`,
      )
    }
    controlState.hasPermissionModeOverride = true
    controlState.permissionModeOverride = mode
  }
  queryIterator.setMaxThinkingTokens = async (maxThinkingTokens: number | null) => {
    assertCanMutateQueryControls(controlState, 'query.setMaxThinkingTokens')
    if (
      maxThinkingTokens !== null &&
      (!Number.isFinite(maxThinkingTokens) ||
        !Number.isInteger(maxThinkingTokens) ||
        maxThinkingTokens < 0)
    ) {
      throw new Error(
        `query.setMaxThinkingTokens expects a non-negative integer or null (received ${String(maxThinkingTokens)})`,
      )
    }
    controlState.hasMaxThinkingTokensOverride = true
    controlState.maxThinkingTokensOverride = maxThinkingTokens
  }
  return queryIterator
}

async function* runQuery(
  args: QueryArgs,
  interruptController: AbortController,
  controlState: QueryControlState,
): AsyncGenerator<QueryMessage, void, unknown> {
  let sessionId: string = randomUUID()
  const startedAt = Date.now()
  const queue = createAsyncIteratorQueue<QueryMessage>()
  const controller = interruptController
  let runSignal: AbortSignal = controller.signal

  const run = (async () => {
    controlState.started = true
    let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null
    let restorePatchedStreamOnce: (() => void) | null = null
    let sessionPersistence: QuerySessionPersistence | null = null
    let messageCallback: ((message: QueryMessage) => void) | undefined
    let stderrCallback: ((data: string) => void) | undefined
    let debugFilePath: string | null = null
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
      if (
        rawOptions &&
        typeof rawOptions === 'object' &&
        !Array.isArray(rawOptions) &&
        typeof (rawOptions as { stderr?: unknown }).stderr === 'function'
      ) {
        stderrCallback = (rawOptions as { stderr: (data: string) => void }).stderr
      }

      const parsedArgs = parseQueryArgsInput(args)
      const options = applyQueryControlOverrides({ ...(parsedArgs.options ?? {}) }, controlState)
      const outputFormat = options.outputFormat
      messageCallback = options.onMessage
      stderrCallback = options.stderr
      const cwd = path.resolve(options.cwd ?? process.cwd())
      debugFilePath = resolveDebugFilePath({
        cwd,
        debugFile: options.debugFile,
      })
      const env = resolveRuntimeEnv({
        env: options.env ?? process.env,
        debug: options.debug,
      })
      const replMode = resolveExecutionReplMode({
        replMode: options.replMode,
        permissionMode: options.permissionMode,
      })
      assertEffortOptionSupported(options.effort)
      assertMaxTurnsSupported(options.maxTurns)
      assertMaxBudgetUsdSupported(options.maxBudgetUsd)
      assertDebugOptionsSupported({
        debug: options.debug,
        debugFile: options.debugFile,
      })
      await appendDebugFileLine(debugFilePath, `query.start cwd=${cwd}`)
      assertProcessSpawnOptionsSupported({
        pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
        spawnClaudeCodeProcess: options.spawnClaudeCodeProcess,
      })
      assertCliExecutionOptionsSupported({
        executable: options.executable,
        executableArgs: options.executableArgs,
        extraArgs: options.extraArgs,
        betas: options.betas,
      })
      assertPermissionPromptOptionsSupported({
        allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
        permissionPromptToolName: options.permissionPromptToolName,
        promptSuggestions: options.promptSuggestions,
      })
      assertContinuationOptionsSupported({
        fallbackModel: options.fallbackModel,
      })
      assertStrictMcpConfigSupported(options.strictMcpConfig)
      assertFilesystemSandboxOptionsSupported({
        additionalDirectories: options.additionalDirectories,
        sandbox: options.sandbox,
      })
      assertAgentOptionsSupported({
        agent: options.agent,
        agents: options.agents,
      })
      assertToolsAndMcpOptionsSupported({
        mcpServers: options.mcpServers,
      })
      assertHookAndToolPermissionOptionsSupported({
        hooks: options.hooks,
      })
      assertPluginAndElicitationOptionsSupported({
        plugins: options.plugins,
        settingSources: options.settingSources,
        onElicitation: options.onElicitation,
      })
      const resumeResolution = await resolveQueryResumeResolution({
        options,
        cwd,
        env,
        replMode,
      })
      if (resumeResolution.sessionId !== null) {
        sessionId = resumeResolution.sessionId
      }
      const thinkingEnabled = resolveThinkingEnabled({
        thinking: options.thinking,
        maxThinkingTokens: options.maxThinkingTokens,
        thinkingEnabled: options.thinkingEnabled,
      })
      const externalSignal = combineOptionalSignals(options.signal, options.abortController?.signal)
      runSignal = combineSignals(externalSignal, controller.signal)
      const getPatchedRuntimeTools = (runtimeBundle: RuntimeBundle): ToolDefinition[] =>
        patchToolsForTurnWithSkillDescriptions({
          tools: runtimeBundle.tools,
          cwd,
          includeAvailableSkillsInDescription:
            runtimeBundle.runtimeFlags?.deferredToolExposureEnabled !== true,
        })
      if (Array.isArray(options.tools) && options.tools.length > 0) {
        runtime = await createRuntime({ cwd, env })
        // Validate tools early so invalid tool lists fail before async prompt stream consumption.
        void selectToolsForQuery({
          tools: getPatchedRuntimeTools(runtime),
          toolsOption: options.tools,
        })
      }
      const baseHistory = [...resumeResolution.history, ...cloneHistory(parsedArgs.history)]
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

      runtime = runtime ?? await createRuntime({ cwd, env })
      const model = String(options.model || runtime.cfg.llm.model || '').trim() || runtime.cfg.llm.model
      const shouldPersistSession =
        options.persistSession === true || options.enableFileCheckpointing === true

      sessionPersistence = await initializeQuerySessionPersistence({
        enabled: shouldPersistSession,
        sessionId,
        sessionFilePath: resumeResolution.sessionFilePath,
        cwd,
        env,
        model,
      })
      if (sessionPersistence) {
        sessionId = sessionPersistence.sessionId
      }

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

      const selectedTools = selectToolsForQuery({
        tools: getPatchedRuntimeTools(runtime),
        toolsOption: options.tools,
      })
      const filteredTools = filterToolsForQuery({
        tools: selectedTools,
        allowedTools: allowTools,
        disallowedTools,
      })
      const deferredToolExposureEnabled = runtime.runtimeFlags?.deferredToolExposureEnabled === true
      const toolExposure = resolveDeferredToolExposureForTurn({
        cwd,
        tools: filteredTools,
        deferredToolExposureEnabled,
        explicitSessionKey: sessionId,
        toolSearchEngine: runtime.runtimeFlags?.toolSearchEngine,
      })
      const structuredOutputTool =
        outputFormat?.type === 'json_schema'
          ? buildStructuredOutputToolDefinition(outputFormat.schema)
          : null
      const toolsForTurn = structuredOutputTool
        ? [...toolExposure.toolsForTurn, structuredOutputTool]
        : toolExposure.toolsForTurn
      const resolveToolsForCall = toolExposure.resolveToolsForCall
        ? () => {
            const resolved = toolExposure.resolveToolsForCall!()
            return structuredOutputTool ? [...resolved, structuredOutputTool] : resolved
          }
        : undefined
      const allowToolsForExec = allowTools
        ? (() => {
            if (!toolExposure.resolveToolsForCall) return allowTools
            const merged = new Set(allowTools)
            merged.add('ToolSearch')
            return [...merged]
          })()
        : undefined
      const tools = parseToolDefinitions(toolsForTurn)

      const initMessage: SystemMessage = {
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        cwd,
        model,
        tools,
      }
      resolveInitializationOnce(controlState, initMessage)
      emitMessage({
        emit: queue.push,
        callback: options.onMessage,
        message: initMessage,
      })

      const defaultSystem = buildSystemPrompt({
        allowedSubagents: runtime.allowedSubagents,
        cwd,
        model,
        variant: resolveSystemPromptVariant({ deferredToolExposureEnabled }),
      }, {
        env,
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
          canUseTool: options.canUseTool,
          onElicitation: options.onElicitation,
          userInputManager: runtime?.userInputManager,
          signal: runSignal,
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

      const resumeInjectedPromptBlocks = resumeResolution.nextTurnInjectedBlocks
      const injectedPromptBlocks = [...resumeInjectedPromptBlocks, ...toolExposure.injectedPromptBlocks]
      const outputMaxRetries =
        outputFormat?.type === 'json_schema' ? Math.max(0, outputFormat.maxRetries ?? 0) : 0
      let collapseStoreSnapshot: ContextCollapseStoreSnapshot | null = resumeResolution.sessionFilePath
        ? await readContextCollapseStoreSnapshotFromSession({ filePath: resumeResolution.sessionFilePath }).catch(() => null)
        : null
      let currentHistory = history
      let currentPrompt = normalizedPrompt.prompt
      let lastStructuredValidationError: string | null = null
      let structuredOutputValue: unknown
      let assistantBlocks: { text: string; blocks: PromptBlock[] } | null = null
      let assistantMessage: AssistantMessage | null = null
      let didStructuredOutputFail = false

      for (let attempt = 0; attempt <= outputMaxRetries; attempt += 1) {
        const userForTurn = toUserPromptMessage(currentPrompt, injectedPromptBlocks)
        const promptBudget = resolvePromptBudgetConfig({ runtime, model })
        const prepared = prepareTurnRequestProjection({
          system,
          history: currentHistory,
          user: userForTurn,
          budgetConfig: promptBudget,
          durableState: {
            collapse: collapseStoreSnapshot,
          },
          enableCacheEditing: isAnthropicCacheEditingEnabled({
            provider: runtime.cfg.llm.provider,
            baseUrl: runtime.cfg.llm.baseUrl,
            env,
          }),
        })
        const executionHistory = parsePromptHistory(prepared.persistedHistory)
        const executionRequestHistory = parsePromptHistory(prepared.requestHistory)
        const requestUserForTurn = parsePromptHistory([prepared.requestUser])[0] ?? userForTurn
        const collapseFact = prepared.strategyFacts.collapse
        const collapseCompactBoundaryFingerprint =
          prepared.contextProjection.durableState.collapse.compactBoundaryFingerprint
        const collapseRecapMessage = prepared.stack.collapsedHistory[0]
        const collapseRecapSurvivedRequestProjection = collapseRecapMessage
          ? requestHistoryContainsExactMessage({ messages: prepared.requestHistory, message: collapseRecapMessage })
          : false
        const nextHistoryRaw = await runtime.engine.runTurn({
          history: executionHistory,
          requestHistory: executionRequestHistory,
          user: userForTurn,
          requestUser: requestUserForTurn,
          cacheEditPlan: prepared.cacheEditPlan,
          system,
          tools,
          ...(resolveToolsForCall ? { resolveToolsForCall } : {}),
          onEvent,
          cwd,
          signal: runSignal,
          promptBudget,
          model,
          thinkingEnabled: thinkingEnabled ?? runtime.cfg.llm.thinkingMode,
          exec: {
            interactive,
            replMode,
            ...(allowToolsForExec ? { allowTools: allowToolsForExec } : {}),
            ...(disallowedTools ? { denyTools: disallowedTools } : {}),
            ...(toolExposure.toolExposureSessionKey
              ? { toolExposureSessionKey: toolExposure.toolExposureSessionKey }
              : {}),
          },
        })
        if (
          sessionPersistence &&
          collapseFact.applied &&
          collapseFact.metadata &&
          collapseCompactBoundaryFingerprint &&
          collapseRecapMessage &&
          collapseRecapSurvivedRequestProjection
        ) {
          const entry = createContextCollapseCommittedEntry({
            id: `request-collapse:sdk:${collapseFact.metadata.recapFingerprint}`,
            createdAtMs: Date.now(),
            source: 'request_collapse',
            collapsedRange: {
              kind: 'model_facing_index_range',
              startIndex: 0,
              endIndexExclusive: collapseFact.collapsedHeadMessageCount,
            },
            compactBoundaryFingerprint: collapseCompactBoundaryFingerprint,
            recapMessage: collapseRecapMessage,
            metadata: collapseFact.metadata,
          })
          await sessionPersistence.writer.appendEvent(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, entry)
          collapseStoreSnapshot = appendContextCollapseStoreEntry({ snapshot: collapseStoreSnapshot, entry })
        }
        nextHistory = stripInjectedBlocksFromHistory(
          parsePromptHistory(nextHistoryRaw),
          executionHistory.length,
          injectedPromptBlocks.length,
        )
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

      if (sessionPersistence) {
        await persistQueryTurn({
          persistence: sessionPersistence,
          cwd,
          prompt: normalizedPrompt.prompt,
          assistantText: assistantMessage?.text ?? '',
          history: nextHistory,
          replayHistory: resumeResolution.replayHistory,
        })
      }
      await appendDebugFileLine(
        debugFilePath,
        `query.success session_id=${sessionId} subtype=${resultMessage.subtype}`,
      )

      emitMessage({
        emit: queue.push,
        callback: options.onMessage,
        message: resultMessage,
      })
    } catch (error) {
      const validationError = runSignal.aborted
        ? toAbortError(error, 'Query execution aborted')
        : asValidationError(error, 'Invalid query arguments or runtime event')
      rejectInitializationOnce(controlState, validationError)
      const message = validationError.message
      await appendDebugFileLine(debugFilePath, `query.error ${message}`)
      emitStderr(stderrCallback, `${message}\n`)
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
      await shutdownQuerySessionPersistence(sessionPersistence)
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
