import type { PromptBlock, PromptMessage } from '../../prompts'
import type { ToolCall, ToolDefinition, ToolResult } from '../../tools/types'
import type { LlmStreamClient, LlmStreamOnceArgs, StreamTurnResult, TokenUsage } from '../types'

export interface OpenAiStreamClientConfig {
  apiKey: string
  baseUrl: string
  model: string
  timeoutMs?: number
}

export type StreamOnceArgs = LlmStreamOnceArgs

function sortToolResultsByCallOrder(toolCallOrder: string[], toolResults: ToolResult[]): ToolResult[] {
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

function getOpenAiHeaders(apiKey: string): Record<string, string> {
  return {
    accept: 'text/event-stream, application/json',
    'content-type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl || ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  if (/\/v\d+$/.test(trimmed)) return trimmed
  return `${trimmed}/v1`
}

function promptBlockToText(block: PromptBlock): string {
  if (!block || typeof block !== 'object') return ''
  const t = String((block as any).type || '')
  if (t === 'text') return String((block as any).text || '')
  if (t === 'thinking') return String((block as any).thinking || '')
  if (typeof (block as any).text === 'string') return String((block as any).text)
  return ''
}

function systemBlocksToText(system: PromptBlock[]): string {
  const lines: string[] = []
  for (const block of system || []) {
    const text = promptBlockToText(block)
    if (text) lines.push(text)
  }
  return lines.join('\n\n').trim()
}

function promptMessagesToOpenAiMessages(
  messages: PromptMessage[],
  system: PromptBlock[],
  opts: { forceEmptyReasoningForToolCalls?: boolean } = {},
): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  const forceEmptyReasoningForToolCalls = opts.forceEmptyReasoningForToolCalls ?? false
  const deferredUserTextAfterTools: string[] = []
  const flushDeferredUserTextAfterTools = () => {
    if (deferredUserTextAfterTools.length === 0) return
    out.push({ role: 'user', content: deferredUserTextAfterTools.join('\n\n') })
    deferredUserTextAfterTools.length = 0
  }
  const systemText = systemBlocksToText(system)
  if (systemText) {
    out.push({ role: 'system', content: systemText })
  }

  for (const message of messages || []) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user'
    if (role === 'assistant') {
      flushDeferredUserTextAfterTools()
      const textParts: string[] = []
      const thinkingParts: string[] = []
      const toolCalls: Array<Record<string, any>> = []

      for (const block of message?.content || []) {
        if (!block || typeof block !== 'object') continue
        const type = String((block as any).type || '')
        if (type === 'tool_use') {
          toolCalls.push({
            id: String((block as any).id || ''),
            type: 'function',
            function: {
              name: String((block as any).name || ''),
              arguments: JSON.stringify((block as any).input || {}),
            },
          })
          continue
        }

        if (type === 'thinking') {
          const reasoning = String((block as any).thinking || '')
          if (reasoning) thinkingParts.push(reasoning)
          continue
        }

        const text = promptBlockToText(block)
        if (text) textParts.push(text)
      }

      if (textParts.length > 0 || toolCalls.length > 0 || thinkingParts.length > 0) {
        const assistantMessage: Record<string, any> = {
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n\n') : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        }

        if (thinkingParts.length > 0) {
          assistantMessage.reasoning_content = thinkingParts.join('\n\n')
        } else if (forceEmptyReasoningForToolCalls && toolCalls.length > 0) {
          // Some OpenAI-compatible providers (e.g. DeepSeek thinking+tools) require this field.
          assistantMessage.reasoning_content = ''
        }

        out.push(assistantMessage)
      }
      continue
    }

    const textParts: string[] = []
    const toolMessages: Array<Record<string, any>> = []

    for (const block of message?.content || []) {
      if (!block || typeof block !== 'object') continue
      const type = String((block as any).type || '')
      if (type === 'tool_result') {
        const rawContent = String((block as any).content || '')
        const isError = Boolean((block as any).is_error)
        const toolContent = isError
          ? rawContent
            ? rawContent.toLowerCase().startsWith('error:')
              ? rawContent
              : `Error: ${rawContent}`
            : 'Error: tool execution failed'
          : rawContent
        toolMessages.push({
          role: 'tool',
          tool_call_id: String((block as any).tool_use_id || ''),
          content: toolContent,
        })
        continue
      }

      const text = promptBlockToText(block)
      if (text) textParts.push(text)
    }

    if (toolMessages.length > 0) {
      out.push(...toolMessages)
      if (textParts.length > 0) deferredUserTextAfterTools.push(textParts.join('\n\n'))
      continue
    }

    flushDeferredUserTextAfterTools()
    if (textParts.length > 0) out.push({ role: 'user', content: textParts.join('\n\n') })
  }

  flushDeferredUserTextAfterTools()
  return out
}

function mapToolsToOpenAi(tools: ToolDefinition[]): Array<Record<string, any>> {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.input_schema || {
        type: 'object',
        properties: {},
      }) as Record<string, any>,
    },
  }))
}

