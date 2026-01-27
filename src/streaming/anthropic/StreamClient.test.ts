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
})
