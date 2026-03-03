import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { query } from './query.js'
import type { QueryArgs, QueryMessage, QueryOptions, SDKUserMessage } from './types.js'

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
  return collectFromIterator(query(args))
}

async function collectFromIterator(iterator: AsyncGenerator<QueryMessage, void, unknown>): Promise<QueryMessage[]> {
  const messages: QueryMessage[] = []
  for await (const message of iterator) {
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

  it('supports async iterable prompt input and folds prior streamed messages into history', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(1)
      expect(turnArgs.history[0]?.role).toBe('user')
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('first from stream')
      expect(turnArgs.user?.content?.[0]?.text).toBe('second from stream')

      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    async function* promptStream(): AsyncGenerator<SDKUserMessage, void, unknown> {
      yield { role: 'user', content: [{ type: 'text', text: 'first from stream' }] }
      yield { role: 'user', content: [{ type: 'text', text: 'second from stream' }] }
    }

    const messages = await collectMessages({
      prompt: promptStream(),
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.result).toBe('ok')
    }
  })

  it('returns error when async iterable prompt stream is empty', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    async function* emptyPromptStream() {}

    const messages = await collectMessages({
      prompt: emptyPromptStream(),
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Async prompt stream must yield at least one user message')
    }
  })

  it('aborts while draining async iterable prompt streams', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())
    const abortController = new AbortController()

    async function* blockedPromptStream(): AsyncGenerator<SDKUserMessage, void, unknown> {
      await new Promise<never>(() => {})
      yield { role: 'user', content: [{ type: 'text', text: 'never' }] }
    }

    const messagesPromise = collectMessages({
      prompt: blockedPromptStream(),
      options: {
        abortController,
      },
    })

    const abortTimer = setTimeout(() => {
      abortController.abort()
    }, 10)

    const messages = await Promise.race([
      messagesPromise,
      new Promise<QueryMessage[]>((_resolve, reject) => {
        setTimeout(() => reject(new Error('async prompt abort timeout')), 1000)
      }),
    ])

    clearTimeout(abortTimer)
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Request aborted')
    }
  })

  it('returns error when async iterable prompt yields invalid message shape', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    async function* invalidPromptStream() {
      yield { role: 'assistant', content: [{ type: 'text', text: 'invalid role' }] } as any
    }

    const messages = await collectMessages({
      prompt: invalidPromptStream(),
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('role')
    }
  })

  it('closes async iterable prompt iterator when validation fails mid-stream', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())
    let didReturn = false

    const promptStream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            if (emitted) return { value: undefined, done: true }
            emitted = true
            return {
              value: { role: 'assistant', content: [{ type: 'text', text: 'invalid role' }] },
              done: false,
            }
          },
          return: async () => {
            didReturn = true
            return { value: undefined, done: true }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream as AsyncIterable<SDKUserMessage>,
    })

    expect(didReturn).toBe(true)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('role')
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

  it.each(['dontAsk', 'bypassPermissions'] as const)(
    'returns explicit unsupported error for permissionMode=%s',
    async (permissionMode) => {
      const runTurn = vi.fn(async (turnArgs: any) => {
        return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
      })
      const runtime = createRuntimeFixture({ runTurn })
      state.createRuntime.mockResolvedValue(runtime)

      const messages = await collectMessages({
        prompt: 'unsupported permission mode',
        options: {
          permissionMode,
        },
      })

      expect(runTurn).not.toHaveBeenCalled()
      const result = messages[messages.length - 1]
      expect(result?.type).toBe('result')
      if (result?.type === 'result') {
        expect(result.subtype).toBe('error_during_execution')
        expect(result.error).toContain('is not supported in Formax SDK yet')
      }
    },
  )

  it('fails fast on unsupported permissionMode before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        permissionMode: 'dontAsk',
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('exposes interrupt() and aborts an in-flight query', async () => {
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

    const queryIterator = query({
      prompt: 'interrupt me',
    })
    expect(typeof queryIterator.interrupt).toBe('function')

    const messagesPromise = (async () => {
      const out: QueryMessage[] = []
      for await (const message of queryIterator) {
        out.push(message)
      }
      return out
    })()

    const interruptTimer = setTimeout(() => {
      void queryIterator.interrupt()
    }, 10)

    const messages = await Promise.race([
      messagesPromise,
      new Promise<QueryMessage[]>((_resolve, reject) => {
        setTimeout(() => reject(new Error('interrupt timeout')), 1000)
      }),
    ])
    clearTimeout(interruptTimer)

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Request aborted')
    }
  })

  it('exposes close() and aborts an in-flight query', async () => {
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

    const queryIterator = query({
      prompt: 'close me',
    })
    expect(typeof queryIterator.close).toBe('function')

    const messagesPromise = (async () => {
      const out: QueryMessage[] = []
      for await (const message of queryIterator) {
        out.push(message)
      }
      return out
    })()

    const closeTimer = setTimeout(() => {
      queryIterator.close()
    }, 10)

    const messages = await Promise.race([
      messagesPromise,
      new Promise<QueryMessage[]>((_resolve, reject) => {
        setTimeout(() => reject(new Error('close timeout')), 1000)
      }),
    ])
    clearTimeout(closeTimer)

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('Request aborted')
    }
  })

  it('supports setModel() before iteration starts', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.model).toBe('claude-override')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'set model before start',
    })
    await queryIterator.setModel('claude-override')

    const messages = await collectFromIterator(queryIterator)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('supports setPermissionMode() before iteration starts', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.exec?.replMode).toBe('plan')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'set permission mode before start',
    })
    await queryIterator.setPermissionMode('plan')

    const messages = await collectFromIterator(queryIterator)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('validates setPermissionMode() input before iteration starts', async () => {
    const queryIterator = query({
      prompt: 'invalid permission mode',
    })

    await expect(queryIterator.setPermissionMode('invalid-mode' as any)).rejects.toThrow(
      'query.setPermissionMode expects one of',
    )
  })

  it('supports setMaxThinkingTokens() before iteration starts', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    runtime.cfg.llm.thinkingMode = true
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'set max thinking tokens before start',
    })
    await queryIterator.setMaxThinkingTokens(0)

    const messages = await collectFromIterator(queryIterator)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('validates setMaxThinkingTokens() input before iteration starts', async () => {
    const queryIterator = query({
      prompt: 'invalid max thinking tokens',
    })

    await expect(queryIterator.setMaxThinkingTokens(-1)).rejects.toThrow(
      'query.setMaxThinkingTokens expects a non-negative integer or null',
    )
  })

  it('rejects control mutations after iteration has started', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'start then mutate',
    })

    const firstMessage = await queryIterator.next()
    expect(firstMessage.done).toBe(false)

    await expect(queryIterator.setModel('late-model')).rejects.toThrow(
      'query.setModel is only supported before query iteration starts',
    )
    await expect(queryIterator.setPermissionMode('plan')).rejects.toThrow(
      'query.setPermissionMode is only supported before query iteration starts',
    )
    await expect(queryIterator.setMaxThinkingTokens(10)).rejects.toThrow(
      'query.setMaxThinkingTokens is only supported before query iteration starts',
    )

    for await (const _message of queryIterator) {
      // Drain remaining messages to allow clean shutdown.
    }
  })

  it('supports initializationResult() with init snapshot', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'init snapshot',
    })
    const initPromise = queryIterator.initializationResult()
    const messages = await collectFromIterator(queryIterator)
    const init = await initPromise

    expect(init.type).toBe('system')
    expect(init.subtype).toBe('init')
    expect(typeof init.session_id).toBe('string')
    expect(init.cwd.length).toBeGreaterThan(0)
    expect(init.tools.length).toBeGreaterThan(0)

    const first = messages[0]
    expect(first?.type).toBe('system')
    if (first?.type === 'system') {
      expect(first.session_id).toBe(init.session_id)
      expect(first.model).toBe(init.model)
      expect(first.cwd).toBe(init.cwd)
    }
  })

  it('rejects initializationResult() when query fails before init', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'invalid init request',
      options: {
        maxTurns: 0 as any,
      },
    })
    const initPromise = queryIterator.initializationResult()
    const messages = await collectFromIterator(queryIterator)

    await expect(initPromise).rejects.toThrow('Invalid query arguments or runtime event')
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
    }
  })

  it('rejects initializationResult() when query is closed before iteration starts', async () => {
    const queryIterator = query({
      prompt: 'close before start',
    })

    const initPromise = queryIterator.initializationResult()
    queryIterator.close()

    await expect(initPromise).rejects.toThrow('query.close was called before query iteration started')
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('maps thinking enabled config to execution thinkingEnabled', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(true)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'thinking enabled',
      options: {
        thinking: { type: 'enabled' },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('maps thinking disabled config to execution thinkingEnabled false', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'thinking disabled',
      options: {
        thinking: { type: 'disabled' },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps runtime default when thinking config is adaptive', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    runtime.cfg.llm.thinkingMode = false
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'thinking adaptive',
      options: {
        thinking: { type: 'adaptive' },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('lets thinking=adaptive take precedence over maxThinkingTokens', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(true)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    runtime.cfg.llm.thinkingMode = true
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'adaptive takes precedence',
      options: {
        thinking: { type: 'adaptive' },
        maxThinkingTokens: 0,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('returns error when thinking and thinkingEnabled conflict', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'thinking conflict',
      options: {
        thinking: { type: 'enabled' },
        thinkingEnabled: false,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.thinkingEnabled')
    }
  })

  it('maps maxThinkingTokens to execution thinkingEnabled=true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(true)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'max thinking tokens',
      options: {
        maxThinkingTokens: 1200,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('treats maxThinkingTokens=0 as thinking disabled', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'max tokens zero',
      options: {
        maxThinkingTokens: 0,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('lets thinking=disabled take precedence over maxThinkingTokens', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'max tokens with thinking disabled',
      options: {
        thinking: { type: 'disabled' },
        maxThinkingTokens: 100,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('lets thinkingEnabled=false take precedence over maxThinkingTokens', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.thinkingEnabled).toBe(false)
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'max tokens with thinkingEnabled false',
      options: {
        thinkingEnabled: false,
        maxThinkingTokens: 100,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts maxTurns=1 as supported compatibility value', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'maxTurns one',
      options: {
        maxTurns: 1,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('returns explicit unsupported error when maxTurns > 1', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'maxTurns unsupported',
      options: {
        maxTurns: 2,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxTurns')
    }
  })

  it('fails fast on unsupported maxTurns before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        maxTurns: 3,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxTurns')
    }
  })

  it('returns explicit unsupported error when maxBudgetUsd is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'maxBudgetUsd unsupported',
      options: {
        maxBudgetUsd: 0.25,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxBudgetUsd')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported maxBudgetUsd before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        maxBudgetUsd: 1,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxBudgetUsd')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('returns validation error when maxBudgetUsd is negative', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'negative budget',
      options: {
        maxBudgetUsd: -1,
      },
    })

    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.maxBudgetUsd')
    }
  })

  it.each([
    {
      label: 'resume',
      options: { resume: 'session-abc' },
      expected: 'options.resume',
    },
    {
      label: 'sessionId',
      options: { sessionId: 'session-abc' },
      expected: 'options.sessionId',
    },
    {
      label: 'resumeSessionAt',
      options: { resumeSessionAt: 'session-abc' },
      expected: 'options.resumeSessionAt',
    },
  ])('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'resume-like option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported resume option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        resume: 'session-abc',
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.resume')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each([
    {
      label: 'debug',
      options: { debug: true },
      expected: 'options.debug',
    },
    {
      label: 'debugFile',
      options: { debugFile: '/tmp/formax-debug.log' },
      expected: 'options.debugFile',
    },
  ] as const)('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'debug option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported debug option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        debug: true,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.debug')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('returns explicit unsupported error when stderr is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'stderr option unsupported',
      options: {
        stderr: () => {},
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.stderr')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported stderr option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        stderr: () => {},
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.stderr')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each([
    {
      label: 'pathToClaudeCodeExecutable',
      options: { pathToClaudeCodeExecutable: '/usr/local/bin/claude' },
      expected: 'options.pathToClaudeCodeExecutable',
    },
    {
      label: 'spawnClaudeCodeProcess',
      options: { spawnClaudeCodeProcess: () => ({}) },
      expected: 'options.spawnClaudeCodeProcess',
    },
  ] as const)('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'process option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported pathToClaudeCodeExecutable before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.pathToClaudeCodeExecutable')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'executable',
        options: { executable: 'node' },
        expected: 'options.executable',
      },
      {
        label: 'executableArgs',
        options: { executableArgs: ['--trace-warnings'] },
        expected: 'options.executableArgs',
      },
      {
        label: 'extraArgs',
        options: { extraArgs: { '--danger': null } },
        expected: 'options.extraArgs',
      },
      {
        label: 'betas',
        options: { betas: ['context-1m-2025-08-07'] },
        expected: 'options.betas',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'cli option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported executable option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        executable: 'node',
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.executable')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'allowDangerouslySkipPermissions',
        options: { allowDangerouslySkipPermissions: true },
        expected: 'options.allowDangerouslySkipPermissions',
      },
      {
        label: 'permissionPromptToolName',
        options: { permissionPromptToolName: 'MyPermissionTool' },
        expected: 'options.permissionPromptToolName',
      },
      {
        label: 'promptSuggestions',
        options: { promptSuggestions: true },
        expected: 'options.promptSuggestions',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'permission prompt option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported allowDangerouslySkipPermissions before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        allowDangerouslySkipPermissions: true,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.allowDangerouslySkipPermissions')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'continue',
        options: { continue: true },
        expected: 'options.continue',
      },
      {
        label: 'fallbackModel',
        options: { fallbackModel: 'claude-fallback' },
        expected: 'options.fallbackModel',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'continuation option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported continue option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        continue: true,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.continue')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('returns explicit unsupported error when strictMcpConfig is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'strictMcpConfig unsupported',
      options: {
        strictMcpConfig: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.strictMcpConfig')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported strictMcpConfig before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        strictMcpConfig: true,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.strictMcpConfig')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'persistSession',
        options: { persistSession: true },
        expected: 'options.persistSession',
      },
      {
        label: 'forkSession',
        options: { forkSession: true },
        expected: 'options.forkSession',
      },
      {
        label: 'enableFileCheckpointing',
        options: { enableFileCheckpointing: true },
        expected: 'options.enableFileCheckpointing',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'session persistence option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported persistSession before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        persistSession: true,
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.persistSession')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'additionalDirectories',
        options: { additionalDirectories: ['/tmp/workspace'] },
        expected: 'options.additionalDirectories',
      },
      {
        label: 'sandbox',
        options: { sandbox: { mode: 'workspace-write' } },
        expected: 'options.sandbox',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'filesystem sandbox option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported additionalDirectories before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        additionalDirectories: ['/tmp/workspace'],
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.additionalDirectories')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'agent',
        options: { agent: 'researcher' },
        expected: 'options.agent',
      },
      {
        label: 'agents',
        options: { agents: { researcher: { description: 'Research agent' } } },
        expected: 'options.agents',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'agent option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported agent option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        agent: 'researcher',
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.agent')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'tools list',
        options: { tools: ['Read', 'Write'] },
        expected: 'options.tools',
      },
      {
        label: 'tools preset',
        options: { tools: { type: 'preset', preset: 'claude_code' as const } },
        expected: 'options.tools',
      },
      {
        label: 'mcpServers',
        options: { mcpServers: { local: { type: 'stdio', command: 'mcp-server' } } },
        expected: 'options.mcpServers',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools mcp option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported tools option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        tools: ['Read'],
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.tools')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'hooks',
        options: { hooks: { PreToolUse: [] } },
        expected: 'options.hooks',
      },
      {
        label: 'canUseTool',
        options: { canUseTool: () => true },
        expected: 'options.canUseTool',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'hooks option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported hooks option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        hooks: { PreToolUse: [] },
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.hooks')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'plugins',
        options: { plugins: [{ name: 'sample' }] },
        expected: 'options.plugins',
      },
      {
        label: 'settingSources',
        options: { settingSources: ['project'] },
        expected: 'options.settingSources',
      },
      {
        label: 'onElicitation',
        options: { onElicitation: () => ({ action: 'continue' }) },
        expected: 'options.onElicitation',
      },
    ] satisfies Array<{ label: string; options: QueryOptions; expected: string }>,
  )('returns explicit unsupported error when $label is provided', async ({ options, expected }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'plugin elicitation option unsupported',
      options,
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain(expected)
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on unsupported plugins option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCalls += 1
            return {
              value: { role: 'user', content: [{ type: 'text', text: 'stream value' }] },
              done: false,
            }
          },
        }
      },
    }

    const messages = await collectMessages({
      prompt: promptStream,
      options: {
        plugins: [{ name: 'sample' }],
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.plugins')
      expect(result.error).toContain('is not supported in Formax SDK yet')
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

  it('supports systemPrompt preset object with append text', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const systemTextBlocks = turnArgs.system
        .filter((block: any) => block?.type === 'text')
        .map((block: any) => String(block.text))

      expect(systemTextBlocks).toContain('preset append text')
      expect(systemTextBlocks).toContain('additional append text')
      expect(systemTextBlocks.includes('[object Object]')).toBe(false)

      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'done' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'check preset prompt',
      options: {
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'preset append text',
        },
        appendSystemPrompt: 'additional append text',
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

  it('drops whitespace-only feedback in approval responses', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-feedback',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/feedback.txt' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'handled' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'approval with blank feedback',
      options: {
        interactive: true,
        onInputRequest: async () => ({
          decision: 'feedback',
          feedback: '   ',
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-feedback', {
      decision: 'feedback',
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

  it('returns error result when systemPrompt preset is invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    const messages = await collectMessages({
      prompt: 'invalid preset',
      options: {
        systemPrompt: {
          type: 'preset',
          preset: 'unknown',
        } as any,
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('systemPrompt')
    }
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

  it('returns error result when thinking option is invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    const messages = await collectMessages({
      prompt: 'invalid thinking',
      options: {
        thinking: {
          type: 'enabled',
          budgetTokens: -1,
        } as any,
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('thinking')
    }
  })

  it('returns error result when maxThinkingTokens is invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    const messages = await collectMessages({
      prompt: 'invalid maxThinkingTokens',
      options: {
        maxThinkingTokens: -1 as any,
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('maxThinkingTokens')
    }
  })

  it('returns error result when maxTurns is invalid', async () => {
    state.createRuntime.mockResolvedValue(createRuntimeFixture())

    const messages = await collectMessages({
      prompt: 'invalid maxTurns',
      options: {
        maxTurns: 0 as any,
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('maxTurns')
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