function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Keep empty object on malformed arguments to avoid crashing tool execution.
  }
  return {}
}

function openAiMessageContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const textChunks: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if ((item as any).type === 'text') {
      const text = (item as any).text
      if (typeof text === 'string' && text) textChunks.push(text)
    }
  }
  return textChunks.join('')
}

function openAiReasoningContentToText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const chunks: string[] = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      if (typeof (item as any).text === 'string' && (item as any).text) {
        chunks.push((item as any).text)
        continue
      }
      if (typeof (item as any).reasoning_content === 'string' && (item as any).reasoning_content) {
        chunks.push((item as any).reasoning_content)
        continue
      }
      if (typeof (item as any).reasoning === 'string' && (item as any).reasoning) {
        chunks.push((item as any).reasoning)
      }
    }
    return chunks.join('')
  }
  if (typeof content === 'object') {
    if (typeof (content as any).text === 'string') return (content as any).text
    if (typeof (content as any).reasoning_content === 'string') return (content as any).reasoning_content
    if (typeof (content as any).reasoning === 'string') return (content as any).reasoning
  }
  return ''
}

function mapOpenAiStopReason(reason: unknown): string | null {
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'function_call') return 'tool_use'
  if (reason === 'stop') return 'end_turn'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'content_filter') return 'content_filter'
  if (reason === null || reason === undefined || reason === '') return null
  return String(reason)
}

function mapOpenAiUsage(usage: any): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const out: TokenUsage = {}
  if (typeof usage.prompt_tokens === 'number') out.input_tokens = usage.prompt_tokens
  if (typeof usage.completion_tokens === 'number') out.output_tokens = usage.completion_tokens
  const cached = usage.prompt_tokens_details?.cached_tokens
  if (typeof cached === 'number') out.cache_read_input_tokens = cached
  return Object.keys(out).length > 0 ? out : undefined
}

type OpenAiToolCallDeltaState = {
  sortOrder: number
  id?: string
  name?: string
  argumentsText: string
}

type OpenAiToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

type OpenAiStreamParseResult = {
  assistantText: string
  reasoningContent: string
  toolCalls: OpenAiToolCall[]
  stopReason: string | null
  usage?: TokenUsage
  model?: string
}

function openAiDeltaContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if (typeof (item as any).text === 'string') parts.push((item as any).text)
  }
  return parts.join('')
}

function applySnapshotTextDelta(current: string, snapshot: string): { next: string; appended: string } {
  if (!snapshot) return { next: current, appended: '' }
  if (!current) return { next: snapshot, appended: snapshot }
  if (snapshot === current) return { next: current, appended: '' }
  if (snapshot.startsWith(current)) {
    const appended = snapshot.slice(current.length)
    return { next: snapshot, appended }
  }
  return { next: snapshot, appended: '' }
}

