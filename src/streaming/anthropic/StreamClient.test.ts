import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolCall, ToolResult } from '../../tools/types'

const parseAnthropicSSEStreamMock = vi.fn()

vi.mock('./sseParser', () => {
  return {
    parseAnthropicSSEStream: (...args: any[]) => parseAnthropicSSEStreamMock(...args),
  }
})

describe('AnthropicStreamClient.streamOnce', () => {
  beforeEach(() => {
    parseAnthropicSSEStreamMock.mockReset()
    ;(globalThis as any).fetch = vi.fn()
  })

  it('throws when HTTP response is not ok', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      body: null,
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      }),
    ).rejects.toThrow('HTTP 429: rate limited')
  })

  it('throws when response body is missing', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: null,
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      }),
    ).rejects.toThrow('No response body')
  })

  it('includes thinking in request body by default', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: undefined,
      }
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(init.headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14')
  })

  it('uses per-turn model override when provided', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })

    const events: any[] = []
    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm-default',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      model: 'm-override',
      onEvent: (e) => events.push(e),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.model).toBe('m-override')
    expect(events.some((e) => e.type === 'usage' && e.model === 'm-override')).toBe(true)
  })

  it('omits thinking and thinking headers when thinkingEnabled is false', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: undefined,
      }
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      thinkingEnabled: false,
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.thinking).toBeUndefined()
    expect(init.headers['anthropic-beta']).toBeUndefined()
  })

  it('retries without thinking when provider rejects thinking fields', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unknown field: thinking',
        body: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        body: {} as any,
      })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: undefined,
      }
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect((globalThis.fetch as any).mock.calls).toHaveLength(2)

    const [, firstInit] = (globalThis.fetch as any).mock.calls[0]
    const firstBody = JSON.parse(firstInit.body)
    expect(firstBody.thinking).toBeDefined()
    expect(firstInit.headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14')

    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    const secondBody = JSON.parse(secondInit.body)
    expect(secondBody.thinking).toBeUndefined()
    expect(secondInit.headers['anthropic-beta']).toBeUndefined()
  })

  it('emits tool_start/tool_input/tool_end and returns sorted toolResults', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash', input: { command: 'echo 1' } })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } }],
        stopReason: 'tool_use',
        usage: { input_tokens: 2, output_tokens: 3 },
      }
    })

    const events: any[] = []
    const executeTool = vi.fn(async (call: ToolCall) => {
      return { tool_use_id: call.id, content: 'ok' }
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (e) => events.push(e),
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(events.some((e) => e.type === 'tool_start' && e.id === 't1' && e.name === 'Bash')).toBe(true)
    expect(events.some((e) => e.type === 'tool_input' && e.id === 't1')).toBe(true)
    expect(events.some((e) => e.type === 'tool_end' && e.id === 't1')).toBe(true)
    expect(events.some((e) => e.type === 'usage' && e.model === 'm')).toBe(true)

    expect(out.toolResults).toEqual([{ tool_use_id: 't1', content: 'ok' }])
    expect(out.stopReason).toBe('tool_use')
  })

  it('emits tool_end with error result when executeTool throws', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash', input: { command: 'echo 1' } })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } }],
        stopReason: 'tool_use',
        usage: undefined,
      }
    })

    const events: any[] = []
    const executeTool = vi.fn(async () => {
      throw new Error('boom')
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (e) => events.push(e),
      executeTool,
    })

    const toolEnd = events.find((e) => e.type === 'tool_end' && e.id === 't1')
    expect(toolEnd?.result?.is_error).toBe(true)
    expect(String(toolEnd?.result?.content || '')).toContain('Error: boom')

    expect(out.toolResults).toEqual([
      {
        tool_use_id: 't1',
        content: 'Error: boom',
        is_error: true,
      },
    ])
  })

  it('awaits pending tool executions before returning', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash', input: { command: 'echo 1' } })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } }],
        stopReason: 'tool_use',
        usage: undefined,
      }
    })

    let resolveTool: ((v: ToolResult) => void) | null = null
    const toolPromise = new Promise<ToolResult>((resolve) => {
      resolveTool = resolve
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    let returned = false
    const p = client
      .streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => toolPromise,
      })
      .then(() => {
        returned = true
      })

    await new Promise((r) => setTimeout(r, 0))
    expect(returned).toBe(false)

    resolveTool?.({ tool_use_id: 't1', content: 'ok' })
    await p
    expect(returned).toBe(true)
  })

  it('normalizes baseUrl that already ends with /v1 and does not emit usage for empty objects', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [],
        stopReason: 'end_turn',
        usage: {},
      }
    })

    const events: any[] = []

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example/v1/',
      model: 'm',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (e) => events.push(e),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://example/v1/messages')
    expect(events.some((e) => e.type === 'usage')).toBe(false)
  })

  it('emits an aborted tool_result when onEvent aborts the signal during tool_input', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash', input: { command: 'echo 1' } })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } }],
        stopReason: 'tool_use',
        usage: undefined,
      }
    })

    const abortController = new AbortController()
    const events: any[] = []
    const executeTool = vi.fn(async () => ({ tool_use_id: 't1', content: 'ok' }))

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      signal: abortController.signal,
      onEvent: (e) => {
        events.push(e)
        if (e.type === 'tool_input') abortController.abort()
      },
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(0)
    const toolEnd = events.find((e) => e.type === 'tool_end' && e.id === 't1')
    expect(toolEnd?.result?.is_error).toBe(true)
    expect(toolEnd?.result?.content).toBe('Request aborted')
    expect(out.toolResults).toEqual([{ tool_use_id: 't1', content: 'Request aborted', is_error: true }])
  })

  it('forwards assistant deltas and maps content blocks into assistantBlocks', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onTextDelta('hi')
      callbacks.onThinkingDelta('hmm')
      return {
        contentBlocks: [
          { type: 'text', text: 'hello' },
          { type: 'thinking', thinking: 'think' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } },
          { type: 'foo', bar: 1 },
        ],
        stopReason: 'end_turn',
        usage: undefined,
      }
    })

    const events: any[] = []

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (e) => events.push(e),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'hi')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_delta' && e.thinking === 'hmm')).toBe(true)
    expect(out.assistantBlocks).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'think' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo 1' } },
      { type: 'foo', bar: 1 },
    ])
  })
})
