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

  it('supports unknown content-type by falling back from empty SSE parse to cloned text body', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: createOpenAiSSEStream(['']),
      clone: () => ({
        text: async () => '{"choices":[{"message":{"content":"from-clone"},"finish_reason":"stop"}]}',
      }),
    })

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
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })

    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'from-clone' }])
  })

  it('falls back to response.text() when unknown content-type has no body stream', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: null,
      text: async () => '{"choices":[{"message":{"content":"from-text"},"finish_reason":"stop"}]}',
    })

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
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'from-text' }])
  })

  it('throws when text/event-stream response has no body', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: null,
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })
    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
      }),
    ).rejects.toThrow('No response body')
  })

  it('emits aborted tool result when external signal is aborted before execution', async () => {
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
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

    const controller = new AbortController()
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
      signal: controller.signal,
      onEvent: (ev) => {
        events.push(ev)
        if (ev.type === 'tool_input') controller.abort()
      },
      executeTool: async () => ({ tool_use_id: 'call_1', content: 'ok' }),
    })

    expect(out.toolResults).toEqual([{ tool_use_id: 'call_1', content: 'Request aborted', is_error: true }])
    expect(events.some((e) => e.type === 'tool_end' && e.result?.is_error)).toBe(true)
  })

  it('formats non-Error executeTool failures as string', async () => {
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
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

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
      executeTool: async () => {
        throw 'boom-string'
      },
    })
    expect(out.toolResults).toEqual([{ tool_use_id: 'call_1', content: 'Error: boom-string', is_error: true }])
  })

  it('throws HTTP error when initial non-retryable response is not ok', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
      }),
    ).rejects.toThrow('HTTP 429: rate limited')
  })

  it('handles missing response headers object by treating content-type as empty', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createOpenAiSSEStream(['']),
      text: async () => '{"choices":[{"message":{"content":"no-headers"},"finish_reason":"stop"}]}',
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
    })
    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'no-headers' }])
  })

  it('combines an external signal when provided', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    const controller = new AbortController()

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: '',
    })
    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      signal: controller.signal,
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(init.signal).toBeDefined()
  })

  it('uses fallback model in usage event and defaults stopReason to end_turn', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: createOpenAiSSEStream([
        { choices: [{ delta: { content: 'x' }, finish_reason: null }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
        '[DONE]',
      ]),
    })

    const events: any[] = []
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'model-fallback',
    })
    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: undefined as any,
      onEvent: (e) => events.push(e),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.stopReason).toBe('end_turn')
    expect(events.some((e) => e.type === 'usage' && e.model === 'model-fallback')).toBe(true)
  })

  it('executes timeout abort callback when request stalls', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockImplementationOnce(async (_url: string, init: any) => {
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted-timeout')), { once: true })
      })
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 10,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
      }),
    ).rejects.toThrow('aborted-timeout')
  })

  it('throws HTTP error when retry-with-empty-reasoning also fails', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Missing reasoning_content field',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'retry-failed',
      })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
      }),
    ).rejects.toThrow('HTTP 500: retry-failed')
  })

  it('uses response.text fallback when unknown content-type body parse is empty and clone is unavailable', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: createOpenAiSSEStream(['']),
      text: async () => '{"choices":[{"message":{"content":"from-body-text"},"finish_reason":"stop"}]}',
    })

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
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'from-body-text' }])
  })

  it('keeps SSE-parsed content for unknown content-type when parsed output is non-empty', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: createOpenAiSSEStream([
        { choices: [{ delta: { content: 'from-sse' }, finish_reason: 'stop' }] },
        '[DONE]',
      ]),
      text: async () => '{"choices":[{"message":{"content":"should-not-use"},"finish_reason":"stop"}]}',
    })

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
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.assistantBlocks).toEqual([{ type: 'text', text: 'from-sse' }])
  })

  it('returns empty parse result when unknown content-type body is empty and no text reader exists', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: createOpenAiSSEStream(['']),
    })

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
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
    })
    expect(out.assistantBlocks).toEqual([])
  })

  it('throws when unknown content-type has neither body nor text reader', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/octet-stream' },
      body: null,
    })

    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })
    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' }),
      }),
    ).rejects.toThrow('No response body')
  })

  it('formats Error executeTool failures from error.message', async () => {
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
              finish_reason: 'tool_calls',
            },
          ],
        },
        '[DONE]',
      ]),
    })

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
      executeTool: async () => {
        throw new Error('boom-error')
      },
    })
    expect(out.toolResults).toEqual([{ tool_use_id: 'call_1', content: 'Error: boom-error', is_error: true }])
  })
})