function mergeOpenAiToolCallDeltas(
  byKey: Map<string, OpenAiToolCallDeltaState>,
  deltas: unknown,
  opts: { appendArgs?: boolean } = {},
): void {
  if (!Array.isArray(deltas)) return
  const appendArgs = opts.appendArgs ?? true
  for (let pos = 0; pos < deltas.length; pos += 1) {
    const entry = deltas[pos]
    if (!entry || typeof entry !== 'object') continue
    const index = Number((entry as any).index)
    const id = (entry as any).id
    const hasIndex = Number.isFinite(index)
    const hasId = typeof id === 'string' && id.length > 0

    const keyById = hasId ? `id:${id}` : null
    const keyByIndex = hasIndex ? `idx:${index}` : null
    const keyByPos = `pos:${pos}`

    let state = (keyById ? byKey.get(keyById) : undefined) || (keyByIndex ? byKey.get(keyByIndex) : undefined)
    if (!state) {
      const posState = byKey.get(keyByPos)
      const sameToolById = !hasId || !posState?.id || posState.id === id
      if (posState && sameToolById) state = posState
    }

    if (!state) {
      state = {
        sortOrder: hasIndex ? index : 100_000 + pos,
        argumentsText: '',
      }
    } else if (hasIndex) {
      state.sortOrder = index
    }

    if (hasId) state.id = id
    const fnName = (entry as any)?.function?.name
    if (typeof fnName === 'string' && fnName) state.name = fnName
    const argsDelta = (entry as any)?.function?.arguments
    if (typeof argsDelta === 'string' && argsDelta) {
      state.argumentsText = appendArgs ? state.argumentsText + argsDelta : argsDelta
    }

    if (keyById) byKey.set(keyById, state)
    if (keyByIndex) byKey.set(keyByIndex, state)
    byKey.set(keyByPos, state)
  }
}

function materializeOpenAiToolCalls(byKey: Map<string, OpenAiToolCallDeltaState>): OpenAiToolCall[] {
  const uniqueStates = Array.from(new Set(byKey.values()))
  return uniqueStates
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((tc, i) => ({
      id: String(tc.id || `tool_${i + 1}`),
      name: String(tc.name || ''),
      input: parseToolInput(tc.argumentsText),
    }))
}

function parseOpenAiSseChunk(chunk: string): { done: boolean; payload?: any } {
  const lines = chunk
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
  if (lines.length === 0) return { done: false }

  const payload = lines
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')
    .trim()
  if (!payload) return { done: false }
  if (payload === '[DONE]') return { done: true }

  const parsed = JSON.parse(payload)
  return { done: false, payload: parsed }
}

function createReadableStreamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunk = encoder.encode(text)
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk)
      controller.close()
    },
  })
}

function looksLikeSseBody(text: string): boolean {
  return /^data:/m.test(text)
}

function hasParsedOpenAiContent(parsed: OpenAiStreamParseResult): boolean {
  return (
    parsed.assistantText.length > 0 ||
    parsed.reasoningContent.length > 0 ||
    parsed.toolCalls.length > 0 ||
    parsed.stopReason !== null ||
    !!parsed.usage
  )
}

function findSseBoundary(buffer: string): { index: number; length: number } | null {
  const lfBoundary = buffer.indexOf('\n\n')
  const crlfBoundary = buffer.indexOf('\r\n\r\n')
  if (lfBoundary < 0 && crlfBoundary < 0) return null
  if (lfBoundary < 0) return { index: crlfBoundary, length: 4 }
  if (crlfBoundary < 0) return { index: lfBoundary, length: 2 }
  return lfBoundary < crlfBoundary ? { index: lfBoundary, length: 2 } : { index: crlfBoundary, length: 4 }
}

function shouldRetryWithEmptyReasoningContent(errorText: string): boolean {
  const lowered = String(errorText || '').toLowerCase()
  return lowered.includes('missing `reasoning_content` field') || lowered.includes('missing reasoning_content field')
}

export class OpenAIStreamClient implements LlmStreamClient {
  private config: OpenAiStreamClientConfig
  private openAiHeaders: Record<string, string>

