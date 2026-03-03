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
    userInputManager: {
      submitAnswers: vi.fn(() => true),
      reject: vi.fn(() => true),
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

  it('handles approval input requests via onInputRequest callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-1',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/a.txt' },
        effectiveDecision: 'prompt',
        suggestions: ['approval needed'],
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'approved' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const onInputRequest = vi.fn(async (request: any) => {
      if (request.subtype === 'approval_request') {
        return {
          decision: 'approve_remember' as const,
          scope: 'project' as const,
        }
      }
      return null
    })

    const messages = await collectMessages({
      prompt: 'write file',
      options: {
        interactive: true,
        onInputRequest,
      },
    })

    expect(
      messages.some((message) => message.type === 'input_request' && message.subtype === 'approval_request'),
    ).toBe(true)
    expect(onInputRequest).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-1', {
      decision: 'approve_remember',
      scope: 'project',
    })
  })

  it('handles ask_user_question input requests via onInputRequest callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-1',
        questions: [
          {
            question: 'Choose one',
            header: 'choice',
            fieldId: 'choice',
            options: [{ label: 'A', description: 'option A' }],
            multiSelect: false,
          },
        ],
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'answered' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const onInputRequest = vi.fn(async (request: any) => {
      if (request.subtype === 'ask_user_question') {
        return {
          answers: {
            choice: 'A',
          },
        }
      }
      return null
    })

    const messages = await collectMessages({
      prompt: 'ask user',
      options: {
        interactive: true,
        onInputRequest,
      },
    })

    expect(
      messages.some((message) => message.type === 'input_request' && message.subtype === 'ask_user_question'),
    ).toBe(true)
    expect(onInputRequest).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-question-1', {
      choice: 'A',
    })
  })

  it('falls back to deny approval when callback is not provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-2',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/b.txt' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'denied' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'write file without handler',
      options: {
        interactive: true,
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-2', {
      decision: 'deny',
    })
  })

  it('does not block shutdown when input callback never resolves', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-stuck',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/c.txt' },
        effectiveDecision: 'prompt',
      })

      await new Promise<void>((_resolve, reject) => {
        if (turnArgs.signal?.aborted) {
          reject(new Error('Request aborted'))
          return
        }
        turnArgs.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('Request aborted'))
          },
          { once: true },
        )
      })

      return [...turnArgs.history, turnArgs.user]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const onInputRequest = vi.fn(async () => {
      await new Promise<never>(() => {})
    })

    const consumeAndBreak = async () => {
      for await (const message of query({
        prompt: 'cancel while waiting',
        options: {
          interactive: true,
          onInputRequest,
        },
      })) {
        if (message.type === 'input_request') break
      }
    }

    await expect(
      Promise.race([
        consumeAndBreak(),
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('shutdown timeout')), 1000)
        }),
      ]),
    ).resolves.toBeUndefined()

    expect(onInputRequest).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
  })

  it('rejects approval input when callback response fails validation', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-invalid',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/d.txt' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'invalid approval callback',
      options: {
        interactive: true,
        onInputRequest: async () => ({ decision: 'not-a-valid-decision' as any }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-approval-invalid')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'Invalid approval input response',
    )
  })

  it('rejects ask_user_question input when callback response fails validation', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-invalid',
        questions: [
          {
            question: 'Pick one',
            header: 'choice',
            fieldId: 'choice',
            options: [{ label: 'A', description: 'option A' }],
            multiSelect: false,
          },
        ],
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'invalid question callback',
      options: {
        interactive: true,
        onInputRequest: async () => ({ answers: 'not-an-object' as any }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-question-invalid')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'Invalid ask_user_question input response',
    )
  })

  it('returns error result when query args are invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())
    const onMessage = vi.fn()

    const messages = await collectMessages({ prompt: 123 as any, options: { onMessage } } as any)

    expect(state.createRuntime).not.toHaveBeenCalled()
    expect(messages).toHaveLength(1)
    const result = messages[0]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Invalid query arguments or runtime event')
    }
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0]?.[0]?.type).toBe('result')
  })

  it('returns error result when stream event payload is invalid', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'usage',
        usage: { input_tokens: '1' },
      })
      return [...turnArgs.history, turnArgs.user]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({ prompt: 'invalid event payload' })
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Invalid query arguments or runtime event')
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
