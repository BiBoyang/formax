import {
  parseAnthropicSSEStream,
  type ContentBlock,
  type SSECallbacks,
} from './sseParser'
import type { AnthropicCacheEditPlan, PromptBlock, PromptMessage } from '../../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../../tools/types'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamTurnResult } from '../types'
import { normalizeAnthropicPromptCachingLayout } from './promptCachingLayout'
import { DEFAULT_THINKING_EFFORT } from '../../shared/runtimePreferences'

export function sortToolResultsByCallOrder(
  toolCallOrder: string[],
  toolResults: ToolResult[],
): ToolResult[] {
  if (toolCallOrder.length === 0) return toolResults

  const byId = new Map<string, ToolResult>()
  for (const r of toolResults) {
    if (!byId.has(r.tool_use_id)) byId.set(r.tool_use_id, r)
  }

  const orderSet = new Set(toolCallOrder)

  const sorted = toolCallOrder.map((id) => {
    const found = byId.get(id)
    if (found) return found
    return {
      tool_use_id: id,
      content: `Error: missing tool_result for tool_use_id=${id}`,
      is_error: true,
    }
  })

  const extras = toolResults.filter((r) => !orderSet.has(r.tool_use_id))
  return [...sorted, ...extras]
}

export interface StreamClientConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs?: number
  cacheEditingBetaHeader?: string | null
}

export type StreamOnceArgs = LlmStreamOnceArgs

function getDefaultHeaders(apiKey: string): Record<string, string> {
  return {
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    Authorization: `Bearer ${apiKey}`,
    'user-agent':
      'claude-cli/2.1.45 (external, claude-vscode, agent-sdk/0.2.45)',
    'x-app': 'cli',
    'x-stainless-arch': process.arch || 'arm64',
    'x-stainless-lang': 'js',
    'x-stainless-os': process.platform === 'darwin' ? 'MacOS' : process.platform,
    'x-stainless-package-version': '0.74.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v24.3.0',
    'x-stainless-timeout': '3000',
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl || ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function shouldRetryWithoutThinking(errorText: string): boolean {
  const t = (errorText || '').toLowerCase()
  if (!t) return false
  return (
    t.includes('thinking') ||
    t.includes('interleaved-thinking') ||
    t.includes('unknown field') ||
    t.includes('unrecognized') ||
    t.includes('additional properties') ||
    t.includes('unexpected')
  )
}

function shouldRetryWithoutBeta(errorText: string): boolean {
  const t = (errorText || '').toLowerCase()
  if (!t) return false
  return (
    t.includes('anthropic-beta') ||
    t.includes('beta header') ||
    t.includes('unknown beta')
  )
}

function shouldRetryWithoutBetaFallback(args: {
  status: number
  errorText: string
}): boolean {
  if (shouldRetryWithoutBeta(args.errorText)) return true
  // Some gateways strip error details and only return generic 400/422 bodies.
  return args.status === 400 || args.status === 422
}

const BASE_BETA_FEATURES = [
  'claude-code-20250219',
  'prompt-caching-scope-2026-01-05',
] as const

function addAnthropicBetaHeaders(
  headers: Record<string, string>,
  args: { extraFeatures?: string[] },
): Record<string, string> {
  const features = [...BASE_BETA_FEATURES]
  for (const feature of args.extraFeatures ?? []) {
    const trimmed = String(feature || '').trim()
    if (trimmed && !features.includes(trimmed as any)) features.push(trimmed as any)
  }

  return {
    ...headers,
    'anthropic-beta': features.join(','),
  }
}

function stripAnthropicBetaHeaders(headers: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = { ...headers }
  delete next['anthropic-beta']
  return next
}

function applyAnthropicCacheEditPlan(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  plan: AnthropicCacheEditPlan
}): { system: PromptBlock[]; messages: PromptMessage[] } {
  const messages = clonePromptMessages(args.messages)
  const refsToDelete: string[] = []
  const seenRefs = new Set<string>()
  const lastCacheControlMessageIndex = findLastCacheControlMessageIndex(messages)

  for (const edit of args.plan.deletes) {
    if (edit.type !== 'delete') continue
    const cacheReference = String(edit.cacheReference || edit.toolUseId || '').trim()
    if (!cacheReference || seenRefs.has(cacheReference)) continue
    const match = findToolResultBlockByToolUseId({
      messages,
      toolUseId: edit.toolUseId,
      maxMessageIndexExclusive: lastCacheControlMessageIndex >= 0 ? lastCacheControlMessageIndex : messages.length,
    })
    if (!match) continue

    match.message.content[match.blockIndex] = {
      ...match.block,
      cache_reference: cacheReference,
    } as any
    seenRefs.add(cacheReference)
    refsToDelete.push(cacheReference)
  }

  if (refsToDelete.length === 0) {
    return { system: args.system, messages }
  }

  const cacheEditsBlock = {
    type: 'cache_edits',
    edits: refsToDelete.map((cacheReference) => ({
      type: 'delete',
      cache_reference: cacheReference,
    })),
  }
  const insertionMessage = findLastUserMessage(messages)
  if (insertionMessage) {
    insertBlockAfterToolResults(insertionMessage.content, cacheEditsBlock)
  }

  return { system: args.system, messages }
}

function applyAnthropicCacheEditFallback(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  plan: AnthropicCacheEditPlan
}): { system: PromptBlock[]; messages: PromptMessage[] } {
  const fallbackContentByToolUseId = collectFallbackToolResultContent(args.plan.fallbackMessages ?? [])
  if (fallbackContentByToolUseId.size === 0) {
    return { system: args.system, messages: args.messages }
  }

  const messages = clonePromptMessages(args.messages)
  let changed = false
  for (const message of messages) {
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
      const block = message.content[blockIndex] as any
      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      if (!fallbackContentByToolUseId.has(block.tool_use_id)) continue
      message.content[blockIndex] = {
        ...block,
        content: fallbackContentByToolUseId.get(block.tool_use_id),
      } as any
      changed = true
    }
  }

  return changed ? { system: args.system, messages } : { system: args.system, messages: args.messages }
}