  constructor(config: OpenAiStreamClientConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      timeoutMs: config.timeoutMs ?? 600000,
    }
    this.openAiHeaders = getOpenAiHeaders(config.apiKey)
  }

  async streamOnce(args: StreamOnceArgs): Promise<StreamTurnResult> {
    const thinkingEnabled = args.thinkingEnabled ?? true
    const modelForRequest = String(args.model || this.config.model || '').trim() || this.config.model
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const signal = args.signal ? this.combineSignals(args.signal, controller.signal) : controller.signal

    try {
      const buildPayload = (forceEmptyReasoningForToolCalls = false): Record<string, any> => {
        const payload: Record<string, any> = {
          model: modelForRequest,
          messages: promptMessagesToOpenAiMessages(args.messages, args.system, {
            forceEmptyReasoningForToolCalls,
          }),
          max_tokens: args.maxTokens ?? 16000,
          stream: true,
          stream_options: { include_usage: true },
        }

        if ((args.tools || []).length > 0) {
          payload.tools = mapToolsToOpenAi(args.tools)
          payload.tool_choice = 'auto'
        }

        return payload
      }

      const fetchOpenAi = async (payload: Record<string, any>) =>
        fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.openAiHeaders,
          body: JSON.stringify(payload),
          signal,
        })

      let payload = buildPayload(false)
      let response = await fetchOpenAi(payload)

      if (!response.ok) {
        const initialErrorText = await response.text()
        if (shouldRetryWithEmptyReasoningContent(initialErrorText)) {
          payload = buildPayload(true)
          response = await fetchOpenAi(payload)
          if (!response.ok) {
            const retryErrorText = await response.text()
            throw new Error(`HTTP ${response.status}: ${retryErrorText}`)
          }
        } else {
          throw new Error(`HTTP ${response.status}: ${initialErrorText}`)
        }
      }

      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase()
      let parsed: OpenAiStreamParseResult
      if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
        parsed = this.parseOpenAiJsonResponse(await response.json(), args.onEvent, thinkingEnabled)
      } else if (contentType.includes('text/event-stream')) {
        if (!response.body) throw new Error('No response body')
        parsed = await this.parseOpenAiSSEStream({
          stream: response.body,
          signal,
          onEvent: args.onEvent,
          thinkingEnabled,
        })
      } else {
        const hasTextReader = typeof (response as any).text === 'function'
        if (response.body) {
          const cloneResponse = typeof (response as any).clone === 'function' ? (response as any).clone() : null
          parsed = await this.parseOpenAiSSEStream({
            stream: response.body,
            signal,
            onEvent: args.onEvent,
            thinkingEnabled,
          })

          if (!hasParsedOpenAiContent(parsed)) {
            if (cloneResponse && typeof cloneResponse.text === 'function') {
              const rawBody = await cloneResponse.text()
              parsed = await this.parseOpenAiUnknownText(rawBody, signal, args.onEvent, thinkingEnabled)
            } else if (hasTextReader) {
              const rawBody = await (response as any).text()
              parsed = await this.parseOpenAiUnknownText(rawBody, signal, args.onEvent, thinkingEnabled)
            }
          }
        } else if (hasTextReader) {
          const rawBody = await (response as any).text()
          parsed = await this.parseOpenAiUnknownText(rawBody, signal, args.onEvent, thinkingEnabled)
        } else {
          throw new Error('No response body')
        }
      }

      const assistantBlocks: PromptBlock[] = []
      if (thinkingEnabled && parsed.reasoningContent) {
        assistantBlocks.push({ type: 'thinking', thinking: parsed.reasoningContent })
      }
      if (parsed.assistantText) assistantBlocks.push({ type: 'text', text: parsed.assistantText })

      const shouldExecuteTools = parsed.stopReason === 'tool_use'
      const toolCallsForExecution = shouldExecuteTools ? parsed.toolCalls : []
      const orderedToolIds = toolCallsForExecution.map((tc) => tc.id)
      const toolResults: ToolResult[] = []

      const executions = toolCallsForExecution.map(async (tc) => {
        const id = tc.id
        const name = tc.name
        const parsedInput = tc.input
        assistantBlocks.push({ type: 'tool_use', id, name, input: parsedInput })

        args.onEvent({ type: 'tool_start', id, name })
        args.onEvent({ type: 'tool_input', id, input: parsedInput })

        if (signal.aborted) {
          const aborted: ToolResult = {
            tool_use_id: id,
            content: 'Request aborted',
            is_error: true,
          }
          toolResults.push(aborted)
          args.onEvent({ type: 'tool_end', id, result: aborted })
          return
        }

        try {
          const result = await args.executeTool({
            id,
            name,
            input: parsedInput,
          })
          toolResults.push(result)
          args.onEvent({ type: 'tool_end', id, result })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const errResult: ToolResult = {
            tool_use_id: id,
            content: `Error: ${msg}`,
            is_error: true,
          }
          toolResults.push(errResult)
          args.onEvent({ type: 'tool_end', id, result: errResult })
        }
      })
      await Promise.all(executions)

      if (parsed.usage) {
        args.onEvent({
          type: 'usage',
          usage: parsed.usage,
          model: String(parsed.model || modelForRequest),
        })
      }

      const stopReason = shouldExecuteTools ? 'tool_use' : parsed.stopReason || 'end_turn'
      return {
        assistantBlocks,
        stopReason,
        toolResults: sortToolResultsByCallOrder(orderedToolIds, toolResults),
        usage: parsed.usage,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async parseOpenAiSSEStream(input: {
    stream: ReadableStream<Uint8Array>
    signal: AbortSignal
    onEvent: StreamOnceArgs['onEvent']
    thinkingEnabled: boolean
  }): Promise<OpenAiStreamParseResult> {
    const { stream, signal, onEvent, thinkingEnabled } = input
    const decoder = new TextDecoder('utf-8')
    const reader = stream.getReader()
    const toolCallsByKey = new Map<string, OpenAiToolCallDeltaState>()
    let buffer = ''
    let assistantText = ''
    let reasoningContent = ''
    let stopReason: string | null = null
    let usage: TokenUsage | undefined
    let model: string | undefined
    let emittedThinking = false

    const handlePayload = (payload: any) => {
      if (!payload || typeof payload !== 'object') return
      if (payload.error) {
        const msg = typeof payload.error?.message === 'string' ? payload.error.message : String(payload.error)
        throw new Error(`OpenAI stream error: ${msg}`)
      }

      if (typeof payload.model === 'string' && payload.model) {
        model = payload.model
      }

      const usageDelta = mapOpenAiUsage(payload.usage)
      if (usageDelta) usage = { ...(usage || {}), ...usageDelta }

      const choices = Array.isArray(payload.choices) ? payload.choices : []
      for (const choice of choices) {
        if (!choice || typeof choice !== 'object') continue
        if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
          stopReason = mapOpenAiStopReason(choice.finish_reason)
        }

        const delta = choice.delta || {}
        const textDelta = openAiDeltaContentToText(delta.content)
        if (textDelta) {
          assistantText += textDelta
          onEvent({ type: 'assistant_delta', text: textDelta })
        }
        const reasoningDelta = openAiReasoningContentToText(
          (delta as any).reasoning_content ?? (delta as any).reasoning,
        )
        if (reasoningDelta) {
          reasoningContent += reasoningDelta
          if (thinkingEnabled) {
            onEvent({ type: 'thinking_delta', thinking: reasoningDelta })
            emittedThinking = true
          }
        }

        const hasDeltaToolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0
        if (hasDeltaToolCalls) {
          mergeOpenAiToolCallDeltas(toolCallsByKey, delta.tool_calls, { appendArgs: true })
        }

        const message = choice.message
        if (message && typeof message === 'object') {
          const snapshotText = openAiMessageContentToText((message as any).content)
          if (!textDelta && snapshotText) {
            const applied = applySnapshotTextDelta(assistantText, snapshotText)
            assistantText = applied.next
            if (applied.appended) onEvent({ type: 'assistant_delta', text: applied.appended })
          }
          const snapshotReasoning = openAiReasoningContentToText(
            (message as any).reasoning_content ?? (message as any).reasoning,
          )
          if (!reasoningDelta && snapshotReasoning) {
            const appliedReasoning = applySnapshotTextDelta(reasoningContent, snapshotReasoning)
            reasoningContent = appliedReasoning.next
            if (thinkingEnabled && appliedReasoning.appended) {
              onEvent({ type: 'thinking_delta', thinking: appliedReasoning.appended })
              emittedThinking = true
            }
          }

          mergeOpenAiToolCallDeltas(toolCallsByKey, (message as any).tool_calls, { appendArgs: false })
        }
      }
    }

    try {
      while (true) {
        if (signal.aborted) throw new Error('Stream aborted')
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let boundary = findSseBoundary(buffer)
        while (boundary) {
          const chunk = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary.length)
          const parsed = parseOpenAiSseChunk(chunk)
          if (parsed.done) {
            buffer = ''
            break
          }
          if (parsed.payload !== undefined) handlePayload(parsed.payload)
          boundary = findSseBoundary(buffer)
        }
      }

      if (buffer.trim()) {
        const parsed = parseOpenAiSseChunk(buffer)
        if (parsed.payload !== undefined) handlePayload(parsed.payload)
      }
    } finally {
      reader.releaseLock()
    }

    if (thinkingEnabled && emittedThinking) onEvent({ type: 'thinking_stop' })

    return {
      assistantText,
      reasoningContent,
      toolCalls: materializeOpenAiToolCalls(toolCallsByKey),
      stopReason,
      usage,
      model,
    }
  }

  private parseOpenAiJsonResponse(
    body: any,
    onEvent: StreamOnceArgs['onEvent'],
    thinkingEnabled: boolean,
  ): OpenAiStreamParseResult {
    if (!body || typeof body !== 'object') {
      return { assistantText: '', reasoningContent: '', toolCalls: [], stopReason: null }
    }
    if (body.error) {
      const msg = typeof body.error?.message === 'string' ? body.error.message : String(body.error)
      throw new Error(`OpenAI response error: ${msg}`)
    }

    const choices = Array.isArray(body.choices) ? body.choices : []
    const first = choices[0] || {}
    const message = first.message || {}
    const text = openAiMessageContentToText(message.content)
    if (text) onEvent({ type: 'assistant_delta', text })
    const reasoningContent = openAiReasoningContentToText(message.reasoning_content ?? message.reasoning)
    if (thinkingEnabled && reasoningContent) {
      onEvent({ type: 'thinking_delta', thinking: reasoningContent })
      onEvent({ type: 'thinking_stop' })
    }

    const toolCallsByKey = new Map<string, OpenAiToolCallDeltaState>()
    mergeOpenAiToolCallDeltas(toolCallsByKey, message.tool_calls, { appendArgs: false })

    return {
      assistantText: text,
      reasoningContent,
      toolCalls: materializeOpenAiToolCalls(toolCallsByKey),
      stopReason: mapOpenAiStopReason(first.finish_reason),
      usage: mapOpenAiUsage(body.usage),
      model: typeof body.model === 'string' ? body.model : undefined,
    }
  }

  private async parseOpenAiUnknownText(
    rawBody: string,
    signal: AbortSignal,
    onEvent: StreamOnceArgs['onEvent'],
    thinkingEnabled: boolean,
  ): Promise<OpenAiStreamParseResult> {
    const trimmed = rawBody.trim()
    if (!trimmed) return { assistantText: '', reasoningContent: '', toolCalls: [], stopReason: null }

    try {
      const json = JSON.parse(trimmed)
      return this.parseOpenAiJsonResponse(json, onEvent, thinkingEnabled)
    } catch {
      if (!looksLikeSseBody(rawBody)) {
        throw new Error('Unsupported OpenAI fallback response format')
      }
      return this.parseOpenAiSSEStream({
        stream: createReadableStreamFromText(rawBody),
        signal,
        onEvent,
        thinkingEnabled,
      })
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

export const __openAiStreamClientTestOnly = {
  sortToolResultsByCallOrder,
  getOpenAiHeaders,
  normalizeBaseUrl,
  promptBlockToText,
  systemBlocksToText,
  promptMessagesToOpenAiMessages,
  mapToolsToOpenAi,
  parseToolInput,
  openAiMessageContentToText,
  openAiReasoningContentToText,
  mapOpenAiStopReason,
  mapOpenAiUsage,
  openAiDeltaContentToText,
  applySnapshotTextDelta,
  mergeOpenAiToolCallDeltas,
  materializeOpenAiToolCalls,
  parseOpenAiSseChunk,
  createReadableStreamFromText,
  looksLikeSseBody,
  hasParsedOpenAiContent,
  findSseBoundary,
  shouldRetryWithEmptyReasoningContent,
}
