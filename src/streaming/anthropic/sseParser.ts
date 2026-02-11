/**
 * Streaming SSE Parser for Anthropic API
 * 
 * Handles all SSE event types:
 * - message_start: Initialize response structure
 * - content_block_start: Initialize text/tool_use blocks
 * - content_block_delta: Accumulate text or JSON input
 * - content_block_stop: Finalize blocks, parse JSON for tool_use
 * - message_delta: Capture stop_reason
 * - message_stop: Signal end of response
 */

import type { TokenUsage } from '../types'

export interface ContentBlock {
  index: number
  type: 'text' | 'tool_use' | 'thinking'
  text?: string
  id?: string      // for tool_use
  name?: string    // for tool_use
  input?: any      // for tool_use, parsed from JSON
  thinking?: string // for thinking blocks
}

export interface SSECallbacks {
  onTextDelta: (text: string, blockIndex: number) => void
  onThinkingDelta: (thinking: string, blockIndex: number) => void
  onThinkingStop: (blockIndex: number) => void
  onToolUseStart: (id: string, name: string, blockIndex: number) => void
  onToolUseComplete: (blockIndex: number, toolUse: { id: string; name: string; input: any }) => void
  onMessageComplete: (stopReason: string | null, content: ContentBlock[]) => void
  onError: (error: Error) => void
}

export interface ParseResult {
  contentBlocks: ContentBlock[]
  stopReason: string | null
  stopSequence: string | null
  usage?: TokenUsage
}

class FatalSSEError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalSSEError'
  }
}

/**
 * Parse Anthropic SSE stream and invoke callbacks for each event
 */
export async function parseAnthropicSSEStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: SSECallbacks,
  signal?: AbortSignal
): Promise<ParseResult> {
  const decoder = new TextDecoder('utf-8')
  const reader = stream.getReader()
  let buffer = ''

  // State
  const contentBlocks: ContentBlock[] = []
  const inputJSONBuffers = new Map<number, string>()
  let stopReason: string | null = null
  let stopSequence: string | null = null
  const usage: TokenUsage = {}

  try {
    while (true) {
      // Check abort signal
      if (signal?.aborted) {
        throw new Error('Stream aborted')
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Split on newlines; SSE events are separated by blank lines
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue

        const payload = line.slice('data:'.length).trim()
        if (!payload || payload === '[DONE]') continue

        let event: any
        try {
          event = JSON.parse(payload)
        } catch (e) {
          // Log parse error but continue processing
          callbacks.onError(new Error(`SSE parse error: ${e}`))
          continue
        }

        try {
          handleSSEEvent(
            event,
            contentBlocks,
            inputJSONBuffers,
            callbacks,
            (reason, seq) => {
            stopReason = reason
            stopSequence = seq
            },
            (u) => mergeUsageMax(usage, u),
          )
        } catch (e) {
          if (e instanceof FatalSSEError) throw e
          callbacks.onError(new Error(`SSE event handler error: ${e}`))
        }
      }
    }

    // Flush any trailing buffer
    if (buffer.trim().startsWith('data:')) {
      let event: any
      try {
        const payload = buffer.trim().slice('data:'.length).trim()
        if (payload && payload !== '[DONE]') {
          event = JSON.parse(payload)
        }
      } catch {
        // Ignore trailing parse errors
      }

      if (event) {
        try {
          handleSSEEvent(
            event,
            contentBlocks,
            inputJSONBuffers,
            callbacks,
            (reason, seq) => {
              stopReason = reason
              stopSequence = seq
            },
            (u) => mergeUsageMax(usage, u),
          )
        } catch (e) {
          if (e instanceof FatalSSEError) throw e
          callbacks.onError(new Error(`SSE event handler error: ${e}`))
        }
      }
    }

    // Signal completion
    callbacks.onMessageComplete(stopReason, contentBlocks)

    return {
      contentBlocks,
      stopReason,
      stopSequence,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
    }
  } finally {
    reader.releaseLock()
  }
}

