import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { query } from './query.js'
import type { QueryArgs, QueryMessage } from './types.js'

const { state } = vi.hoisted(() => ({
  state: {
    createRuntime: vi.fn(),
  },
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime: (args: unknown) => state.createRuntime(args),
}))

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object' },
  }
}

function createRuntimeFixture(args?: {
  tools?: ToolDefinition[]
  streamOnce?: (streamArgs: any) => Promise<any>
  runTurn?: (turnArgs: any) => Promise<PromptMessage[]>
}) {
  const tools = args?.tools ?? [createTool('Read'), createTool('Write'), createTool('AskUserQuestion')]
  const streamOnce =
    args?.streamOnce ??
    (async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'assistant_delta', text: 'hello from model' })
      onEvent({ type: 'usage', usage: { input_tokens: 2, output_tokens: 3 }, model: 'claude-test' })
      return {
        assistantBlocks: [{ type: 'text', text: 'hello from model' }],
        stopReason: 'end_turn',
        toolResults: [],
        usage: { input_tokens: 2, output_tokens: 3 },
      }
    })

  const runtime: any = {
    cfg: {
      llm: { model: 'claude-default', thinkingMode: true },
      ui: { promptProfile: 'full' },
    },
    allowedSubagents: [],
    tools,
    client: {
      streamOnce: vi.fn(streamOnce),
    },
    engine: {
      runTurn: vi.fn(),
    },
  }

  runtime.engine.runTurn =
    args?.runTurn ??
    vi.fn(async (turnArgs: any) => {
      const out = await runtime.client.streamOnce({
        messages: [...turnArgs.history, turnArgs.user],
        system: turnArgs.system,
        tools: turnArgs.tools,
        onEvent: turnArgs.onEvent,
        executeTool: async () => ({ tool_use_id: 'noop', content: '', is_error: false }),
        signal: turnArgs.signal,
        model: turnArgs.model,
        thinkingEnabled: turnArgs.thinkingEnabled,
      })
      turnArgs.onEvent({ type: 'complete' })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: out.assistantBlocks }]
    })

  return runtime
}

async function collectMessages(args: QueryArgs): Promise<QueryMessage[]> {
  const messages: QueryMessage[] = []
  for await (const message of query(args)) {
    messages.push(message)
  }
  return messages
}

describe('sdk query()', () => {
  beforeEach(() => {
    state.createRuntime.mockReset()
  })

  it('emits init, stream events, assistant, and success result with aggregated usage', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const callbackMessages: QueryMessage[] = []
    const messages = await collectMessages({
      prompt: 'hello',
      options: {
        includePartialMessages: true,
        onMessage: (message) => {
          callbackMessages.push(message)
        },
      },
    })

    expect(messages.map((message) => message.type)).toEqual([
      'system',
      'stream_event',
      'stream_event',
      'stream_event',
      'assistant',
      'result',
    ])
    expect(callbackMessages).toHaveLength(messages.length)

    const assistant = messages.find((message) => message.type === 'assistant')
    expect(assistant?.type).toBe('assistant')
    if (assistant?.type === 'assistant') {
      expect(assistant.text).toBe('hello from model')
      expect(assistant.usage).toEqual({ input_tokens: 2, output_tokens: 3 })
      expect(assistant.model).toBe('claude-test')
    }

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.stop_reason).toBe('end_turn')
      expect(result.result).toBe('hello from model')
      expect(result.usage).toEqual({ input_tokens: 2, output_tokens: 3 })
      expect(result.model).toBe('claude-test')
    }
  })

  it('applies allowed/disallowed tools and passes execution policy options', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.tools.map((tool: ToolDefinition) => tool.name)).toEqual(['Read'])
      expect(turnArgs.exec?.allowTools).toEqual(['Read'])
      expect(new Set(turnArgs.exec?.denyTools)).toEqual(new Set(['Write', 'AskUserQuestion']))
      expect(turnArgs.exec?.interactive).toBe(false)
      expect(turnArgs.exec?.replMode).toBe('plan')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({
      runTurn,
      tools: [createTool('Read'), createTool('Write'), createTool('AskUserQuestion')],
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'do work',
      options: {
        allowedTools: ['Read'],
        disallowedTools: ['Write'],
        replMode: 'plan',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.result).toBe('ok')
    }
  })

  it('supports overriding and appending system prompt blocks', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const systemTextBlocks = turnArgs.system
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => String(block.text))

      expect(systemTextBlocks).toEqual(['base prompt', 'appended prompt'])
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'check prompt',
      options: {
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'appended prompt',
      },
    })

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.result).toBe('done')
    }
  })

  it('returns an error result message when execution fails', async () => {
    const runtime = createRuntimeFixture({
      runTurn: async () => {
        throw new Error('boom')
      },
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({ prompt: 'will fail' })

    expect(messages.some((message) => message.type === 'assistant')).toBe(false)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('boom')
      expect(result.result).toBe('')
    }
  })
})