function collectFallbackToolResultContent(messages: PromptMessage[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const message of messages) {
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content as any[]) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        out.set(block.tool_use_id, block.content)
      }
    }
  }
  return out
}

function clonePromptMessages(messages: PromptMessage[], opts?: { omitThinking?: boolean }): PromptMessage[] {
  const out: PromptMessage[] = []
  for (const message of messages) {
    const content = Array.isArray(message.content)
      ? message.content
          .filter((block) => {
            if (opts?.omitThinking !== true) return true
            const type = (block as any)?.type
            return type !== 'thinking' && type !== 'redacted_thinking'
          })
          .map((block) => (block && typeof block === 'object' ? { ...(block as any) } : block))
      : message.content
    if (opts?.omitThinking === true && Array.isArray(content) && content.length === 0) continue
    out.push({ role: message.role, content })
  }
  return out
}

function findLastCacheControlMessageIndex(messages: PromptMessage[]): number {
  let index = -1
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message || !Array.isArray(message.content)) continue
    if (message.content.some((block: any) => block && typeof block === 'object' && 'cache_control' in block)) {
      index = i
    }
  }
  return index
}

function findLastUserMessage(messages: PromptMessage[]): PromptMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'user' && Array.isArray(message.content)) return message
  }
  return null
}

function findToolResultBlockByToolUseId(args: {
  messages: PromptMessage[]
  toolUseId: string
  maxMessageIndexExclusive: number
}): { message: PromptMessage; block: PromptBlock; blockIndex: number } | null {
  for (let i = 0; i < Math.min(args.messages.length, args.maxMessageIndexExclusive); i++) {
    const message = args.messages[i]
    if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex++) {
      const block = message.content[blockIndex]
      if ((block as any)?.type === 'tool_result' && (block as any).tool_use_id === args.toolUseId) {
        return { message, block, blockIndex }
      }
    }
  }
  return null
}

function insertBlockAfterToolResults(content: PromptBlock[], block: PromptBlock): void {
  const cacheControlIndex = content.findIndex(
    (candidate: any) => candidate && typeof candidate === 'object' && 'cache_control' in candidate,
  )
  let insertAt = cacheControlIndex >= 0 ? cacheControlIndex : content.length
  for (let i = insertAt - 1; i >= 0; i--) {
    if ((content[i] as any)?.type === 'tool_result') {
      insertAt = i + 1
      break
    }
  }
  content.splice(insertAt, 0, block)
}

export class AnthropicStreamClient implements LlmStreamClient {
  private config: StreamClientConfig
  private headers: Record<string, string>