describe('__openAiStreamClientTestOnly helpers', () => {
  it('covers header/url/text helper branches', async () => {
    const { __openAiStreamClientTestOnly } = await import('./StreamClient')
    const h = __openAiStreamClientTestOnly

    expect(h.getOpenAiHeaders('k').Authorization).toBe('Bearer k')
    expect(h.normalizeBaseUrl(undefined)).toBe('')
    expect(h.normalizeBaseUrl('')).toBe('')
    expect(h.normalizeBaseUrl('http://example/')).toBe('http://example/v1')
    expect(h.normalizeBaseUrl('http://example/v1')).toBe('http://example/v1')
    expect(h.normalizeBaseUrl('http://example/v2')).toBe('http://example/v2')

    expect(h.promptBlockToText(null as any)).toBe('')
    expect(h.promptBlockToText({ type: 'text', text: 'hello' } as any)).toBe('hello')
    expect(h.promptBlockToText({} as any)).toBe('')
    expect(h.promptBlockToText({ type: 'thinking' } as any)).toBe('')
    expect(h.promptBlockToText({ type: 'thinking', thinking: 'hmm' } as any)).toBe('hmm')
    expect(h.promptBlockToText({ type: 'x', text: 'fallback-text' } as any)).toBe('fallback-text')
    expect(h.promptBlockToText({ type: 1, text: 2 } as any)).toBe('')
    expect(h.systemBlocksToText([{ type: 'text', text: 'a' }, { type: 'text', text: '' }, { type: 'thinking', thinking: 'b' }] as any)).toBe('a\n\nb')
    expect(h.systemBlocksToText(undefined as any)).toBe('')
  })

  it('covers prompt message mapping and tool-result normalization paths', async () => {
    const { __openAiStreamClientTestOnly } = await import('./StreamClient')
    const h = __openAiStreamClientTestOnly

    const out = h.promptMessagesToOpenAiMessages(
      [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pwd' } },
            { type: 'thinking', thinking: 'considering' },
            { type: 'text', text: 'done' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: '', is_error: true },
            { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true },
            { type: 'tool_result', tool_use_id: 't3', content: 'Error: bad', is_error: true },
            { type: 'text', text: 'follow-up' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'tail' }],
        },
      ] as any,
      [{ type: 'text', text: 'sys' }] as any,
      { forceEmptyReasoningForToolCalls: true },
    )

    expect(out[0]).toEqual({ role: 'system', content: 'sys' })
    expect(out[1]).toMatchObject({
      role: 'assistant',
      content: 'done',
      reasoning_content: 'considering',
    })
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'Error: tool execution failed' })
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't2', content: 'Error: boom' })
    expect(out[4]).toEqual({ role: 'tool', tool_call_id: 't3', content: 'Error: bad' })
    expect(out[5]).toEqual({ role: 'user', content: 'follow-up' })
    expect(out[6]).toEqual({ role: 'user', content: 'tail' })

    const forceEmpty = h.promptMessagesToOpenAiMessages(
      [{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] }] as any,
      [],
      { forceEmptyReasoningForToolCalls: true },
    )
    expect(forceEmpty[0].reasoning_content).toBe('')

    const sparse = h.promptMessagesToOpenAiMessages(
      [
        { role: 'assistant', content: [null, { type: 'tool_use' }, { type: 'thinking' }, { type: 'noop' }, {}] },
        { role: 'assistant', content: [{ type: 'text', text: 'text-only' }] },
        { role: 'assistant', content: [] },
        { role: 'user', content: [null, { type: 'tool_result', is_error: false, content: 'ok' }, { type: 'text' }] },
        { role: 'user', content: [{}] },
        { role: 'user' },
      ] as any,
      [],
    )
    expect(sparse[0]).toMatchObject({ role: 'assistant', content: null })
    expect(sparse[0].tool_calls[0]).toMatchObject({ id: '', function: { name: '', arguments: '{}' } })
    expect(sparse.some((m: any) => m.role === 'tool' && m.content === 'ok')).toBe(true)
    expect(
      h.promptMessagesToOpenAiMessages(undefined as any, [] as any).length,
    ).toBe(0)
    expect(
      h.promptMessagesToOpenAiMessages([{ role: 'assistant' }] as any, [] as any).length,
    ).toBe(0)
  })

  it('covers tool/input/content/reasoning/stop/usage helpers', async () => {
    const { __openAiStreamClientTestOnly } = await import('./StreamClient')
    const h = __openAiStreamClientTestOnly

    expect(h.mapToolsToOpenAi(undefined as any)).toEqual([])
    expect(h.mapToolsToOpenAi([{ name: 'Bash', description: 'run', input_schema: undefined } as any])[0]).toMatchObject({
      type: 'function',
      function: { name: 'Bash', description: 'run' },
    })
    expect(h.parseToolInput({ a: 1 })).toEqual({ a: 1 })
    expect(h.parseToolInput(1)).toEqual({})
    expect(h.parseToolInput('')).toEqual({})
    expect(h.parseToolInput('[]')).toEqual({})
    expect(h.parseToolInput('{"a":1}')).toEqual({ a: 1 })
    expect(h.parseToolInput('{bad')).toEqual({})

    expect(h.openAiMessageContentToText('s')).toBe('s')
    expect(h.openAiMessageContentToText([])).toBe('')
    expect(h.openAiMessageContentToText([{ type: 'text', text: 'a' }, { type: 'text', text: '' }, { type: 'other', text: 'b' }, null])).toBe('a')

    expect(h.openAiReasoningContentToText('r')).toBe('r')
    expect(h.openAiReasoningContentToText([{ text: 'a' }, { reasoning_content: 'b' }, { reasoning: 'c' }, { reasoning: '' }, null])).toBe('abc')
    expect(h.openAiReasoningContentToText({ text: 'x' })).toBe('x')
    expect(h.openAiReasoningContentToText({ reasoning_content: 'y' })).toBe('y')
    expect(h.openAiReasoningContentToText({ reasoning: 'z' })).toBe('z')
    expect(h.openAiReasoningContentToText({ reasoning: 1 } as any)).toBe('')
    expect(h.openAiReasoningContentToText(1)).toBe('')

    expect(h.mapOpenAiStopReason('tool_calls')).toBe('tool_use')
    expect(h.mapOpenAiStopReason('function_call')).toBe('tool_use')
    expect(h.mapOpenAiStopReason('stop')).toBe('end_turn')
    expect(h.mapOpenAiStopReason('length')).toBe('max_tokens')
    expect(h.mapOpenAiStopReason('content_filter')).toBe('content_filter')
    expect(h.mapOpenAiStopReason('')).toBeNull()
    expect(h.mapOpenAiStopReason(null)).toBeNull()
    expect(h.mapOpenAiStopReason('x')).toBe('x')

    expect(h.mapOpenAiUsage(null)).toBeUndefined()
    expect(h.mapOpenAiUsage({})).toBeUndefined()
    expect(
      h.mapOpenAiUsage({
        prompt_tokens: 3,
        completion_tokens: 2,
        prompt_tokens_details: { cached_tokens: 1 },
      }),
    ).toEqual({
      input_tokens: 3,
      output_tokens: 2,
      cache_read_input_tokens: 1,
    })
  })

  it('covers delta/snapshot/merge/materialize/parsing helpers', async () => {
    const { __openAiStreamClientTestOnly } = await import('./StreamClient')
    const h = __openAiStreamClientTestOnly

    expect(h.openAiDeltaContentToText('hi')).toBe('hi')
    expect(h.openAiDeltaContentToText([{ text: 'a' }, { text: 'b' }, { nope: 1 }, null])).toBe('ab')
    expect(h.openAiDeltaContentToText({})).toBe('')

    expect(h.applySnapshotTextDelta('', 'ab')).toEqual({ next: 'ab', appended: 'ab' })
    expect(h.applySnapshotTextDelta('ab', 'ab')).toEqual({ next: 'ab', appended: '' })
    expect(h.applySnapshotTextDelta('ab', 'abc')).toEqual({ next: 'abc', appended: 'c' })
    expect(h.applySnapshotTextDelta('abc', 'ax')).toEqual({ next: 'ax', appended: '' })
    expect(h.applySnapshotTextDelta('abc', '')).toEqual({ next: 'abc', appended: '' })

    const byKey = new Map<string, any>()
    h.mergeOpenAiToolCallDeltas(byKey, [null, { index: 0, id: 'id1', function: { name: 'Bash', arguments: '{"a":' } }], {
      appendArgs: true,
    })
    h.mergeOpenAiToolCallDeltas(byKey, [{ index: 0, function: { arguments: '1}' } }], { appendArgs: true })
    h.mergeOpenAiToolCallDeltas(byKey, [{ index: 0, id: 'id1', function: { arguments: '{"a":2}' } }], { appendArgs: false })
    const materialized = h.materializeOpenAiToolCalls(byKey)
    expect(materialized[0]).toEqual({ id: 'id1', name: 'Bash', input: { a: 2 } })

    const byPosOnly = new Map<string, any>()
    h.mergeOpenAiToolCallDeltas(byPosOnly, [{ function: { name: 'X', arguments: '{}' } }], {})
    expect(h.materializeOpenAiToolCalls(byPosOnly)[0].id).toBe('tool_1')
    h.mergeOpenAiToolCallDeltas(byPosOnly, [{ id: 'other', function: { arguments: '' } }], {})
    h.mergeOpenAiToolCallDeltas(byPosOnly, [{ id: 'different', function: { name: '', arguments: '' } }], {})
    h.mergeOpenAiToolCallDeltas(byPosOnly, 'no-array' as any, {})
    const unnamed = new Map<string, any>([['k', { sortOrder: 1, argumentsText: '{}' }]])
    expect(h.materializeOpenAiToolCalls(unnamed)[0].name).toBe('')

    expect(
      h.sortToolResultsByCallOrder(
        ['a', 'b'],
        [
          { tool_use_id: 'a', content: 'A1' },
          { tool_use_id: 'a', content: 'A2' },
        ],
      ),
    ).toEqual([
      { tool_use_id: 'a', content: 'A1' },
      { tool_use_id: 'b', content: expect.stringContaining('missing tool_result'), is_error: true },
    ])

    expect(h.parseOpenAiSseChunk('event: ping')).toEqual({ done: false })
    expect(h.parseOpenAiSseChunk('data:   \n\n')).toEqual({ done: false })
    expect(h.parseOpenAiSseChunk('data: [DONE]\n\n')).toEqual({ done: true })
    expect(h.parseOpenAiSseChunk('data: {\"a\":1}\n\n')).toEqual({ done: false, payload: { a: 1 } })

    expect(h.looksLikeSseBody('data: x\n\n')).toBe(true)
    expect(h.looksLikeSseBody('plain')).toBe(false)
    expect(h.hasParsedOpenAiContent({ assistantText: '', reasoningContent: '', toolCalls: [], stopReason: null, usage: undefined })).toBe(false)
    expect(h.hasParsedOpenAiContent({ assistantText: 'x', reasoningContent: '', toolCalls: [], stopReason: null, usage: undefined })).toBe(true)
    expect(h.findSseBoundary('abc')).toBeNull()
    expect(h.findSseBoundary('a\n\nb')).toEqual({ index: 1, length: 2 })
    expect(h.findSseBoundary('a\r\n\r\nb')).toEqual({ index: 1, length: 4 })
    expect(h.findSseBoundary('a\n\nb\r\n\r\nc')).toEqual({ index: 1, length: 2 })
    expect(h.findSseBoundary('x\r\n\r\ny\n\nz')).toEqual({ index: 1, length: 4 })
    expect(h.shouldRetryWithEmptyReasoningContent('missing reasoning_content field')).toBe(true)
    expect(h.shouldRetryWithEmptyReasoningContent(undefined as any)).toBe(false)
    expect(h.shouldRetryWithEmptyReasoningContent('other error')).toBe(false)
  })

  it('covers private parser and signal helpers', async () => {
    const { OpenAIStreamClient } = await import('./StreamClient')
    const client = new OpenAIStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'gpt-4o',
      timeoutMs: 1000,
    })
    const onEvent = vi.fn()

    expect((client as any).parseOpenAiJsonResponse(null, onEvent, true)).toEqual({
      assistantText: '',
      reasoningContent: '',
      toolCalls: [],
      stopReason: null,
    })

    expect(() => (client as any).parseOpenAiJsonResponse({ error: { message: 'bad' } }, onEvent, true)).toThrow(
      'OpenAI response error: bad',
    )

    const parsedJson = (client as any).parseOpenAiJsonResponse(
      {
        model: 'm2',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: [{ type: 'text', text: 'ok' }],
              reasoning_content: 'think',
              tool_calls: [{ id: 'c1', function: { name: 'Bash', arguments: '{"x":1}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
      onEvent,
      true,
    )
    expect(parsedJson.stopReason).toBe('end_turn')
    expect(parsedJson.toolCalls).toEqual([{ id: 'c1', name: 'Bash', input: { x: 1 } }])
    expect(onEvent).toHaveBeenCalledWith({ type: 'thinking_stop' })
    expect((client as any).parseOpenAiJsonResponse({ choices: {} }, onEvent, false)).toMatchObject({
      assistantText: '',
      stopReason: null,
    })
    expect(() => (client as any).parseOpenAiJsonResponse({ error: { code: 1 } }, onEvent, true)).toThrow(
      'OpenAI response error: [object Object]',
    )

    const sseParsed = await (client as any).parseOpenAiSSEStream({
      stream: createOpenAiSSEStream([
        {
          model: 'm3',
          usage: { prompt_tokens: 2, completion_tokens: 1 },
          choices: [
            {
              delta: {},
              message: {
                content: [{ type: 'text', text: 'snap' }],
                reasoning_content: 'rsnap',
                tool_calls: [{ id: 'tc1', function: { name: 'Bash', arguments: '{"a":1}' } }],
              },
              finish_reason: 'stop',
            },
          ],
        },
        '[DONE]',
      ]),
      signal: new AbortController().signal,
      onEvent,
      thinkingEnabled: true,
    })
    expect(sseParsed.assistantText).toBe('snap')
    expect(sseParsed.reasoningContent).toBe('rsnap')
    expect(sseParsed.toolCalls).toEqual([{ id: 'tc1', name: 'Bash', input: { a: 1 } }])

    const sseNoSnapshotAppend = await (client as any).parseOpenAiSSEStream({
      stream: createOpenAiSSEStream([
        {
          choices: [
            {
              delta: { content: 'same', reasoning_content: 'r' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              delta: {},
              message: { content: 'same', reasoning_content: 'r' },
              finish_reason: 'stop',
            },
          ],
        },
        '[DONE]',
      ]),
      signal: new AbortController().signal,
      onEvent,
      thinkingEnabled: true,
    })
    expect(sseNoSnapshotAppend.assistantText).toBe('same')
    expect(sseNoSnapshotAppend.reasoningContent).toBe('r')

    const sseNoPayloadObject = await (client as any).parseOpenAiSSEStream({
      stream: createOpenAiSSEStream(['1', { choices: {} }, { choices: [null, {}] }]),
      signal: new AbortController().signal,
      onEvent,
      thinkingEnabled: true,
    })
    expect(sseNoPayloadObject.stopReason).toBeNull()

    await expect(
      (client as any).parseOpenAiSSEStream({
        stream: createOpenAiSSEStream([{ error: { code: 1 } }]),
        signal: new AbortController().signal,
        onEvent,
        thinkingEnabled: true,
      }),
    ).rejects.toThrow('OpenAI stream error: [object Object]')

    await expect(
      (client as any).parseOpenAiSSEStream({
        stream: createOpenAiSSEStream([{ error: { message: 'bad-stream' } }]),
        signal: new AbortController().signal,
        onEvent,
        thinkingEnabled: true,
      }),
    ).rejects.toThrow('OpenAI stream error: bad-stream')

    const preAborted = new AbortController()
    preAborted.abort()
    await expect(
      (client as any).parseOpenAiSSEStream({
        stream: createOpenAiSSEStream([{ choices: [] }]),
        signal: preAborted.signal,
        onEvent,
        thinkingEnabled: true,
      }),
    ).rejects.toThrow('Stream aborted')

    const encoder = new TextEncoder()
    const trailingBufferParsed = await (client as any).parseOpenAiSSEStream({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"tail"},"finish_reason":"stop"}]}'))
          controller.close()
        },
      }),
      signal: new AbortController().signal,
      onEvent,
      thinkingEnabled: false,
    })
    expect(trailingBufferParsed.assistantText).toBe('tail')

    const trailingDoneParsed = await (client as any).parseOpenAiSSEStream({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]'))
          controller.close()
        },
      }),
      signal: new AbortController().signal,
      onEvent,
      thinkingEnabled: false,
    })
    expect(trailingDoneParsed.assistantText).toBe('')

    await expect((client as any).parseOpenAiUnknownText('not-json', new AbortController().signal, onEvent, true)).rejects.toThrow(
      'Unsupported OpenAI fallback response format',
    )

    const unknownJson = await (client as any).parseOpenAiUnknownText(
      '{"choices":[{"message":{"content":"x"},"finish_reason":"stop"}]}',
      new AbortController().signal,
      onEvent,
      false,
    )
    expect(unknownJson.assistantText).toBe('x')

    const unknownEmpty = await (client as any).parseOpenAiUnknownText('   ', new AbortController().signal, onEvent, false)
    expect(unknownEmpty.stopReason).toBeNull()

    const unknownSse = await (client as any).parseOpenAiUnknownText(
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      new AbortController().signal,
      onEvent,
      true,
    )
    expect(unknownSse.assistantText).toBe('hi')

    const abortA = new AbortController()
    const abortB = new AbortController()
    const combined = (client as any).combineSignals(abortA.signal, abortB.signal)
    expect(combined.aborted).toBe(false)
    abortB.abort()
    expect(combined.aborted).toBe(true)

    const preAborted2 = new AbortController()
    preAborted2.abort()
    expect((client as any).combineSignals(preAborted2.signal).aborted).toBe(true)
  })
})
