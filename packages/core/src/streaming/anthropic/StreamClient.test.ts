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
    expect(init.headers['anthropic-beta']).toBe(
      'claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
  })

  it('normalizes cache_control placement to cc-style before request', async () => {
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

    const system = [
      { type: 'text', text: 'identity' },
      { type: 'text', text: 'instructions', cache_control: { type: 'ephemeral' as const } },
    ]

    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: '<system-reminder>injected</system-reminder>', cache_control: { type: 'ephemeral' as const } },
          { type: 'text', text: 'todo reminder', cache_control: { type: 'ephemeral' as const } },
          { type: 'text', text: 'run pwd' },
        ],
      },
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking', thinking: '...', signature: 'sig' },
          { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'pwd' }, cache_control: { type: 'ephemeral' as const } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: '/tmp', is_error: false },
        ],
      },
    ]

    await client.streamOnce({
      messages,
      system,
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)

    // system blocks are always cache breakpoints.
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.system[1].cache_control).toEqual({ type: 'ephemeral' })

    // only the newest two messages keep a trailing cache breakpoint.
    expect(body.messages[0].content[0].cache_control).toBeUndefined()
    expect(body.messages[0].content[1].cache_control).toBeUndefined()
    expect(body.messages[0].content[2].cache_control).toBeUndefined()
    expect(body.messages[1].content[0].cache_control).toBeUndefined()
    expect(body.messages[1].content[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' })

    // input objects are not mutated by request normalization.
    expect((messages[0] as any).content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect((messages[0] as any).content[2].cache_control).toBeUndefined()
    expect((system[0] as any).cache_control).toBeUndefined()
  })

  it('projects cache edit plans into Anthropic cache editing request blocks without mutating input messages', async () => {
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
      cacheEditingBetaHeader: 'cache-editing-test',
    })

    const messages = [
      {
        role: 'assistant' as const,
        meta: { timestamp: '2026-05-21T01:00:00.000Z' },
        content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } }],
      },
      {
        role: 'user' as const,
        meta: { timestamp: '2026-05-21T01:00:01.000Z' },
        content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'old result' }],
      },
      {
        role: 'user' as const,
        meta: { timestamp: '2026-05-21T01:00:02.000Z' },
        content: [{ type: 'text', text: 'next question', cache_control: { type: 'ephemeral' as const } }],
      },
    ]

    await client.streamOnce({
      messages,
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      cacheEditPlan: {
        provider: 'anthropic',
        deletes: [
          {
            type: 'delete',
            cacheReference: 'read-1',
            toolUseId: 'read-1',
            toolName: 'Read',
            messageIndex: 1,
            blockIndex: 0,
          },
        ],
      },
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(init.headers['anthropic-beta']).toContain('cache-editing-test')
    expect(JSON.stringify(body.messages)).not.toContain('"meta"')
    expect(body.messages[1].content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'read-1',
      cache_reference: 'read-1',
    })
    expect(body.messages[2].content).toEqual([
      {
        type: 'cache_edits',
        edits: [{ type: 'delete', cache_reference: 'read-1' }],
      },
      {
        type: 'text',
        text: 'next question',
        cache_control: { type: 'ephemeral' },
      },
    ])
    expect((messages[1] as any).content[0].cache_reference).toBeUndefined()
    expect((messages[2] as any).content).toHaveLength(1)
    expect((messages[0] as any).meta).toEqual({ timestamp: '2026-05-21T01:00:00.000Z' })
  })

  it('projects cache edits by tool_use_id after request normalization changes message positions', async () => {
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
      cacheEditingBetaHeader: 'cache-editing-test',
    })

    await client.streamOnce({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'pwd' } },
            { type: 'tool_use', id: 'call_2', name: 'Read', input: { file_path: '/tmp/a' } },
          ],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '/repo' }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'file content' }] },
        { role: 'user', content: [{ type: 'text', text: 'next', cache_control: { type: 'ephemeral' as const } }] },
      ] as any,
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      cacheEditPlan: {
        provider: 'anthropic',
        deletes: [
          {
            type: 'delete',
            cacheReference: 'call_2',
            toolUseId: 'call_2',
            toolName: 'Read',
            // These positions describe the pre-normalized history; the client
            // must still find the stable tool_result after normalization merges
            // split tool_result messages.
            messageIndex: 2,
            blockIndex: 0,
          },
        ],
      },
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)
    const toolResults = body.messages.flatMap((message: any) =>
      Array.isArray(message.content) ? message.content.filter((block: any) => block?.type === 'tool_result') : [],
    )
    expect(toolResults.find((block: any) => block.tool_use_id === 'call_2')).toMatchObject({
      cache_reference: 'call_2',
    })
    expect(JSON.stringify(body.messages)).toContain('"cache_edits"')
    expect(JSON.stringify(body.messages)).toContain('"cache_reference":"call_2"')
  })

  it('strips cache editing blocks when retrying without beta headers', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'unknown beta',
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
      cacheEditingBetaHeader: 'cache-editing-test',
    })

    await client.streamOnce({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'old result' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'next' }] },
      ] as any,
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      cacheEditPlan: {
        provider: 'anthropic',
        deletes: [
          {
            type: 'delete',
            cacheReference: 'read-1',
            toolUseId: 'read-1',
            toolName: 'Read',
            messageIndex: 1,
            blockIndex: 0,
          },
        ],
        fallbackMessages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } }],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-1',
                content: '[Older tool result cleared by microcompact: Read /repo/a.ts (~10 chars)]',
              },
            ],
          },
        ],
      },
    })

    const [, retryInit] = (globalThis.fetch as any).mock.calls[1]
    const retryBody = JSON.parse(retryInit.body)
    expect(retryInit.headers['anthropic-beta']).toBeUndefined()
    expect(JSON.stringify(retryBody.messages)).not.toContain('cache_edits')
    expect(JSON.stringify(retryBody.messages)).not.toContain('cache_reference')
    expect(retryBody.messages[1].content[0].content).toBe(
      '[Older tool result cleared by microcompact: Read /repo/a.ts (~10 chars)]',
    )
    expect(retryBody.messages[2].content[0]).toMatchObject({ type: 'text', text: 'next' })
  })

  it('groups split historical tool_result messages immediately after multi-tool assistant turns', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'text', text: 'done' }],
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
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'run both' }] },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'pwd' } },
            { type: 'tool_use', id: 'call_2', name: 'Read', input: { file_path: '/tmp/a' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: '/repo' },
            { type: 'text', text: 'post-tool context 1' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_2', content: 'file' },
            { type: 'text', text: 'post-tool context 2' },
          ],
        },
      ],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    const body = JSON.parse(init.body)

    expect(body.messages).toHaveLength(3)
    expect(body.messages[2].role).toBe('user')
    expect(body.messages[2].content.map((block: any) => block.type)).toEqual([
      'tool_result',
      'tool_result',
      'text',
      'text',
    ])
    expect(body.messages[2].content[0].tool_use_id).toBe('call_1')
    expect(body.messages[2].content[1].tool_use_id).toBe('call_2')
    expect(body.messages[2].content[2].text).toBe('post-tool context 1')
    expect(body.messages[2].content[3].text).toBe('post-tool context 2')
  })

  it('normalizes empty baseUrl and falls back model from client config when args model is blank', async () => {
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
      baseUrl: '',
      model: 'm-from-config',
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      model: '   ',
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe('/messages')
    expect(JSON.parse(init.body).model).toBe('m-from-config')
  })

  it('uses arch fallback and non-darwin os header values', async () => {
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'arch', { value: '', configurable: true })
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      const { AnthropicStreamClient } = await import('./StreamClient')

      ;(globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        body: {} as any,
      })

      parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
        callbacks.onMessageComplete()
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
      })

      await client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      })

      const [, init] = (globalThis.fetch as any).mock.calls[0]
      expect(init.headers['x-stainless-arch']).toBe('arm64')
      expect(init.headers['x-stainless-os']).toBe('linux')
    } finally {
      if (originalArch) Object.defineProperty(process, 'arch', originalArch)
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('uses empty-string model when neither args nor client model is set', async () => {
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
      model: '',
    })

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(JSON.parse(init.body).model).toBe('')
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

  it('omits thinking but keeps base beta headers when thinkingEnabled is false', async () => {
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
    expect(init.headers['anthropic-beta']).toBe(
      'claude-code-20250219,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
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
    expect(firstInit.headers['anthropic-beta']).toBe(
      'claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )

    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    const secondBody = JSON.parse(secondInit.body)
    expect(secondBody.thinking).toBeUndefined()
    expect(secondInit.headers['anthropic-beta']).toBe(
      'claude-code-20250219,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
  })

  it('retries once without beta headers when provider rejects anthropic-beta', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unsupported header anthropic-beta',
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
      thinkingEnabled: false,
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect((globalThis.fetch as any).mock.calls).toHaveLength(2)
    const [, firstInit] = (globalThis.fetch as any).mock.calls[0]
    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    expect(firstInit.headers['anthropic-beta']).toBe(
      'claude-code-20250219,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
    expect(secondInit.headers['anthropic-beta']).toBeUndefined()
  })

  it('keeps thinking payload when retrying without beta headers', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unsupported header anthropic-beta',
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
    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    const firstBody = JSON.parse(firstInit.body)
    const secondBody = JSON.parse(secondInit.body)
    expect(firstBody.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(secondBody.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(secondInit.headers['anthropic-beta']).toBeUndefined()
  })

  it('retries without thinking after no-beta retry is still rejected for thinking fields', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unsupported header anthropic-beta',
        body: null,
      })
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

    expect((globalThis.fetch as any).mock.calls).toHaveLength(3)

    const [, firstInit] = (globalThis.fetch as any).mock.calls[0]
    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    const [, thirdInit] = (globalThis.fetch as any).mock.calls[2]

    const firstBody = JSON.parse(firstInit.body)
    const secondBody = JSON.parse(secondInit.body)
    const thirdBody = JSON.parse(thirdInit.body)

    expect(firstInit.headers['anthropic-beta']).toBe(
      'claude-code-20250219,adaptive-thinking-2026-01-28,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
    expect(secondInit.headers['anthropic-beta']).toBeUndefined()
    expect(thirdInit.headers['anthropic-beta']).toBeUndefined()

    expect(firstBody.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(secondBody.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(thirdBody.thinking).toBeUndefined()
  })

  it('throws retry HTTP error when fallback request also fails', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unknown field: thinking',
        body: null,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'retry-failed',
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
    ).rejects.toThrow('HTTP 500: retry-failed')
  })

  it('does not retry when non-4xx error text is empty/falsy', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => undefined,
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
    ).rejects.toThrow('HTTP 500: undefined')

    expect((globalThis.fetch as any).mock.calls).toHaveLength(1)
  })

  it('retries without beta headers on generic 400 even when body is empty', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '',
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
      thinkingEnabled: false,
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect((globalThis.fetch as any).mock.calls).toHaveLength(2)
    const [, firstInit] = (globalThis.fetch as any).mock.calls[0]
    const [, secondInit] = (globalThis.fetch as any).mock.calls[1]
    expect(firstInit.headers['anthropic-beta']).toBe(
      'claude-code-20250219,prompt-caching-scope-2026-01-05,effort-2025-11-24',
    )
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

  it('formats non-Error tool execution failures', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash', input: {} })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
        stopReason: 'tool_use',
        usage: undefined,
      }
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
      onEvent: () => {},
      executeTool: async () => {
        throw 'boom-string'
      },
    })

    expect(out.toolResults).toEqual([
      {
        tool_use_id: 't1',
        content: 'Error: boom-string',
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

  it('skips tool execution when already aborted before tool_use_complete', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onToolUseStart('t1', 'Bash')
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash' })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash' }],
        stopReason: 'tool_use',
        usage: undefined,
      }
    })

    const controller = new AbortController()
    controller.abort()
    const executeTool = vi.fn(async () => ({ tool_use_id: 't1', content: 'ok' }))
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
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      executeTool,
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'tool_input')).toBe(false)
    expect(out.toolResults).toEqual([
      {
        tool_use_id: 't1',
        content: expect.stringContaining('missing tool_result'),
        is_error: true,
      },
    ])
  })

  it('passes empty object when tool_use input is missing', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      await callbacks.onToolUseComplete(0, { id: 't1', name: 'Bash' })
      return {
        contentBlocks: [{ type: 'tool_use', id: 't1', name: 'Bash' }],
        stopReason: 'tool_use',
        usage: undefined,
      }
    })

    const executeTool = vi.fn(async (call: any) => ({ tool_use_id: call.id, content: 'ok' }))
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
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledWith({ id: 't1', name: 'Bash', input: {} })
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

  it('maps tool_use defaults and thinking signature blocks', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [
          { type: 'tool_use' },
          { type: 'thinking', thinking: 'deep', signature: 'sig-1' },
        ],
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

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(out.assistantBlocks).toEqual([
      { type: 'tool_use', id: '', name: '', input: {} },
      { type: 'thinking', thinking: 'deep', signature: 'sig-1' },
    ])
  })

  it('maps empty text/thinking values to empty strings', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [
          { type: 'text' },
          { type: 'thinking', signature: 'sig-2' },
        ],
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

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(out.assistantBlocks).toEqual([
      { type: 'text', text: '' },
      { type: 'thinking', thinking: '', signature: 'sig-2' },
    ])
  })

  it('maps thinking blocks without signature and empty text', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async () => {
      return {
        contentBlocks: [{ type: 'thinking' }],
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

    const out = await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(out.assistantBlocks).toEqual([{ type: 'thinking', thinking: '' }])
  })

  it('emits thinking_stop and parser error events', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      body: {} as any,
    })

    parseAnthropicSSEStreamMock.mockImplementationOnce(async (_body: any, callbacks: any) => {
      callbacks.onThinkingStop()
      callbacks.onError('parser-failed')
      return {
        contentBlocks: [{ type: 'text', text: 'ok' }],
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

    await client.streamOnce({
      messages: [],
      system: [],
      tools: [],
      onEvent: (e) => events.push(e),
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    expect(events.some((e) => e.type === 'thinking_stop')).toBe(true)
    expect(events.some((e) => e.type === 'error' && e.error === 'parser-failed')).toBe(true)
  })

  it('combines with an already aborted external signal', async () => {
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

    const controller = new AbortController()
    controller.abort()

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
      signal: controller.signal,
      onEvent: () => {},
      executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
    })

    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(init.signal.aborted).toBe(true)
  })

  it('aborts request when timeout elapses', async () => {
    const { AnthropicStreamClient } = await import('./StreamClient')

    ;(globalThis.fetch as any).mockImplementationOnce(async (_url: string, init: any) => {
      return await new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted-by-timeout')),
          { once: true },
        )
      })
    })

    const client = new AnthropicStreamClient({
      apiKey: 'k',
      baseUrl: 'http://example',
      model: 'm',
      timeoutMs: 10,
    })

    await expect(
      client.streamOnce({
        messages: [],
        system: [],
        tools: [],
        onEvent: () => {},
        executeTool: async () => ({ tool_use_id: 'x', content: 'ok' } as ToolResult),
      }),
    ).rejects.toThrow('aborted-by-timeout')
  })
})
