import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptMessage } from '../prompts/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { AbortError } from './errors.js'
import { query } from './query.js'
import type { QueryArgs, QueryMessage, QueryOptions, SDKUserMessage } from './types.js'

const { state } = vi.hoisted(() => ({
  state: {
    createRuntime: vi.fn(),
    findLatestSessionFile: vi.fn(),
    findSessionFileBySessionId: vi.fn(),
    readSessionFile: vi.fn(),
    createSessionWriter: vi.fn(),
    openSessionWriter: vi.fn(),
  },
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime: (args: unknown) => state.createRuntime(args),
}))

vi.mock('../features/repl/sessionSave/reader.js', () => ({
  findLatestSessionFile: (args: unknown) => state.findLatestSessionFile(args),
  findSessionFileBySessionId: (args: unknown) => state.findSessionFileBySessionId(args),
  readSessionFile: (args: unknown) => state.readSessionFile(args),
}))

vi.mock('../features/repl/sessionSave/writer.js', () => ({
  SessionWriter: {
    createNew: (args: unknown) => state.createSessionWriter(args),
    openExisting: (args: unknown) => state.openSessionWriter(args),
  },
}))

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object' },
  }
}

function createSessionWriterFixture() {
  return {
    appendEvent: vi.fn(async () => {}),
    appendHistorySnapshot: vi.fn(async () => {}),
    appendStableMsg: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
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
    state.findLatestSessionFile.mockReset()
    state.findSessionFileBySessionId.mockReset()
    state.readSessionFile.mockReset()
    state.createSessionWriter.mockReset()
    state.openSessionWriter.mockReset()
    state.createSessionWriter.mockImplementation(async (args: any) => ({
      writer: createSessionWriterFixture(),
      meta: { sessionId: String(args?.sessionId ?? 'sdk-session') },
      filePath: '/tmp/sdk-session.jsonl',
    }))
    state.openSessionWriter.mockImplementation(async () => createSessionWriterFixture())
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
    'accepts permissionMode=%s as compatibility no-op option',
    async (permissionMode) => {
      const runTurn = vi.fn(async (turnArgs: any) => {
        expect(turnArgs.exec?.replMode).toBeUndefined()
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

      expect(runTurn).toHaveBeenCalledTimes(1)
      const result = messages[messages.length - 1]
      expect(result?.type).toBe('result')
      if (result?.type === 'result') {
        expect(result.subtype).toBe('success')
      }
    },
  )

  it('accepts compatibility permissionMode with async prompt stream input', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.exec?.replMode).toBeUndefined()
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                done: true,
                value: undefined,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
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

    await expect(initPromise).rejects.toBeInstanceOf(AbortError)
    await expect(initPromise).rejects.toThrow('query.close was called before query iteration started')
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('supports supportedCommands() before iteration starts', async () => {
    const queryIterator = query({
      prompt: 'list supported commands',
    })

    const commands = await queryIterator.supportedCommands()
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.some((command) => command.name === '/help')).toBe(true)
    expect(commands.some((command) => command.command === '/help')).toBe(true)
    const helpCommand = commands.find((command) => command.command === '/help')
    expect(helpCommand?.source).toBe('builtin')
    const modelCommand = commands.find((command) => command.command === '/model')
    expect(modelCommand?.argumentHint).toBe('[model]')
    expect(modelCommand?.argHint).toBe('[model]')
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('validates supportedCommands() input options', async () => {
    const queryIterator = query({
      prompt: 'invalid supported commands input',
      options: {
        cwd: 123 as any,
      },
    })

    await expect(queryIterator.supportedCommands()).rejects.toThrow(
      'Invalid query arguments or command output for query.supportedCommands',
    )
  })

  it('supports supportedAgents() before iteration starts', async () => {
    const runtime = createRuntimeFixture()
    runtime.allowedSubagents = [
      { name: 'Plan', description: 'Design implementation plans' },
      { name: 'Explore', description: 'Explore large codebases quickly' },
    ]
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'list supported agents',
    })

    const agents = await queryIterator.supportedAgents()
    expect(agents).toEqual([
      { name: 'Plan', description: 'Design implementation plans' },
      { name: 'Explore', description: 'Explore large codebases quickly' },
    ])
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
  })

  it('validates supportedAgents() input options', async () => {
    const queryIterator = query({
      prompt: 'invalid supported agents input',
      options: {
        cwd: 123 as any,
      },
    })

    await expect(queryIterator.supportedAgents()).rejects.toThrow(
      'Invalid query arguments or agent output for query.supportedAgents',
    )
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('validates supportedAgents() output shape', async () => {
    const runtime = createRuntimeFixture()
    runtime.allowedSubagents = [{ name: 123, description: 'invalid' }] as any
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'invalid supported agents output',
    })

    await expect(queryIterator.supportedAgents()).rejects.toThrow(
      'Invalid query arguments or agent output for query.supportedAgents',
    )
  })

  it('supports supportedModels() before iteration starts', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.provider = 'anthropic'
    runtime.cfg.llm.model = 'claude-sonnet-4-6'
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'list supported models',
    })

    const models = await queryIterator.supportedModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0]).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      value: 'claude-sonnet-4-6',
      displayName: 'claude-sonnet-4-6',
      description: 'anthropic model',
    })
    const latestSonnet = models.find((model) => model.model === 'claude-3-5-sonnet-latest')
    expect(latestSonnet).toMatchObject({
      value: 'claude-3-5-sonnet-latest',
      displayName: 'claude-3-5-sonnet-latest',
      supportsEffort: false,
    })
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
  })

  it('validates supportedModels() input options', async () => {
    const queryIterator = query({
      prompt: 'invalid supported models input',
      options: {
        cwd: 123 as any,
      },
    })

    await expect(queryIterator.supportedModels()).rejects.toThrow(
      'Invalid query arguments or model output for query.supportedModels',
    )
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('supports accountInfo() before iteration starts', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.provider = 'openai'
    runtime.cfg.llm.model = 'gpt-4o'
    runtime.cfg.llm.baseUrl = 'https://api.openai.com/v1'
    runtime.cfg.llm.apiKey = 'sk-test'
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'account info',
      options: {
        env: { ...process.env, FORMAX_API_KEY: '' },
      },
    })

    const account = await queryIterator.accountInfo()
    expect(account).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      hasApiKey: true,
      apiKeySource: 'config',
      tokenSource: 'config',
    })
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
  })

  it('derives accountInfo token/api key source from explicit options.env', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.provider = 'anthropic'
    runtime.cfg.llm.model = 'claude-sonnet'
    runtime.cfg.llm.apiKey = 'sk-env'
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'account info env source',
      options: {
        env: { ...process.env, FORMAX_API_KEY: 'sk-env' },
      },
    })

    const account = await queryIterator.accountInfo()
    expect(account.apiKeySource).toBe('env')
    expect(account.tokenSource).toBe('env')
  })

  it('uses options.model override in accountInfo()', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.provider = 'anthropic'
    runtime.cfg.llm.model = 'claude-default'
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'account info model override',
      options: {
        model: 'claude-override',
      },
    })

    const account = await queryIterator.accountInfo()
    expect(account.model).toBe('claude-override')
  })

  it('uses setModel() pre-start override in accountInfo()', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.provider = 'anthropic'
    runtime.cfg.llm.model = 'claude-default'
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'account info setModel override',
    })
    await queryIterator.setModel('claude-set-model')

    const account = await queryIterator.accountInfo()
    expect(account.model).toBe('claude-set-model')
  })

  it('validates accountInfo() input options', async () => {
    const queryIterator = query({
      prompt: 'invalid account info input',
      options: {
        cwd: 123 as any,
      },
    })

    await expect(queryIterator.accountInfo()).rejects.toThrow(
      'Invalid query arguments or account output for query.accountInfo',
    )
    expect(state.createRuntime).not.toHaveBeenCalled()
  })

  it('validates accountInfo() output shape', async () => {
    const runtime = createRuntimeFixture()
    runtime.cfg.llm.model = 123 as any
    state.createRuntime.mockResolvedValue(runtime)

    const queryIterator = query({
      prompt: 'invalid account info output',
    })

    await expect(queryIterator.accountInfo()).rejects.toThrow(
      'Invalid query arguments or account output for query.accountInfo',
    )
  })

  it('exposes mcpServerStatus() with explicit unsupported error', async () => {
    const queryIterator = query({
      prompt: 'mcp status',
    })

    await expect(queryIterator.mcpServerStatus()).rejects.toThrow(
      'query.mcpServerStatus is not supported in Formax SDK yet',
    )
  })

  it('exposes setMcpServers() with explicit unsupported error', async () => {
    const queryIterator = query({
      prompt: 'set mcp servers',
    })

    await expect(queryIterator.setMcpServers({ local: {} })).rejects.toThrow(
      'query.setMcpServers is not supported in Formax SDK yet',
    )
  })

  it('exposes reconnectMcpServer() with explicit unsupported error', async () => {
    const queryIterator = query({
      prompt: 'reconnect mcp server',
    })

    await expect(queryIterator.reconnectMcpServer('local')).rejects.toThrow(
      'query.reconnectMcpServer is not supported in Formax SDK yet',
    )
  })

  it('exposes toggleMcpServer() with explicit unsupported error', async () => {
    const queryIterator = query({
      prompt: 'toggle mcp server',
    })

    await expect(queryIterator.toggleMcpServer('local', true)).rejects.toThrow(
      'query.toggleMcpServer is not supported in Formax SDK yet',
    )
  })

  it('exposes streamInput() with explicit unsupported error', async () => {
    const queryIterator = query({
      prompt: 'stream input',
    })

    async function* inputStream() {
      yield { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] }
    }

    await expect(queryIterator.streamInput(inputStream())).rejects.toThrow(
      'query.streamInput is not supported in Formax SDK yet',
    )
  })

  it('exposes stopTask() and aborts query before iteration starts', async () => {
    const queryIterator = query({
      prompt: 'stop task',
    })

    await queryIterator.stopTask('task-1')
    await expect(queryIterator.initializationResult()).rejects.toThrow(
      'query.stopTask was called before query iteration started',
    )
  })

  it('exposes rewindFiles() with structured unsupported result', async () => {
    const queryIterator = query({
      prompt: 'rewind files',
    })

    await expect(queryIterator.rewindFiles('user-msg-1', { dryRun: true })).resolves.toEqual({
      canRewind: false,
      error: 'query.rewindFiles is not supported in Formax SDK yet',
    })
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

  it('accepts maxTurns>1 as compatibility no-op option', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'maxTurns compatibility',
      options: {
        maxTurns: 2,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts maxTurns with async prompt stream input', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                done: true,
                value: undefined,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts maxBudgetUsd as compatibility no-op option', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'maxBudgetUsd compatibility',
      options: {
        maxBudgetUsd: 0.25,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts maxBudgetUsd with async prompt stream input', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                done: true,
                value: undefined,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
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

  it('accepts effort as compatibility no-op option', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'effort compatibility',
      options: {
        effort: 'high',
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts effort with async prompt stream input', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                done: true,
                value: undefined,
              }
            }
            emitted = true
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
        effort: 'low',
      },
    })

    expect(nextCalls).toBeGreaterThan(0)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('restores persisted history when options.resume is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.role).toBe('user')
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('persisted user')
      expect(turnArgs.history[1]?.role).toBe('assistant')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('persisted assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    state.createRuntime.mockResolvedValue(createRuntimeFixture({ runTurn }))
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/resume-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-abc', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'resume prompt',
      options: { resume: 'session-abc' },
    })

    expect(state.findSessionFileBySessionId).toHaveBeenCalledTimes(1)
    expect(state.readSessionFile).toHaveBeenCalledTimes(1)
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(messages[0]?.type).toBe('system')
    if (messages[0]?.type === 'system') {
      expect(messages[0].session_id).toBe('session-abc')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('session-abc')
    }
  })

  it('uses options.sessionId when resume is not provided', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'custom session id',
      options: { sessionId: 'custom-session-id' },
    })

    expect(state.findSessionFileBySessionId).not.toHaveBeenCalled()
    expect(messages[0]?.type).toBe('system')
    if (messages[0]?.type === 'system') {
      expect(messages[0].session_id).toBe('custom-session-id')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('custom-session-id')
    }
  })

  it('accepts resumeSessionAt as compatibility no-op option', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('persisted user')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('persisted assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/resume-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-abc', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'resumeSessionAt compatibility',
      options: { resume: 'session-abc', resumeSessionAt: 'message-123' },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('session-abc')
    }
  })

  it('fails fast when options.resume session is missing before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue(null)
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
      expect(result.error).toContain('is not available in local session storage')
    }
  })

  it('returns explicit error when options.resume and options.sessionId conflict', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'resume conflict',
      options: {
        resume: 'session-a',
        sessionId: 'session-b',
      },
    })

    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.sessionId')
      expect(result.error).toContain('conflicts with options.resume')
    }
  })

  it('writes lifecycle lines when options.debugFile is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-sdk-debugfile-'))
    const debugFile = path.join(dir, 'query.log')

    const messages = await collectMessages({
      prompt: 'debug file supported',
      options: {
        debugFile,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const content = await fs.readFile(debugFile, 'utf8')
    expect(content).toContain('query.start')
    expect(content).toContain('query.success')
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('enables hook debug env when options.debug is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'debug option supported',
      options: {
        debug: true,
      },
    })

    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    expect(state.createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          FORMAX_HOOKS_DEBUG: '1',
        }),
      }),
    )
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('allows stderr callback option on successful runs', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    const stderr = vi.fn()

    const messages = await collectMessages({
      prompt: 'stderr option supported',
      options: {
        stderr,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(stderr).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('forwards execution errors to stderr callback', async () => {
    const runTurn = vi.fn(async () => {
      throw new Error('runtime exploded')
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    const stderr = vi.fn()

    const messages = await collectMessages({
      prompt: 'stderr callback on error',
      options: {
        stderr,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    expect(stderr).toHaveBeenCalledTimes(1)
    expect(String(stderr.mock.calls[0]?.[0] ?? '')).toContain('runtime exploded')
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('runtime exploded')
    }
  })

  it.each([
    {
      label: 'pathToClaudeCodeExecutable',
      options: { pathToClaudeCodeExecutable: '/usr/local/bin/claude' },
    },
    {
      label: 'spawnClaudeCodeProcess',
      options: { spawnClaudeCodeProcess: () => ({}) },
    },
  ] as const)('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'process option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('does not fail fast on pathToClaudeCodeExecutable before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                value: undefined,
                done: true,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it.each(
    [
      {
        label: 'executable',
        options: { executable: 'node' },
      },
      {
        label: 'executableArgs',
        options: { executableArgs: ['--trace-warnings'] },
      },
      {
        label: 'extraArgs',
        options: { extraArgs: { '--danger': null } },
      },
      {
        label: 'betas',
        options: { betas: ['context-1m-2025-08-07'] },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'cli option unsupported',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('does not fail fast on executable option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                value: undefined,
                done: true,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it.each(
    [
      {
        label: 'permissionPromptToolName',
        options: { permissionPromptToolName: 'MyPermissionTool' },
      },
      {
        label: 'promptSuggestions',
        options: { promptSuggestions: true },
      },
      {
        label: 'allowDangerouslySkipPermissions=false',
        options: { allowDangerouslySkipPermissions: false },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'permission prompt option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('returns explicit unsupported error when allowDangerouslySkipPermissions=true is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'allowDangerouslySkipPermissions unsupported',
      options: {
        allowDangerouslySkipPermissions: true,
      },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.allowDangerouslySkipPermissions')
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
        label: 'fallbackModel',
        options: { fallbackModel: 'claude-fallback' },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'continuation option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('restores latest persisted history when options.continue is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.role).toBe('user')
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('continued user')
      expect(turnArgs.history[1]?.role).toBe('assistant')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('continued assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continued user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continued assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue prompt',
      options: {
        continue: true,
      },
    })

    expect(state.findLatestSessionFile).toHaveBeenCalledTimes(1)
    expect(state.findSessionFileBySessionId).not.toHaveBeenCalled()
    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(messages[0]?.type).toBe('system')
    if (messages[0]?.type === 'system') {
      expect(messages[0].session_id).toBe('continued-session-id')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('continued-session-id')
    }
  })

  it('allows continue when sessionId matches latest session', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continued user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continued assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue with explicit matching session',
      options: {
        continue: true,
        sessionId: 'continued-session-id',
      },
    })

    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    const init = messages[0]
    expect(init?.type).toBe('system')
    if (init?.type === 'system') {
      expect(init.session_id).toBe('continued-session-id')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('continued-session-id')
    }
  })

  it('returns conflict when continue sessionId differs from latest without forkSession', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    state.findLatestSessionFile.mockResolvedValue('/tmp/latest-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'continued-session-id', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'continued user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'continued assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'continue with conflicting session',
      options: {
        continue: true,
        sessionId: 'different-session-id',
      },
    })

    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.sessionId')
      expect(result.error).toContain('latest session is')
      expect(result.error).toContain('unless options.forkSession is true')
    }
  })

  it('continues as a new session when no previous session exists', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    state.findLatestSessionFile.mockResolvedValue(null)

    const messages = await collectMessages({
      prompt: 'continue without prior session',
      options: {
        continue: true,
      },
    })

    expect(state.findLatestSessionFile).toHaveBeenCalledTimes(1)
    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(messages[0]?.type).toBe('system')
    if (messages[0]?.type === 'system') {
      expect(messages[0].session_id.length).toBeGreaterThan(0)
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id.length).toBeGreaterThan(0)
    }
  })

  it('fails fast on continue+resume conflict before draining async prompt stream', async () => {
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
      expect(result.error).toContain('options.continue')
      expect(result.error).toContain('cannot be used with options.resume')
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

  it('persists query turn when persistSession is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'persisted ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    const writer = createSessionWriterFixture()
    state.createSessionWriter.mockResolvedValue({
      writer,
      meta: { sessionId: 'persisted-session-id' },
      filePath: '/tmp/persisted-session.jsonl',
    })

    const messages = await collectMessages({
      prompt: 'persist this turn',
      options: {
        persistSession: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(state.createSessionWriter).toHaveBeenCalledTimes(1)
    expect(state.openSessionWriter).not.toHaveBeenCalled()
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    expect(writer.appendEvent).toHaveBeenCalledWith(
      'ui_stats',
      expect.objectContaining({
        uiMsgCount: 2,
        firstUserPrompt: 'persist this turn',
        lastUserPrompt: 'persist this turn',
      }),
    )
    expect(writer.shutdown).toHaveBeenCalledTimes(1)

    const init = messages[0]
    expect(init?.type).toBe('system')
    if (init?.type === 'system') {
      expect(init.session_id).toBe('persisted-session-id')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('persisted-session-id')
    }
  })

  it('appends to resumed session file when persistSession is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'resume persisted' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/resume-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'session-abc', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })
    const writer = createSessionWriterFixture()
    state.openSessionWriter.mockResolvedValue(writer)

    const messages = await collectMessages({
      prompt: 'resume and persist',
      options: {
        resume: 'session-abc',
        persistSession: true,
      },
    })

    expect(state.openSessionWriter).toHaveBeenCalledWith({
      filePath: '/tmp/resume-session.jsonl',
    })
    expect(state.createSessionWriter).not.toHaveBeenCalled()
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    expect(writer.shutdown).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('session-abc')
    }
  })

  it('supports forkSession for resume + sessionId rebinding', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      expect(turnArgs.history).toHaveLength(2)
      expect(turnArgs.history[0]?.content?.[0]?.text).toBe('persisted user')
      expect(turnArgs.history[1]?.content?.[0]?.text).toBe('persisted assistant')
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'forked' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/source-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'source-session', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })

    const messages = await collectMessages({
      prompt: 'fork this conversation',
      options: {
        resume: 'source-session',
        sessionId: 'forked-session',
        forkSession: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const init = messages[0]
    expect(init?.type).toBe('system')
    if (init?.type === 'system') {
      expect(init.session_id).toBe('forked-session')
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('forked-session')
    }
  })

  it('creates a new persistence file when forkSession is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'fork persisted' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    state.findSessionFileBySessionId.mockResolvedValue('/tmp/source-session.jsonl')
    state.readSessionFile.mockResolvedValue({
      meta: { sessionId: 'source-session', cwd: '/repo' },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'persisted assistant' }] },
      ],
    })
    const writer = createSessionWriterFixture()
    state.createSessionWriter.mockResolvedValue({
      writer,
      meta: { sessionId: 'forked-session' },
      filePath: '/tmp/forked-session.jsonl',
    })

    const messages = await collectMessages({
      prompt: 'fork and persist',
      options: {
        resume: 'source-session',
        sessionId: 'forked-session',
        forkSession: true,
        persistSession: true,
      },
    })

    expect(state.openSessionWriter).not.toHaveBeenCalled()
    expect(state.createSessionWriter).toHaveBeenCalledTimes(1)
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('forked-session')
    }
  })

  it('enables session persistence when enableFileCheckpointing is true', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'checkpointed' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    const writer = createSessionWriterFixture()
    state.createSessionWriter.mockResolvedValue({
      writer,
      meta: { sessionId: 'checkpointed-session' },
      filePath: '/tmp/checkpointed-session.jsonl',
    })

    const messages = await collectMessages({
      prompt: 'checkpoint this turn',
      options: {
        enableFileCheckpointing: true,
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(state.createSessionWriter).toHaveBeenCalledTimes(1)
    expect(state.openSessionWriter).not.toHaveBeenCalled()
    expect(writer.appendHistorySnapshot).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
      expect(result.session_id).toBe('checkpointed-session')
    }
  })

  it.each(
    [
      {
        label: 'additionalDirectories',
        options: { additionalDirectories: ['/tmp/workspace'] },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'filesystem sandbox option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it.each(
    [
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

  it('fails fast on unsupported sandbox before draining async prompt stream', async () => {
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
        sandbox: { mode: 'workspace-write' },
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.sandbox')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it.each(
    [
      {
        label: 'agent',
        options: { agent: 'researcher' },
      },
      {
        label: 'agents',
        options: { agents: { researcher: { description: 'Research agent' } } },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'agent option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('does not fail fast on agent option before draining async prompt stream', async () => {
    const runtime = createRuntimeFixture()
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                value: undefined,
                done: true,
              }
            }
            emitted = true
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

    expect(nextCalls).toBeGreaterThan(0)
    expect(runtime.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('applies options.tools list as the base available tools', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const toolNames = (turnArgs.tools as ToolDefinition[]).map((tool) => tool.name)
      expect(toolNames).toEqual(['Read'])
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools list supported',
      options: {
        tools: ['Read', 'Read'],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    expect(messages[0]?.type).toBe('system')
    if (messages[0]?.type === 'system') {
      expect(messages[0].tools.map((tool) => tool.name)).toEqual(['Read'])
    }
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('keeps default tool set when options.tools preset is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const toolNames = (turnArgs.tools as ToolDefinition[]).map((tool) => tool.name)
      expect(toolNames).toEqual(['Read', 'Write'])
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools preset supported',
      options: {
        tools: { type: 'preset', preset: 'claude_code' as const },
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('returns explicit error when options.tools contains unknown tool names', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools unknown',
      options: {
        tools: ['Read', 'NoSuchTool'],
      },
    })

    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.tools includes unsupported tool(s)')
      expect(result.error).toContain('NoSuchTool')
    }
  })

  it('returns explicit unsupported error when mcpServers is provided', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools mcp option unsupported',
      options: { mcpServers: { local: { type: 'stdio', command: 'mcp-server' } } },
    })

    expect(runTurn).not.toHaveBeenCalled()
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.mcpServers')
      expect(result.error).toContain('is not supported in Formax SDK yet')
    }
  })

  it('fails fast on invalid options.tools before draining async prompt stream', async () => {
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
        tools: ['default', 'Read'],
      },
    })

    expect(nextCalls).toBe(0)
    expect(runtime.engine.runTurn).not.toHaveBeenCalled()
    expect(state.createRuntime).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('error_during_execution')
      expect(result.error).toContain('options.tools cannot combine "default"')
    }
  })

  it('accepts duplicated "default" values in options.tools', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      const toolNames = (turnArgs.tools as ToolDefinition[]).map((tool) => tool.name)
      expect(toolNames).toEqual(['Read', 'Write'])
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'tools duplicated default',
      options: {
        tools: ['default', 'default'],
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it.each(
    [
      {
        label: 'hooks',
        options: { hooks: { PreToolUse: [] } },
        expected: 'options.hooks',
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
      },
      {
        label: 'settingSources',
        options: { settingSources: ['project'] },
      },
    ] satisfies Array<{ label: string; options: QueryOptions }>,
  )('accepts $label as compatibility no-op option', async ({ options }) => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'plugin elicitation option compatibility',
      options,
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts onElicitation as compatibility option', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const messages = await collectMessages({
      prompt: 'onElicitation compatibility',
      options: {
        onElicitation: async () => ({ action: 'decline' }),
      },
    })

    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
    }
  })

  it('accepts onElicitation with async prompt stream input', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)
    let nextCalls = 0

    const promptStream: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]() {
        let emitted = false
        return {
          next: async () => {
            nextCalls += 1
            if (emitted) {
              return {
                value: undefined,
                done: true,
              }
            }
            emitted = true
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
        onElicitation: async () => ({ action: 'decline' }),
      },
    })

    expect(nextCalls).toBeGreaterThan(0)
    expect(runTurn).toHaveBeenCalledTimes(1)
    const result = messages[messages.length - 1]
    expect(result?.type).toBe('result')
    if (result?.type === 'result') {
      expect(result.subtype).toBe('success')
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

  it('handles approval input requests via canUseTool callback', async () => {
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

    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedPermissions: [
        {
          type: 'addRules' as const,
          rules: [{ toolName: 'Write', ruleContent: '/tmp/a.txt' }],
          behavior: 'allow' as const,
          destination: 'projectSettings' as const,
        },
      ],
    }))

    const messages = await collectMessages({
      prompt: 'write file',
      options: {
        interactive: true,
        canUseTool,
      },
    })

    expect(
      messages.some((message) => message.type === 'input_request' && message.subtype === 'approval_request'),
    ).toBe(true)
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-1', {
      decision: 'approve_remember',
      scope: 'project',
    })
  })

  it('maps canUseTool addDirectories updates to destination-aware remember scope', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-directories',
        toolName: 'Read',
        action: { kind: 'fs.read', path: '/outside/workspace/file.txt' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'approved' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'allow workspace directory',
      options: {
        interactive: true,
        canUseTool: async () => ({
          behavior: 'allow',
          updatedPermissions: [
            {
              type: 'addDirectories',
              directories: ['/outside/workspace'],
              destination: 'userSettings',
            },
          ],
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-directories', {
      decision: 'approve_remember',
      scope: 'global',
    })
  })

  it('falls back to approve when updatedPermissions cannot be represented as remember answers', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-remove-rules',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/remove-rules.txt' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'approved' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'approval remove rules',
      options: {
        interactive: true,
        canUseTool: async () => ({
          behavior: 'allow',
          updatedPermissions: [
            {
              type: 'removeRules',
              rules: [{ toolName: 'Write', ruleContent: '/tmp/remove-rules.txt' }],
              behavior: 'allow',
              destination: 'projectSettings',
            },
          ],
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-remove-rules', {
      decision: 'approve',
    })
  })

  it('falls back to approve when remember-capable updates contain mixed destinations', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-mixed-scopes',
        toolName: 'Bash',
        action: { kind: 'bash.exec', command: 'echo hi' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'approved' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'approval mixed scopes',
      options: {
        interactive: true,
        canUseTool: async () => ({
          behavior: 'allow',
          updatedPermissions: [
            {
              type: 'addRules',
              rules: [{ toolName: 'Bash', ruleContent: 'echo hi' }],
              behavior: 'allow',
              destination: 'session',
            },
            {
              type: 'setMode',
              mode: 'acceptEdits',
              destination: 'projectSettings',
            },
          ],
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-mixed-scopes', {
      decision: 'approve',
    })
  })

  it('forwards canUseTool approval updatedInput via updated_input_json answer', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-updated-input',
        toolName: 'Bash',
        action: { kind: 'bash.exec', command: 'echo old' },
        effectiveDecision: 'prompt',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'approved' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    await collectMessages({
      prompt: 'patch tool input',
      options: {
        interactive: true,
        canUseTool: async () => ({
          behavior: 'allow',
          updatedInput: { command: 'echo patched' },
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-updated-input', {
      decision: 'approve',
      updated_input_json: JSON.stringify({ command: 'echo patched' }),
    })
  })

  it('maps canUseTool deny messages to approval feedback answers', async () => {
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
        canUseTool: async () => ({
          behavior: 'deny',
          message: 'Use project-local write only',
        }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-approval-feedback', {
      decision: 'feedback',
      feedback: 'Use project-local write only',
    })
  })

  it('falls back to deny approval when canUseTool callback is not provided', async () => {
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

  it('handles ask_user_question input requests via canUseTool callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-1',
        questions: [
          {
            question: 'Choose one',
            header: 'choice',
            options: [{ label: 'A', description: 'option A' }],
            multiSelect: false,
          },
        ],
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'answered' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: {
        answers: {
          choice: 'A',
        },
      },
    }))

    const messages = await collectMessages({
      prompt: 'ask user',
      options: {
        interactive: true,
        canUseTool,
      },
    })

    expect(
      messages.some((message) => message.type === 'input_request' && message.subtype === 'ask_user_question'),
    ).toBe(true)
    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-question-1', {
      choice: 'A',
    })
  })

  it('passes approval context fields into canUseTool callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'approval_request',
        toolUseId: 'tool-approval-context',
        toolName: 'Write',
        action: { kind: 'fs.write', path: '/tmp/context.txt' },
        effectiveDecision: 'prompt',
        workspaceRequest: { dir: '/outside/workspace' },
        blockedPath: '/outside/workspace',
        decisionReason: 'Path is outside workspace roots',
      })
      return [...turnArgs.history, turnArgs.user, { role: 'assistant', content: [{ type: 'text', text: 'answered' }] }]
    })
    const runtime = createRuntimeFixture({ runTurn })
    state.createRuntime.mockResolvedValue(runtime)

    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
    }))

    await collectMessages({
      prompt: 'approval context',
      options: {
        interactive: true,
        canUseTool,
      },
    })

    expect(canUseTool).toHaveBeenCalledWith(
      'Write',
      expect.objectContaining({
        kind: 'fs.write',
        path: '/tmp/context.txt',
      }),
      expect.objectContaining({
        signal: expect.any(Object),
        toolUseID: 'tool-approval-context',
        blockedPath: '/outside/workspace',
        decisionReason: 'Path is outside workspace roots',
        suggestions: expect.any(Array),
      }),
    )
  })

  it('handles ask_user_question input requests via onElicitation callback', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-elicitation',
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

    const onElicitation = vi.fn(async () => ({
      action: 'accept' as const,
      content: { choice: 'A' },
    }))

    const messages = await collectMessages({
      prompt: 'ask user via elicitation',
      options: {
        interactive: true,
        onElicitation,
      },
    })

    expect(
      messages.some((message) => message.type === 'input_request' && message.subtype === 'ask_user_question'),
    ).toBe(true)
    expect(onElicitation).toHaveBeenCalledTimes(1)
    expect(onElicitation).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'formax',
        mode: 'form',
        elicitationId: 'tool-question-elicitation',
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            choice: expect.any(Object),
          }),
        }),
      }),
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    )
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-question-elicitation', {
      choice: 'A',
    })
  })

  it('prefers canUseTool over onElicitation for ask_user_question callbacks', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-priority',
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

    const canUseTool = vi.fn(async () => ({
      behavior: 'allow' as const,
      updatedInput: { answers: { choice: 'B' } },
    }))
    const onElicitation = vi.fn(async () => ({
      action: 'accept' as const,
      content: { choice: 'A' },
    }))

    await collectMessages({
      prompt: 'ask user callback priority',
      options: {
        interactive: true,
        canUseTool,
        onElicitation,
      },
    })

    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(onElicitation).not.toHaveBeenCalled()
    expect(runtime.userInputManager.submitAnswers).toHaveBeenCalledWith('tool-question-priority', {
      choice: 'B',
    })
  })

  it('does not block shutdown when canUseTool callback never resolves', async () => {
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

    const canUseTool = vi.fn(async () => {
      return await new Promise<never>(() => {})
    })

    const consumeAndBreak = async () => {
      for await (const message of query({
        prompt: 'cancel while waiting',
        options: {
          interactive: true,
          canUseTool,
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

    expect(canUseTool).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
  })

  it('rejects approval input when canUseTool response fails validation', async () => {
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
        canUseTool: async () => ({ behavior: 'unknown' as any }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-approval-invalid')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'Invalid canUseTool response for approval_request',
    )
  })

  it('rejects ask_user_question input when canUseTool allow response omits updatedInput.answers', async () => {
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
        canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-question-invalid')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'updatedInput.answers',
    )
  })

  it('rejects ask_user_question input when canUseTool denies', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-denied',
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
      prompt: 'denied question callback',
      options: {
        interactive: true,
        canUseTool: async () => ({ behavior: 'deny', message: 'need manual answer' }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-question-denied')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'need manual answer',
    )
  })

  it('rejects ask_user_question input when elicitation response fails validation', async () => {
    const runTurn = vi.fn(async (turnArgs: any) => {
      turnArgs.onEvent({
        type: 'ask_user_question',
        toolUseId: 'tool-question-elicitation-invalid',
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

    await collectMessages({
      prompt: 'ask user invalid elicitation',
      options: {
        interactive: true,
        onElicitation: async () => ({ action: 'accept', content: 'not-an-object' as any }),
      },
    })

    expect(runtime.userInputManager.submitAnswers).not.toHaveBeenCalled()
    expect(runtime.userInputManager.reject).toHaveBeenCalledTimes(1)
    expect(runtime.userInputManager.reject.mock.calls[0][0]).toBe('tool-question-elicitation-invalid')
    expect(String(runtime.userInputManager.reject.mock.calls[0][1]?.message ?? '')).toContain(
      'Invalid elicitation response',
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
