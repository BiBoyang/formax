import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolResult } from '../../tools/types'

function createOpenAiSSEStream(events: Array<string | Record<string, unknown>>) {
  const encoder = new TextEncoder()
  const chunks = events.map((event) => {
    const payload = typeof event === 'string' ? event : JSON.stringify(event)
    return encoder.encode(`data: ${payload}\n\n`)
  })
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('OpenAIStreamClient.streamOnce', () => {
  beforeEach(() => {
    ;(globalThis as any).fetch = vi.fn()
  })

  it('streams assistant deltas from SSE chat/completions', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        { choices: [{ delta: { content: 'hello ' }, finish_reason: null }], model: 'gpt-4o' },
        { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
        '[DONE]',
      ]),
    })

    const events: any[] = []
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://example/v1/chat/completions')
    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'hello world' }])
    expect(out.stopReason).toBe('end_turn')
    expect(out.toolResults).toEqual([])
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'hello ')).toBe(true)
    expect(events.some((e) => e.type === 'usage' && e.usage.output_tokens === 2)).toBe(true)
  })

  it('executes tool_calls when finish_reason is tool_calls', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{"command":"ls"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        '[DONE]',
      ]),
    })

    const executeTool = vi.fn(async () => ({ tool_use_id: 'call_1', content: 'ok' } as ToolResult))
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [
        {
          name: 'Bash',
          description: 'run bash',
          input_schema: { type: 'object', properties: {} } as any,
        },
      ],
      onEvent: () => {},
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(executeTool).toHaveBeenCalledWith({ id: 'call_1', name: 'Bash', input: { command: 'ls' } })
    expect(out.stopReason).toBe('tool_use')
    expect(out.assistantBlocks).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } })
    expect(out.toolResults).toEqual([{ tool_use_id: 'call_1', content: 'ok' }])
  })

  it('executes tool_calls when finish_reason is function_call', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'Bash', arguments: '{"command":"ls"}' },
                },
              ],
            },
            finish_reason: 'function_call',
          },
        ],
      }),
    })

    const executeTool = vi.fn(async () => ({ tool_use_id: 'call_1', content: 'ok' } as ToolResult))
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [
        {
          name: 'Bash',
          description: 'run bash',
          input_schema: { type: 'object', properties: {} } as any,
        },
      ],
      onEvent: () => {},
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(out.stopReason).toBe('tool_use')
    expect(out.toolResults).toEqual([{ tool_use_id: 'call_1', content: 'ok' }])
  })

  it('supports JSON response fallback when server does not return SSE', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => ({
        model: 'gpt-4o-mini',
        choices: [{ message: { content: 'json hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    })

    const events: any[] = []
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'json hello' }])
    expect(out.stopReason).toBe('end_turn')
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'json hello')).toBe(true)
    expect(events.some((e) => e.type === 'usage' && e.model === 'gpt-4o-mini')).toBe(true)
  })

  it('does not execute partial tool_calls when finish_reason is not tool_calls', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_partial',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{"command":"ls"}' },
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const executeTool = vi.fn(async () => ({ tool_use_id: 'call_partial', content: 'ok' } as ToolResult))
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(0)
    expect(out.assistantBlocks).toEqual([])
    expect(out.stopReason).toBe('end_turn')
    expect(out.toolResults).toEqual([])
  })

  it('uses snapshot tool arguments when delta tool_calls are partial', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"' },
                  },
                ],
              },
              message: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"ls\"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const executeTool = vi.fn(async () => ({ tool_use_id: 'call_1', content: 'ok' } as ToolResult))
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledWith({ id: 'call_1', name: 'Bash', input: { command: 'ls' } })
  })

  it('captures reasoning_content from stream and returns it as thinking block', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                reasoning_content: 'let me think',
                content: 'done',
              },
              finish_reason: 'stop',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const events: any[] = []
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(out.assistantBlocks).toEqual([
      { type: 'thinking', thinking: 'let me think' },
      { type: 'text', text: 'done' },
    ])
    expect(events.some((e) => e.type === 'thinking_delta' && e.thinking === 'let me think')).toBe(true)
    expect(events.some((e) => e.type === 'thinking_stop')).toBe(true)
  })

  it('suppresses thinking events/blocks when thinkingEnabled is false', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                reasoning_content: 'hidden-thought',
                content: 'answer',
              },
              finish_reason: 'stop',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const events: any[] = []
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (ev) => events.push(ev),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      thinkingEnabled: false,
    })

    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'answer' }])
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false)
    expect(events.some((e) => e.type === 'thinking_stop')).toBe(false)
  })

  it('keeps separate tool calls when deltas omit index', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"echo 1\"}' },
                  },
                  {
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"echo 2\"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const executeTool = vi.fn(async (call: any) => ({ tool_use_id: call.id, content: 'ok' } as ToolResult))
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenNthCalledWith(1, { id: 'call_1', name: 'Bash', input: { command: 'echo 1' } })
    expect(executeTool).toHaveBeenNthCalledWith(2, { id: 'call_2', name: 'Bash', input: { command: 'echo 2' } })
  })

  it('executes multiple tool calls concurrently', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"echo 1\"}' },
                  },
                  {
                    index: 1,
                    id: 'call_2',
                    type: 'function',
                    function: { name: 'Bash', arguments: '{\"command\":\"echo 2\"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const started: string[] = []
    const executeTool = vi.fn(async (call: any) => {
      started.push(call.id)
      if (call.id === 'call_1') {
        await firstGate
      }
      return { tool_use_id: call.id, content: 'ok' } as ToolResult
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    const run = client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool,
    })

    for (let i = 0; i < 50 && started.length < 2; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(started).toEqual(['call_1', 'call_2'])
    releaseFirst?.()
    await run
  })

  it('preserves custom versioned baseUrl (e.g. /v2) without appending /v1', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example/v2',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })

    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://example/v2/chat/completions')
  })

  it('keeps tool messages contiguous and moves user text after tool_results', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'echo 1' } },
            { type: 'tool_use', id: 'call_2', name: 'Bash', input: { command: 'echo 2' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: '1' },
            { type: 'text', text: 'next step' },
            { type: 'tool_result', tool_use_id: 'call_2', content: '2' },
          ],
        },
      ],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"echo 2"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '1' },
      { role: 'tool', tool_call_id: 'call_2', content: '2' },
      { role: 'user', content: 'next step' },
    ])
  })

  it('keeps tool messages contiguous across multiple user messages', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'echo 1' } },
            { type: 'tool_use', id: 'call_2', name: 'Bash', input: { command: 'echo 2' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: '1' },
            { type: 'text', text: 'ctx-1' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_2', content: '2' },
            { type: 'text', text: 'ctx-2' },
          ],
        },
      ],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })

    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'Bash', arguments: '{"command":"echo 2"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '1' },
      { role: 'tool', tool_call_id: 'call_2', content: '2' },
      { role: 'user', content: 'ctx-1\n\nctx-2' },
    ])
  })

  it('retries with empty reasoning_content when provider requires it for tool_calls', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          '{"error":{"message":"Missing `reasoning_content` field in the assistant message at message index 4."}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }),
      })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await client.streamOnce({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'pwd' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '/tmp' }],
        },
      ],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })

    expect((globalThis.fetch as any).mock.calls).toHaveLength(2)
    const secondBody = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body)
    expect(secondBody.messages[0].reasoning_content).toBe('')
  })
})
