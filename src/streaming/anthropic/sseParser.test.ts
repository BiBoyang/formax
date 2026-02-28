/**
 * Property-based tests for SSE Streaming Parser
 * 
 * Feature: streaming-chat-refactor
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check'
import {
  parseAnthropicSSEStream,
  createMockSSEStream,
  SSECallbacks,
  ContentBlock
} from './sseParser'

// Helper to create default callbacks with spies
function createMockCallbacks(): SSECallbacks & {
  textDeltas: Array<{ text: string; index: number }>
  thinkingDeltas: Array<{ thinking: string; index: number }>
  thinkingStops: Array<{ index: number }>
  toolStarts: Array<{ id: string; name: string; index: number }>
  toolCompletes: Array<{ index: number; toolUse: any }>
  errors: Error[]
  completions: Array<{ stopReason: string | null; content: ContentBlock[] }>
} {
  const textDeltas: Array<{ text: string; index: number }> = []
  const thinkingDeltas: Array<{ thinking: string; index: number }> = []
  const thinkingStops: Array<{ index: number }> = []
  const toolStarts: Array<{ id: string; name: string; index: number }> = []
  const toolCompletes: Array<{ index: number; toolUse: any }> = []
  const errors: Error[] = []
  const completions: Array<{ stopReason: string | null; content: ContentBlock[] }> = []

  return {
    textDeltas,
    thinkingDeltas,
    thinkingStops,
    toolStarts,
    toolCompletes,
    errors,
    completions,
    onTextDelta: (text, index) => textDeltas.push({ text, index }),
    onThinkingDelta: (thinking, index) => thinkingDeltas.push({ thinking, index }),
    onThinkingStop: (index) => thinkingStops.push({ index }),
    onToolUseStart: (id, name, index) => toolStarts.push({ id, name, index }),
    onToolUseComplete: (index, toolUse) => toolCompletes.push({ index, toolUse }),
    onError: (error) => errors.push(error),
    onMessageComplete: (stopReason, content) => completions.push({ stopReason, content })
  }
}

describe('SSE Streaming Parser', () => {
  it('emits a thinking stop callback when a thinking block ends', async () => {
    const callbacks = createMockCallbacks()
    const events = [
      { type: 'message_start', message: { id: 'msg_1', role: 'assistant' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hello' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' }
    ]

    const stream = createMockSSEStream(events)
    await parseAnthropicSSEStream(stream, callbacks)

    expect(callbacks.thinkingDeltas).toEqual([{ thinking: 'hello', index: 0 }])
    expect(callbacks.thinkingStops).toEqual([{ index: 0 }])
  })

  /**
   * Property 2: SSE Text Delta Accumulation
   * 
   * For any sequence of content_block_delta events with text_delta type for a given block index,
   * the accumulated text in the content block SHALL equal the concatenation of all delta.text values in order.
   * 
   * **Validates: Requirements 2.4**
   */
  describe('Property 2: SSE Text Delta Accumulation', () => {
    it('should accumulate text deltas correctly for any sequence of text fragments', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate array of non-empty text fragments
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 20 }),
          async (textFragments) => {
            const callbacks = createMockCallbacks()
            
            // Build SSE events
            const events = [
              { type: 'message_start', message: { id: 'msg_1', role: 'assistant' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              ...textFragments.map(text => ({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text }
              })),
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
              { type: 'message_stop' }
            ]

            const stream = createMockSSEStream(events)
            const result = await parseAnthropicSSEStream(stream, callbacks)

            // Verify accumulated text equals concatenation of all fragments
            const expectedText = textFragments.join('')
            const actualText = result.contentBlocks[0]?.text || ''
            
            expect(actualText).toBe(expectedText)
            
            // Verify all text deltas were reported via callback
            const callbackText = callbacks.textDeltas.map(d => d.text).join('')
            expect(callbackText).toBe(expectedText)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should handle multiple text blocks independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
          async (block0Fragments, block1Fragments) => {
            const callbacks = createMockCallbacks()
            
            const events = [
              { type: 'message_start', message: { id: 'msg_1' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
              // Interleave deltas from both blocks
              ...block0Fragments.flatMap((text, i) => [
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
                ...(block1Fragments[i] ? [{ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: block1Fragments[i] } }] : [])
              ]),
              // Add remaining block1 fragments
              ...block1Fragments.slice(block0Fragments.length).map(text => ({
                type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text }
              })),
              { type: 'content_block_stop', index: 0 },
              { type: 'content_block_stop', index: 1 },
              { type: 'message_stop' }
            ]

            const stream = createMockSSEStream(events)
            const result = await parseAnthropicSSEStream(stream, callbacks)

            expect(result.contentBlocks[0]?.text).toBe(block0Fragments.join(''))
            expect(result.contentBlocks[1]?.text).toBe(block1Fragments.join(''))
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  /**
   * Property 3: SSE JSON Input Round-Trip
   * 
   * For any valid JSON object, if it is split into arbitrary fragments and sent as a sequence
   * of input_json_delta events, then after content_block_stop the parsed input field SHALL be
   * equivalent to the original JSON object.
   * 
   * **Validates: Requirements 2.5, 2.6**
   */
  describe('Property 3: SSE JSON Input Round-Trip', () => {
    it('should correctly parse JSON split into arbitrary fragments', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary JSON-serializable objects
          fc.jsonValue(),
          // Generate number of fragments to split into
          fc.integer({ min: 1, max: 10 }),
          async (jsonValue, numFragments) => {
            const callbacks = createMockCallbacks()
            const jsonStr = JSON.stringify(jsonValue)
            
            // Split JSON string into fragments
            const fragments: string[] = []
            const fragmentSize = Math.max(1, Math.ceil(jsonStr.length / numFragments))
            for (let i = 0; i < jsonStr.length; i += fragmentSize) {
              fragments.push(jsonStr.slice(i, i + fragmentSize))
            }

            const events = [
              { type: 'message_start', message: { id: 'msg_1' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'TestTool' } },
              ...fragments.map(partial_json => ({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json }
              })),
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
              { type: 'message_stop' }
            ]

            const stream = createMockSSEStream(events)
            const result = await parseAnthropicSSEStream(stream, callbacks)

            // Verify round-trip in JSON terms (e.g. JSON has no -0, so -0 becomes 0)
            const expectedValue = JSON.parse(jsonStr)
            expect(result.contentBlocks[0]?.input).toEqual(expectedValue)
            
            // Verify tool complete callback was called with correct input
            expect(callbacks.toolCompletes.length).toBe(1)
            expect(callbacks.toolCompletes[0].toolUse.input).toEqual(expectedValue)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should handle complex nested objects', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            command: fc.string(),
            timeout: fc.integer({ min: 0, max: 600000 }),
            options: fc.record({
              cwd: fc.string(),
              env: fc.dictionary(fc.string(), fc.string())
            })
          }),
          async (toolInput) => {
            const callbacks = createMockCallbacks()
            const jsonStr = JSON.stringify(toolInput)
            
            // Split into 3 fragments
            const f1 = jsonStr.slice(0, Math.floor(jsonStr.length / 3))
            const f2 = jsonStr.slice(Math.floor(jsonStr.length / 3), Math.floor(2 * jsonStr.length / 3))
            const f3 = jsonStr.slice(Math.floor(2 * jsonStr.length / 3))

            const events = [
              { type: 'message_start', message: { id: 'msg_1' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'Bash' } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: f1 } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: f2 } },
              { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: f3 } },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' }
            ]

            const stream = createMockSSEStream(events)
            const result = await parseAnthropicSSEStream(stream, callbacks)

            expect(result.contentBlocks[0]?.input).toEqual(toolInput)
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  /**
   * Property 4: SSE Error Resilience
   * 
   * For any SSE event stream containing malformed events (invalid JSON, missing fields),
   * the parser SHALL continue processing subsequent valid events and invoke callbacks for them.
   * 
   * **Validates: Requirements 2.9, 2.10**
   */
  describe('Property 4: SSE Error Resilience', () => {
    it('should continue processing after malformed JSON in tool input', async () => {
      const callbacks = createMockCallbacks()
      
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'Test' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"invalid": ' } },
        // Missing closing brace - will fail to parse
        { type: 'content_block_stop', index: 0 },
        // Should still process this text block
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' }
      ]

      const stream = createMockSSEStream(events)
      const result = await parseAnthropicSSEStream(stream, callbacks)

      // Tool input should be empty object due to parse failure
      expect(result.contentBlocks[0]?.input).toEqual({})
      
      // Error should have been reported
      expect(callbacks.errors.length).toBeGreaterThan(0)
      
      // But text block should still be processed correctly
      expect(result.contentBlocks[1]?.text).toBe('Hello')
      expect(callbacks.textDeltas.length).toBe(1)
    })

    it('should handle streams with random malformed events interspersed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
          async (validTexts) => {
            const callbacks = createMockCallbacks()
            
            // Create events with some "malformed" ones (actually we can't inject truly malformed
            // JSON into createMockSSEStream, but we can test with missing/null fields)
            const events = [
              { type: 'message_start', message: { id: 'msg_1' } },
              { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
              // Unknown event type - should be ignored
              { type: 'unknown_event_type', data: 'garbage' },
              ...validTexts.map(text => ({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text }
              })),
              // Another unknown event
              { type: 'weird_event' },
              { type: 'content_block_stop', index: 0 },
              { type: 'message_stop' }
            ]

            const stream = createMockSSEStream(events)
            const result = await parseAnthropicSSEStream(stream, callbacks)

            // Valid text should still be accumulated correctly
            expect(result.contentBlocks[0]?.text).toBe(validTexts.join(''))
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('Additional unit coverage', () => {
    it('handles thinking blocks (start + delta) and reports deltas', async () => {
      const callbacks = createMockCallbacks()

      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 't0' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 't1' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ]

      const stream = createMockSSEStream(events)
      const result = await parseAnthropicSSEStream(stream, callbacks)

      expect(result.contentBlocks[0]?.type).toBe('thinking')
      expect(result.contentBlocks[0]?.thinking).toBe('t0t1')
      expect(callbacks.thinkingDeltas.map((d) => d.thinking).join('')).toBe('t0t1')
      expect(result.stopReason).toBe('end_turn')
    })

    it('auto-creates missing blocks for deltas (text/input_json/thinking)', async () => {
      const callbacks = createMockCallbacks()

      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":1' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: 'hmm' } },
        { type: 'message_stop' },
      ]

      const stream = createMockSSEStream(events)
      const result = await parseAnthropicSSEStream(stream, callbacks)

      expect(result.contentBlocks[0]?.type).toBe('text')
      expect(result.contentBlocks[0]?.text).toBe('hello')
      expect(callbacks.textDeltas.map((d) => d.text).join('')).toBe('hello')

      expect(result.contentBlocks[1]?.type).toBe('tool_use')
      expect(result.contentBlocks[1]?.input).toEqual({})

      expect(result.contentBlocks[2]?.type).toBe('thinking')
      expect(result.contentBlocks[2]?.thinking).toBe('hmm')
      expect(callbacks.thinkingDeltas.map((d) => d.thinking).join('')).toBe('hmm')
    })

    it('captures stop_reason/stop_sequence and usage from message_start + message_delta', async () => {
      const callbacks = createMockCallbacks()

      const events = [
        { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 1, output_tokens: 2 } } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: '<seq>' }, usage: { input_tokens: 3 } },
        { type: 'message_stop' },
      ]

      const stream = createMockSSEStream(events)
      const result = await parseAnthropicSSEStream(stream, callbacks)

      expect(result.stopReason).toBe('tool_use')
      expect(result.stopSequence).toBe('<seq>')
      expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 2 })
    })

    it('flushes a trailing data: buffer without newline separators', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}`),
          )
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)
      expect(result.stopReason).toBe('end_turn')
    })

    it('reports SSE JSON parse errors but continues processing subsequent events', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()

      const raw =
        [
          `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1' } })}`,
          'data: {not-json',
          `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
          `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })}`,
          `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
          `data: ${JSON.stringify({ type: 'message_stop' })}`,
        ].join('\n\n') + '\n\n'

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(raw))
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)

      expect(callbacks.errors.length).toBeGreaterThan(0)
      expect(result.contentBlocks[0]?.text).toBe('ok')
    })

    it('throws when aborted via AbortSignal', async () => {
      const callbacks = createMockCallbacks()
      const controller = new AbortController()
      controller.abort()

      const stream = createMockSSEStream([{ type: 'message_stop' }])

      await expect(parseAnthropicSSEStream(stream, callbacks, controller.signal)).rejects.toThrow('Stream aborted')
    })

    it('reports trailing-buffer handler errors instead of rejecting for non-fatal callback failures', async () => {
      const callbacks = createMockCallbacks()
      callbacks.onTextDelta = () => {
        throw new Error('boom')
      }
      callbacks.onError = (error) => {
        callbacks.errors.push(error)
      }

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'ok' },
              })}`,
            ),
          )
          controller.close()
        },
      })

      const out = await parseAnthropicSSEStream(stream, callbacks)
      expect(out.contentBlocks[0]?.text).toBe('ok')
      expect(callbacks.errors.length).toBeGreaterThan(0)
      expect(String(callbacks.errors[0]?.message || '')).toContain('SSE event handler error')
    })

    it('throws an API error when the stream emits an explicit error event', async () => {
      const callbacks = createMockCallbacks()
      const stream = createMockSSEStream([
        {
          type: 'error',
          error: { type: 'rate_limit_error', status: 429, message: '余额不足或无可用资源包,请充值。', code: '1113' },
          request_id: 'req_123',
        },
      ])

      await expect(parseAnthropicSSEStream(stream, callbacks)).rejects.toThrow(/API Error: 429/i)
    })

    it('throws an API error for error envelopes without a type field', async () => {
      const callbacks = createMockCallbacks()
      const stream = createMockSSEStream([
        {
          error: { code: '1113', message: '余额不足或无可用资源包,请充值。' },
          request_id: 'req_456',
        },
      ])

      await expect(parseAnthropicSSEStream(stream, callbacks)).rejects.toThrow(/API Error/i)
    })

    it('ignores empty/[DONE] payload lines without affecting completion', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(['data: [DONE]', 'data:   '].join('\n\n') + '\n\n'))
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)
      expect(result.stopReason).toBeNull()
      expect(result.contentBlocks).toEqual([])
    })

    it('ignores non-object JSON events', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(['data: 1', `data: ${JSON.stringify({ type: 'message_stop' })}`].join('\n\n') + '\n\n'))
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)
      expect(result.contentBlocks).toEqual([])
    })

    it('throws typed error using top-level status when present', async () => {
      const callbacks = createMockCallbacks()
      const stream = createMockSSEStream([
        {
          type: 'error',
          status: 503,
          error: { message: 'upstream unavailable' },
        },
      ])

      await expect(parseAnthropicSSEStream(stream, callbacks)).rejects.toThrow(/API Error: 503/i)
    })

    it('ignores non-object usage payloads', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1', usage: 'invalid' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: 'invalid' },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.usage).toBeUndefined()
    })

    it('rethrows FatalSSEError from trailing-buffer handler', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', error: { status: 429, message: 'rate limit' } })}`,
            ),
          )
          controller.close()
        },
      })

      await expect(parseAnthropicSSEStream(stream, callbacks)).rejects.toThrow(/API Error: 429/i)
    })

    it('reports non-fatal handler errors during normal line processing', async () => {
      const callbacks = createMockCallbacks()
      callbacks.onTextDelta = () => {
        throw new Error('normal-line-failure')
      }
      callbacks.onError = (error) => {
        callbacks.errors.push(error)
      }

      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'boom' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]

      const out = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(out.contentBlocks[0]?.text).toBe('boom')
      expect(callbacks.errors.some((e) => String(e.message).includes('SSE event handler error'))).toBe(true)
    })

    it('accumulates signature_delta into thinking block signature', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'h', signature: 's0' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '_s1' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.contentBlocks[0]?.signature).toBe('s0_s1')
    })

    it('creates thinking block when signature_delta arrives before block start', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.contentBlocks[0]?.type).toBe('thinking')
      expect(result.contentBlocks[0]?.signature).toBe('sig')
    })

    it('extracts and merges cache token usage with max semantics', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
          },
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
        },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.usage).toEqual({
        input_tokens: 2,
        output_tokens: 1,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 3,
      })
    })

    it('captures usage from trailing unflushed data buffer', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { input_tokens: 9, output_tokens: 8 },
              })}`,
            ),
          )
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)
      expect(result.stopReason).toBe('end_turn')
      expect(result.usage).toEqual({ input_tokens: 9, output_tokens: 8 })
    })

    it('handles empty deltas and tool_stop without json payload', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: '' } },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Bash' } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: {} },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(callbacks.textDeltas).toEqual([])
      expect(callbacks.thinkingDeltas).toEqual([])
      expect(callbacks.toolCompletes[0].toolUse.input).toEqual({})
      expect(result.stopReason).toBeNull()
    })

    it('returns no usage when usage object has no numeric fields', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 'x' } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 'y' } },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.usage).toBeUndefined()
    })

    it('merges partial usage deltas when only output tokens are provided', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 1 } } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.usage).toEqual({ input_tokens: 1, output_tokens: 3 })
    })

    it('handles deltas with missing text/json/thinking/signature fields', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta' } },
        { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta' } },
        { type: 'content_block_delta', index: 3, delta: { type: 'signature_delta' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.contentBlocks[0]?.text).toBe('')
      expect(result.contentBlocks[2]?.thinking).toBe('')
      expect(result.contentBlocks[3]?.signature).toBe('')
      expect(callbacks.textDeltas).toEqual([])
      expect(callbacks.thinkingDeltas).toEqual([])
    })

    it('covers trailing [DONE], empty thinking start, and unknown delta types', async () => {
      const callbacks = createMockCallbacks()
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1' } })}`,
                `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })}`,
                `data: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'unknown_delta' } })}`,
                `data: ${JSON.stringify({ type: 'message_stop' })}`,
                'data: [DONE]',
              ].join('\n\n'),
            ),
          )
          controller.close()
        },
      })

      const result = await parseAnthropicSSEStream(stream, callbacks)
      expect(result.stopReason).toBeNull()
      expect(callbacks.thinkingDeltas).toEqual([])
    })

    it('ignores unsupported content_block_start types', async () => {
      const callbacks = createMockCallbacks()
      const events = [
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'unsupported' } },
        { type: 'message_stop' },
      ]

      const result = await parseAnthropicSSEStream(createMockSSEStream(events), callbacks)
      expect(result.contentBlocks[0]).toBeUndefined()
    })
  })
})