function handleSSEEvent(
  event: any,
  contentBlocks: ContentBlock[],
  inputJSONBuffers: Map<number, string>,
  callbacks: SSECallbacks,
  setStopInfo: (reason: string | null, sequence: string | null) => void,
  onUsage: (usage: TokenUsage) => void,
): void {
  if (!event || typeof event !== 'object') return

  const apiErrorMessage = maybeBuildApiErrorMessage(event)
  if (apiErrorMessage) {
    throw new FatalSSEError(apiErrorMessage)
  }

  const type = event.type

  switch (type) {
    case 'message_start':
      // Initialize - nothing special needed, blocks will be created on content_block_start
      if (event.message?.usage) {
        const u = extractTokenUsage(event.message.usage)
        if (u) onUsage(u)
      }
      break

    case 'content_block_start': {
      const index = event.index
      const block = event.content_block

      if (block?.type === 'text') {
        contentBlocks[index] = {
          index,
          type: 'text',
          text: block.text || ''
        }
      } else if (block?.type === 'tool_use') {
        contentBlocks[index] = {
          index,
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: {}
        }
        // Initialize JSON buffer for this tool_use
        inputJSONBuffers.set(index, '')
        callbacks.onToolUseStart(block.id, block.name, index)
      } else if (block?.type === 'thinking') {
        contentBlocks[index] = {
          index,
          type: 'thinking',
          thinking: block.thinking || ''
        }
        if (block.thinking) {
          callbacks.onThinkingDelta(block.thinking, index)
        }
      }
      break
    }

    case 'content_block_delta': {
      const index = event.index
      const delta = event.delta

      // Ensure block exists
      if (!contentBlocks[index]) {
        if (delta?.type === 'text_delta') {
          contentBlocks[index] = { index, type: 'text', text: '' }
        } else if (delta?.type === 'input_json_delta') {
          contentBlocks[index] = { index, type: 'tool_use', input: {} }
          inputJSONBuffers.set(index, '')
        } else if (delta?.type === 'thinking_delta') {
          contentBlocks[index] = { index, type: 'thinking', thinking: '' }
        }
      }

      if (delta?.type === 'text_delta') {
        const text = delta.text ?? ''
        if (contentBlocks[index]) {
          contentBlocks[index].text = (contentBlocks[index].text || '') + text
        }
        if (text) {
          callbacks.onTextDelta(text, index)
        }
      } else if (delta?.type === 'input_json_delta') {
        const partialJson = delta.partial_json ?? ''
        const currentBuffer = inputJSONBuffers.get(index) || ''
        inputJSONBuffers.set(index, currentBuffer + partialJson)
      } else if (delta?.type === 'thinking_delta') {
        const thinking = delta.thinking ?? ''
        if (contentBlocks[index]) {
          contentBlocks[index].thinking = (contentBlocks[index].thinking || '') + thinking
        }
        if (thinking) {
          callbacks.onThinkingDelta(thinking, index)
        }
      }
      break
    }

    case 'content_block_stop': {
      const index = event.index
      const block = contentBlocks[index]

      if (block?.type === 'thinking') {
        callbacks.onThinkingStop(index)
      }

      // For tool_use blocks, parse the accumulated JSON
      if (block?.type === 'tool_use' && inputJSONBuffers.has(index)) {
        const jsonStr = inputJSONBuffers.get(index) || ''
        if (jsonStr) {
          try {
            block.input = JSON.parse(jsonStr)
          } catch (e) {
            // JSON parse failed - set to empty object and log error
            callbacks.onError(new Error(`JSON parse error for tool_use at index ${index}: ${e}`))
            block.input = {}
          }
        }
        inputJSONBuffers.delete(index)

        // Notify tool_use complete
        callbacks.onToolUseComplete(index, {
          id: block.id!,
          name: block.name!,
          input: block.input
        })
      }
      break
    }

    case 'message_delta': {
      if (event.delta?.stop_reason) {
        setStopInfo(event.delta.stop_reason, event.delta.stop_sequence ?? null)
      }
      if (event.usage) {
        const u = extractTokenUsage(event.usage)
        if (u) onUsage(u)
      }
      break
    }

    case 'message_stop':
      // Clear any remaining buffers
      inputJSONBuffers.clear()
      break

    default:
      // Unknown event type - ignore silently
      break
  }
}

function maybeBuildApiErrorMessage(event: any): string | null {
  const isTypedError = event?.type === 'error'
  const isErrorEnvelope = !event?.type && event?.error && typeof event.error === 'object'
  if (!isTypedError && !isErrorEnvelope) return null

  const status = getApiErrorStatus(event)
  const payload = safeJsonStringify(event)
  return status == null ? `API Error: ${payload}` : `API Error: ${status} ${payload}`
}

function getApiErrorStatus(event: any): number | null {
  const directStatus = Number(event?.status)
  if (Number.isFinite(directStatus) && directStatus > 0) return directStatus

  const nestedStatus = Number(event?.error?.status)
  if (Number.isFinite(nestedStatus) && nestedStatus > 0) return nestedStatus

  return null
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const out: TokenUsage = {}

  const input = r.input_tokens
  const output = r.output_tokens
  const cacheRead = r.cache_read_input_tokens
  const cacheCreate = r.cache_creation_input_tokens

  if (typeof input === 'number' && Number.isFinite(input)) out.input_tokens = input
  if (typeof output === 'number' && Number.isFinite(output)) out.output_tokens = output
  if (typeof cacheRead === 'number' && Number.isFinite(cacheRead)) out.cache_read_input_tokens = cacheRead
  if (typeof cacheCreate === 'number' && Number.isFinite(cacheCreate))
    out.cache_creation_input_tokens = cacheCreate

  return Object.keys(out).length > 0 ? out : null
}

function mergeUsageMax(target: TokenUsage, next: TokenUsage): void {
  if (typeof next.input_tokens === 'number') {
    target.input_tokens = Math.max(target.input_tokens ?? 0, next.input_tokens)
  }
  if (typeof next.output_tokens === 'number') {
    target.output_tokens = Math.max(target.output_tokens ?? 0, next.output_tokens)
  }
  if (typeof next.cache_read_input_tokens === 'number') {
    target.cache_read_input_tokens = Math.max(target.cache_read_input_tokens ?? 0, next.cache_read_input_tokens)
  }
  if (typeof next.cache_creation_input_tokens === 'number') {
    target.cache_creation_input_tokens = Math.max(
      target.cache_creation_input_tokens ?? 0,
      next.cache_creation_input_tokens,
    )
  }
}

/**
 * Helper to create a mock SSE stream for testing
 */
export function createMockSSEStream(events: any[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0

  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        const event = events[index++]
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      } else {
        controller.close()
      }
    }
  })
}