  constructor(config: StreamClientConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      timeoutMs: config.timeoutMs ?? 600000,
    }
    this.headers = getDefaultHeaders(config.apiKey)
  }

  async streamOnce(args: StreamOnceArgs): Promise<StreamTurnResult> {
    const requestedThinkingEnabled = args.thinkingEnabled ?? true
    const modelForRequest = String(args.model || this.config.model || '').trim() || this.config.model
    const normalizedPrompt = normalizeAnthropicPromptCachingLayout({
      system: args.system,
      messages: args.messages,
    })
    const cacheEditingBetaHeader = String(this.config.cacheEditingBetaHeader || '').trim()
    const cacheEditingEnabled =
      cacheEditingBetaHeader.length > 0 &&
      args.cacheEditPlan?.provider === 'anthropic' &&
      (args.cacheEditPlan.deletes?.length ?? 0) > 0
    const requestPrompt = cacheEditingEnabled
      ? applyAnthropicCacheEditPlan({
          system: normalizedPrompt.system,
          messages: normalizedPrompt.messages,
          plan: args.cacheEditPlan!,
        })
      : normalizedPrompt
    const fallbackPrompt =
      cacheEditingEnabled && Array.isArray(args.cacheEditPlan?.fallbackMessages)
        ? applyAnthropicCacheEditFallback({
            system: normalizedPrompt.system,
            messages: normalizedPrompt.messages,
            plan: args.cacheEditPlan,
          })
        : normalizedPrompt
    const thinkingEnabled = requestedThinkingEnabled
    const thinkingEffort = args.thinkingEffort ?? DEFAULT_THINKING_EFFORT
    const buildBasePayload = (
      prompt: { system: PromptBlock[]; messages: PromptMessage[] },
      opts?: { omitThinking?: boolean },
    ) => ({
      stream: true,
      model: modelForRequest,
      max_tokens: args.maxTokens ?? 16000,
      messages: clonePromptMessages(prompt.messages, opts),
      system: prompt.system,
      tools: args.tools,
    })
    const basePayload = buildBasePayload(requestPrompt)
    const fallbackBasePayload = buildBasePayload(fallbackPrompt)
    const noThinkingBasePayload = buildBasePayload(requestPrompt, { omitThinking: true })
    const noThinkingFallbackBasePayload = buildBasePayload(fallbackPrompt, { omitThinking: true })

    const payload = thinkingEnabled
      ? {
          ...basePayload,
          thinking: {
            type: 'adaptive',
          },
          output_config: {
            effort: thinkingEffort,
          },
        }
      : noThinkingBasePayload
    const fallbackPayload = thinkingEnabled
      ? {
          ...fallbackBasePayload,
          thinking: {
            type: 'adaptive',
          },
          output_config: {
            effort: thinkingEffort,
          },
        }
      : noThinkingFallbackBasePayload

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    )

    const combinedSignal = args.signal
      ? this.combineSignals(args.signal, controller.signal)
      : controller.signal

    const toolResults: ToolResult[] = []
    const pendingToolExecutions = new Map<string, Promise<void>>()
    const isAborted = () => combinedSignal.aborted

    try {
      const requestHeaders = addAnthropicBetaHeaders(this.headers, {
        extraFeatures: cacheEditingEnabled ? [cacheEditingBetaHeader] : [],
      })
      const noThinkingHeaders = addAnthropicBetaHeaders(this.headers, {
        extraFeatures: cacheEditingEnabled ? [cacheEditingBetaHeader] : [],
      })

      let response = await fetch(`${this.config.baseUrl}/messages`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: combinedSignal,
      })

      if (!response.ok) {
        const errorText = await response.text()

        if (
          thinkingEnabled &&
          shouldRetryWithoutThinking(errorText) &&
          !shouldRetryWithoutBeta(errorText)
        ) {
          response = await fetch(`${this.config.baseUrl}/messages`, {
            method: 'POST',
            headers: noThinkingHeaders,
            body: JSON.stringify(noThinkingBasePayload),
            signal: combinedSignal,
          })

          if (!response.ok) {
            const retryErrorText = await response.text()
            if (shouldRetryWithoutBetaFallback({
              status: response.status,
              errorText: retryErrorText,
            })) {
              response = await fetch(`${this.config.baseUrl}/messages`, {
                method: 'POST',
                headers: stripAnthropicBetaHeaders(this.headers),
                body: JSON.stringify(noThinkingFallbackBasePayload),
                signal: combinedSignal,
              })
              if (!response.ok) {
                const retryNoBetaErrorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${retryNoBetaErrorText}`)
              }
            } else {
              throw new Error(`HTTP ${response.status}: ${retryErrorText}`)
            }
          }
        } else if (shouldRetryWithoutBetaFallback({
          status: response.status,
          errorText,
        })) {
          response = await fetch(`${this.config.baseUrl}/messages`, {
            method: 'POST',
            headers: stripAnthropicBetaHeaders(this.headers),
            body: JSON.stringify(fallbackPayload),
            signal: combinedSignal,
          })
          if (!response.ok) {
            const retryNoBetaErrorText = await response.text()
            if (thinkingEnabled && shouldRetryWithoutThinking(retryNoBetaErrorText)) {
              response = await fetch(`${this.config.baseUrl}/messages`, {
                method: 'POST',
                headers: stripAnthropicBetaHeaders(this.headers),
                body: JSON.stringify(noThinkingFallbackBasePayload),
                signal: combinedSignal,
              })
              if (!response.ok) {
                const retryNoBetaNoThinkingErrorText = await response.text()
                throw new Error(`HTTP ${response.status}: ${retryNoBetaNoThinkingErrorText}`)
              }
            } else {
              throw new Error(`HTTP ${response.status}: ${retryNoBetaErrorText}`)
            }
          }
        } else {
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const sseCallbacks: SSECallbacks = {
        onTextDelta: (text) => args.onEvent({ type: 'assistant_delta', text }),
        onThinkingDelta: (thinking) => args.onEvent({ type: 'thinking_delta', thinking }),
        onThinkingStop: () => args.onEvent({ type: 'thinking_stop' }),
        onToolUseStart: (id, name) => {
          args.onEvent({ type: 'tool_start', id, name })
        },
        onToolUseComplete: async (_blockIndex, toolUse) => {
          if (isAborted()) return

          args.onEvent({
            type: 'tool_input',
            id: toolUse.id,
            input: toolUse.input,
          })

          const call: ToolCall = {
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input || {},
          }

          const executionPromise = (async () => {
            if (isAborted()) {
              const aborted: ToolResult = {
                tool_use_id: call.id,
                content: 'Request aborted',
                is_error: true,
              }
              toolResults.push(aborted)
              args.onEvent({ type: 'tool_end', id: call.id, result: aborted })
              return
            }

            try {
              const result = await args.executeTool(call)
              toolResults.push(result)
              args.onEvent({ type: 'tool_end', id: call.id, result })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              const errResult: ToolResult = {
                tool_use_id: call.id,
                content: `Error: ${msg}`,
                is_error: true,
              }
              toolResults.push(errResult)
              args.onEvent({ type: 'tool_end', id: call.id, result: errResult })
            } finally {
              pendingToolExecutions.delete(call.id)
            }
          })()

          pendingToolExecutions.set(call.id, executionPromise)
        },
        onMessageComplete: () => {
          // handled by return value
        },
        onError: (error) => {
          args.onEvent({ type: 'error', error })
        },
      }

      const result = await parseAnthropicSSEStream(
        response.body,
        sseCallbacks,
        combinedSignal,
      )

      if (result.usage && Object.keys(result.usage).length > 0) {
        args.onEvent({ type: 'usage', usage: result.usage, model: modelForRequest })
      }

      await Promise.all(Array.from(pendingToolExecutions.values()))

      const toolCallOrder = result.contentBlocks
        .filter((b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use')
        .map((b) => b.id!)

      const sortedToolResults = sortToolResultsByCallOrder(toolCallOrder, toolResults)

      const assistantBlocks: PromptBlock[] = result.contentBlocks.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text || '' }
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: String(block.id || ''),
            name: String(block.name || ''),
            input: (block.input || {}) as Record<string, unknown>,
          }
        }
        if (block.type === 'thinking') {
          return block.signature
            ? ({ type: 'thinking', thinking: block.thinking || '', signature: block.signature } as PromptBlock)
            : ({ type: 'thinking', thinking: block.thinking || '' } as PromptBlock)
        }
        if (block.type === 'redacted_thinking') {
          return { type: 'redacted_thinking', data: block.data || '' } as PromptBlock
        }
        return block as any
      })

      return {
        assistantBlocks,
        stopReason: result.stopReason,
        toolResults: sortedToolResults,
        usage: result.usage,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController()

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort()
        break
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    return controller.signal
  }
}
