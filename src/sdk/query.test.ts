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

  it('maps permissionMode to execution replMode', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.exec?.replMode).toBe('normal')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'use default permission mode',
      options: {
        permissionMode: 'default',
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

  it('returns error when replMode and permissionMode conflict', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'conflicting modes',
      options: {
        replMode: 'plan',
        permissionMode: 'default',
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('conflicts with options.permissionMode')
    }
  })

  it('accepts abortController and forwards its signal to runTurn', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.signal).toBeDefined()
      expect(turnArgs.signal.aborted).toBe(true)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const abortController = new AbortController()
    abortController.abort()

    const messages = await collectMessages({
      prompt: 'aborted before run',
      options: {
        abortController,
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

  it('combines signal and abortController so either one can cancel the turn', async () => {
    const signalController = new AbortController()
    const abortController = new AbortController()
    const runTurn = vi.fn(async (turnArgs: any) => {
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

    const abortTimer = setTimeout(() => {
      abortController.abort()
    }, 10)
    const messages = await collectMessages({
      prompt: 'cancel via abortController',
      options: {
        signal: signalController.signal,
        abortController,
      },
    })
    clearTimeout(abortTimer)

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Request aborted')
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

  it('returns structured_output when outputFormat schema validation succeeds', async () => {
    const schema = {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        founded_year: { type: 'number' },
      },
      required: ['company_name'],
      additionalProperties: false,
    }

    const runtime = createRuntimeFixture({
      streamOnce: async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: 'assistant_delta', text: '{"company_name":"Anthropic","founded_year":2021}' })
        onEvent({ type: 'usage', usage: { input_tokens: 3, output_tokens: 4 }, model: 'claude-test' })
        return {
          assistantBlocks: [{ type: 'text', text: '{"company_name":"Anthropic","founded_year":2021}' }],
          stopReason: 'end_turn',
          toolResults: [],
          usage: { input_tokens: 3, output_tokens: 4 },
        }
      },
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'summarize',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema,
        },
      },
    })

    const toolsPassed = runtime.engine.runTurn.mock.calls[0]?.[0]?.tools as ToolDefinition[]
    const structuredTool = toolsPassed.find((tool) => tool.name === 'StructuredOutput')
    expect(structuredTool).toBeTruthy()
    expect(structuredTool?.input_schema).toEqual(schema)

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({
        company_name: 'Anthropic',
        founded_year: 2021,
      })
      expect(result.error).toBeUndefined()
    }
  })

  it('generates StructuredOutput input_schema from each outputFormat schema dynamically', async () => {
    const observedStructuredSchemas: unknown[] = []
    const runTurn = vi.fn(async (turnArgs: any) => {
      const structuredTool = (turnArgs.tools as ToolDefinition[]).find(
        (tool) => tool.name === 'StructuredOutput',
      )
      observedStructuredSchemas.push(structuredTool?.input_schema)

      return [
        ...turnArgs.history,
        turnArgs.user,
        { role: 'assistant', content: [{ type: 'text', text: '{"company_name":"Anthropic"}' }] },
      ]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const firstSchema = {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
      },
      required: ['company_name'],
    }

    const secondSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        company_name: { type: 'string' },
      },
      required: ['company_name'],
      additionalProperties: false,
    }

    await collectMessages({
      prompt: 'first schema run',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: firstSchema,
        },
      },
    })

    await collectMessages({
      prompt: 'second schema run',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: secondSchema,
        },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(observedStructuredSchemas).toEqual([firstSchema, secondSchema])
  })

  it('extracts structured_output from StructuredOutput tool_use input', async () => {
    const runtime = createRuntimeFixture({
      streamOnce: async () => {
        return {
          assistantBlocks: [
            {
              type: 'tool_use',
              id: 'structured-tool-1',
              name: 'StructuredOutput',
              input: { company_name: 'Anthropic' },
            },
          ],
          stopReason: 'tool_use',
          toolResults: [],
          usage: { input_tokens: 2, output_tokens: 1 },
        }
      },
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'structured tool output',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
            additionalProperties: false,
          },
        },
      },
    })

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({ company_name: 'Anthropic' })
    }
  })

  it('auto-allows StructuredOutput when outputFormat is enabled', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(new Set(turnArgs.exec?.allowTools ?? [])).toEqual(new Set(['Read', 'StructuredOutput']))
      expect((turnArgs.tools as ToolDefinition[]).some((tool) => tool.name === 'StructuredOutput')).toBe(true)
      return [
        ...turnArgs.history,
        turnArgs.user,
        { role: 'assistant', content: [{ type: 'text', text: '{"company_name":"Anthropic"}' }] },
      ]
    })
    const runtime = createRuntimeFixture({
      runTurn,
      tools: [createTool('Read'), createTool('Write')],
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'structured with restricted allow-list',
      options: {
        allowedTools: ['Read'],
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
          },
        },
      },
    })

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({ company_name: 'Anthropic' })
    }
  })

  it('intercepts StructuredOutput tool execution without requiring runtime tool handler', async () => {
    let executeToolResult: unknown = null
    const streamOnce = vi.fn(async (streamArgs: any) => {
      executeToolResult = await streamArgs.executeTool({
        id: 'tool-structured',
        name: 'StructuredOutput',
        input: { company_name: 'Anthropic' },
      })
      streamArgs.onEvent?.({ type: 'assistant_delta', text: '{"company_name":"Anthropic"}' })
      return {
        assistantBlocks: [{ type: 'text', text: '{"company_name":"Anthropic"}' }],
        stopReason: 'end_turn',
        toolResults: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })

    const runTurn = vi.fn(async (turnArgs: any) => {
      const out = await runtime.client.streamOnce({
        messages: [...turnArgs.history, turnArgs.user],
        system: turnArgs.system,
        tools: turnArgs.tools,
        onEvent: turnArgs.onEvent,
        executeTool: async (call: any) => ({
          tool_use_id: String(call?.id ?? ''),
          content: `Error: Tool not implemented: ${String(call?.name ?? '')}`,
          is_error: true,
        }),
        signal: turnArgs.signal,
        model: turnArgs.model,
        thinkingEnabled: turnArgs.thinkingEnabled,
      })
      turnArgs.onEvent({ type: 'complete' })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: out.assistantBlocks }]
    })

    const runtime = createRuntimeFixture({
      streamOnce,
      runTurn,
      tools: [createTool('Read')],
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'structured tool interception',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
          },
        },
      },
    })

    expect(executeToolResult).toEqual({
      tool_use_id: 'tool-structured',
      content: 'Structured output accepted.',
      is_error: false,
    })
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({ company_name: 'Anthropic' })
    }
  })

  it('does not reuse stale StructuredOutput tool_use input from prior history turns', async () => {
    const runtime = createRuntimeFixture({
      streamOnce: async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: 'assistant_delta', text: '{"company_name":"FreshCo"}' })
        return {
          assistantBlocks: [{ type: 'text', text: '{"company_name":"FreshCo"}' }],
          stopReason: 'end_turn',
          toolResults: [],
          usage: { input_tokens: 2, output_tokens: 2 },
        }
      },
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'current turn output',
      history: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'structured-tool-old',
              name: 'StructuredOutput',
              input: { company_name: 'OldCo' },
            },
          ],
        },
      ],
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
            additionalProperties: false,
          },
        },
      },
    })

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({ company_name: 'FreshCo' })
      expect(result.structured_output).not.toEqual({ company_name: 'OldCo' })
    }
  })

  it('retries structured output generation when first response fails validation', async () => {
    const streamOnce = vi
      .fn()
      .mockImplementationOnce(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: 'assistant_delta', text: 'not-json' })
        return {
          assistantBlocks: [{ type: 'text', text: 'not-json' }],
          stopReason: 'end_turn',
          toolResults: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      })
      .mockImplementationOnce(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: 'assistant_delta', text: '{"company_name":"Anthropic"}' })
        return {
          assistantBlocks: [{ type: 'text', text: '{"company_name":"Anthropic"}' }],
          stopReason: 'end_turn',
          toolResults: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      })

    const runtime = createRuntimeFixture({ streamOnce })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'give structured output',
      options: {
        outputFormat: {
          type: 'json_schema',
          maxRetries: 1,
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
            additionalProperties: false,
          },
        },
      },
    })

    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(2)
    const secondUserText = runtime.engine.runTurn.mock.calls[1]?.[0]?.user?.content?.[0]?.text
    expect(String(secondUserText)).toContain('Validation error')

    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.structured_output).toEqual({ company_name: 'Anthropic' })
    }
  })

  it('returns structured output retry error when schema cannot be satisfied', async () => {
    const streamOnce = vi.fn(async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      onEvent({ type: 'assistant_delta', text: '{"company_name":123}' })
      return {
        assistantBlocks: [{ type: 'text', text: '{"company_name":123}' }],
        stopReason: 'end_turn',
        toolResults: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }
    })
    const runtime = createRuntimeFixture({ streamOnce })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'give structured output',
      options: {
        outputFormat: {
          type: 'json_schema',
          maxRetries: 1,
          schema: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
            },
            required: ['company_name'],
            additionalProperties: false,
          },
        },
      },
    })

    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(2)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_max_structured_output_retries')
      expect(result.structured_output).toBeUndefined()
      expect(result.error).toContain('Structured output failed schema validation')
    }
  })

  it('retries when string constraints (minLength) are violated', async () => {
    const runtime = createRuntimeFixture({
      streamOnce: async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: 'assistant_delta', text: '{"company_name":"a"}' })
        return {
          assistantBlocks: [{ type: 'text', text: '{"company_name":"a"}' }],
          stopReason: 'end_turn',
          toolResults: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      },
    })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'give constrained structured output',
      options: {
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              company_name: {
                type: 'string',
                minLength: 3,
              },
            },
            required: ['company_name'],
            additionalProperties: false,
          },
        },
      },
    })

    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_max_structured_output_retries')
      expect(String(result.error)).toContain('length >=')
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

  it('returns error result when abortController option is invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    const messages = await collectMessages({
      prompt: 'invalid abortController',
      options: {
        abortController: {} as any,
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('abortController')
    }
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
