import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../chat/engine.js'
import { createUserInputManager } from '../tools/runtime/userInputManager.js'
import { classifyRpcMessage, JSON_RPC_ERRORS } from './jsonrpc.js'
import type { Thread } from './protocol.js'
import { AppServer } from './server.js'
import { ThreadStore } from './threadStore.js'
import { TurnRunner } from './turnRunner.js'

function request(id: string | number | null, method: string, params?: unknown) {
  return classifyRpcMessage({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  })
}

async function waitForNotification(
  notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }>,
  predicate: (n: { jsonrpc: '2.0'; method: string; params?: unknown }) => boolean,
  timeoutMs = 2500,
): Promise<{ jsonrpc: '2.0'; method: string; params?: unknown }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = notifications.find(predicate)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for notification')
}

describe('AppServer', () => {
  it('returns NOT_INITIALIZED for requests before initialize', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(request(1, 'thread/start'))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.NOT_INITIALIZED)
    expect((out[0] as any).error.message).toBe('Not initialized')
  })

  it('handles initialize and then returns method not found for unknown methods', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })

    const init = await server.handleMessage(request(1, 'initialize', { clientInfo: { name: 'web', version: '1.0.0' } }))
    expect(init).toHaveLength(1)
    expect((init[0] as any).result.serverInfo).toEqual({ name: 'formax', version: 'test' })
    expect((init[0] as any).result.protocolVersion).toBe('0.2')
    expect((init[0] as any).result.serverInstanceId).toBeTypeOf('string')
    expect((init[0] as any).result.limits).toEqual(
      expect.objectContaining({
        maxRequestBytes: expect.any(Number),
        maxEventBytes: expect.any(Number),
        maxPendingInputsPerThread: expect.any(Number),
        defaultInputTtlMs: expect.any(Number),
        maxInFlightTurnsPerThread: 1,
      }),
    )

    const unknown = await server.handleMessage(request(2, 'unknown/method'))
    expect(unknown).toHaveLength(1)
    expect((unknown[0] as any).error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND)
  })

  it('validates initialize params', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    const out = await server.handleMessage(request(1, 'initialize', { clientInfo: { name: '', version: '1.0.0' } }))
    expect(out).toHaveLength(1)
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
  })

  it('accepts initialized notification after initialize', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    void (await server.handleMessage(request(1, 'initialize')))
    const out = await server.handleMessage(classifyRpcMessage({ jsonrpc: '2.0', method: 'initialized' }))
    expect(out).toEqual([])
    expect(server.getState().initializedNotified).toBe(true)
  })

  it('routes thread methods to threadStore after initialize', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return { thread: { ...baseThread, id: threadId }, staleInputs: [] }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(request(2, 'thread/start'))
    expect((startOut[0] as any).result.thread.id).toBe('t-1')

    const resumeOut = await server.handleMessage(request(3, 'thread/resume', { threadId: 't-2' }))
    expect((resumeOut[0] as any).result.thread.id).toBe('t-2')

    const listOut = await server.handleMessage(request(4, 'thread/list', { limit: 10 }))
    expect((listOut[0] as any).result.data).toHaveLength(1)

    const readOut = await server.handleMessage(request(5, 'thread/read', { threadId: 't-1' }))
    expect((readOut[0] as any).result.transcriptPreview).toEqual([{ role: 'user', text: 'hi' }])
  })

  it('routes turn methods to turnRunner after initialize', async () => {
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      turnRunner: {
        async startTurn(params) {
          return { turn: { id: 'turn-1', threadId: params.threadId, status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))

    const startOut = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'hello' },
      }),
    )
    expect((startOut[0] as any).result.turn.status).toBe('running')

    const interruptOut = await server.handleMessage(
      request(3, 'turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' }),
    )
    expect((interruptOut[0] as any).result).toEqual({})

    const submitOut = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId: 'thread-1',
        turnId: 'turn-1',
        inputId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitOut[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    const emit = server.createTurnNotificationEmitter()
    emit('turn/event', { threadId: 'thread-1' })
    expect(notifications).toContainEqual({
      jsonrpc: '2.0',
      method: 'turn/event',
      params: { threadId: 'thread-1' },
    })
  })

  it('returns INTERNAL_ERROR when turn runner is not configured', async () => {
    const server = new AppServer({ info: { name: 'formax', version: 'test' } })
    await server.handleMessage(request(1, 'initialize'))
    const out = await server.handleMessage(
      request(2, 'turn/start', {
        threadId: 'thread-1',
        input: { text: 'hello' },
      }),
    )
    expect((out[0] as any).error.code).toBe(JSON_RPC_ERRORS.INTERNAL_ERROR)
  })

  it('returns INPUT_EXPIRED for stale input submissions after resume', async () => {
    const baseThread: Thread = {
      id: 't-1',
      cwd: '/tmp/workspace',
      createdAt: '2026-02-08T00:00:00.000Z',
      updatedAt: '2026-02-08T00:00:01.000Z',
    }
    const server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore: {
        async startThread() {
          return baseThread
        },
        async resumeThread(threadId) {
          return {
            thread: { ...baseThread, id: threadId },
            staleInputs: [
              {
                inputId: 'stale-1',
                threadId,
                turnId: 'turn-stale',
                toolUseId: 'ask-1',
                kind: 'ask_user_question' as const,
                status: 'expired' as const,
                createdAt: '2026-02-08T00:00:00.000Z',
                expiresAt: '2026-02-08T00:05:00.000Z',
                resolvedAt: '2026-02-08T00:10:00.000Z',
                reason: 'server_restart',
              },
            ],
          }
        },
        async listThreads() {
          return { data: [{ ...baseThread, messageCount: 1, lastUserPrompt: 'hi', label: null }], nextCursor: null }
        },
        async readThread() {
          return { thread: baseThread, transcriptPreview: [{ role: 'user', text: 'hi' }] }
        },
      },
      turnRunner: {
        async startTurn() {
          return { turn: { id: 'turn-1', threadId: 't-1', status: 'running' as const } }
        },
        async interruptTurn() {
          return {}
        },
        async submitInput() {
          return { accepted: true, status: 'accepted' as const }
        },
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    await server.handleMessage(request(2, 'thread/resume', { threadId: 't-1' }))
    const submit = await server.handleMessage(
      request(3, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-stale',
        inputId: 'stale-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submit[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((submit[0] as any).error.message).toBe('INPUT_EXPIRED')
    expect((submit[0] as any).error.data).toEqual(
      expect.objectContaining({
        kind: 'INPUT_EXPIRED',
        inputId: 'stale-1',
      }),
    )

    const submitByToolUseId = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId: 't-1',
        turnId: 'turn-stale',
        toolUseId: 'ask-1',
        answers: { Choice: 'A' },
      }),
    )
    expect((submitByToolUseId[0] as any).error.code).toBe(JSON_RPC_ERRORS.INVALID_PARAMS)
    expect((submitByToolUseId[0] as any).error.message).toBe('INPUT_EXPIRED')
    expect((submitByToolUseId[0] as any).error.data).toEqual(
      expect.objectContaining({
        kind: 'INPUT_EXPIRED',
        inputId: 'stale-1',
      }),
    )
  })

  it('supports ask_user_question request -> submit -> completed integration flow', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [{ label: 'A', description: 'Option A' }],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              const answers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
              args.onEvent({ type: 'assistant_delta', text: String(answers.Choice ?? '') })
              args.onEvent({ type: 'complete' })
              return [
                ...args.history,
                args.user,
                { role: 'assistant', content: [{ type: 'text', text: String(answers.Choice ?? '') }] },
              ] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          promptProfile: 'lite',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    const submit = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId,
        turnId,
        inputId,
        answers: { Choice: 'A' },
        submissionId: 'submission-1',
      }),
    )
    expect((submit[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputResolved' && (n.params as any)?.input?.status === 'submitted',
    )
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
  })

  it('supports approval then ask_user_question in one turn integration flow', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              args.onEvent({
                type: 'approval_request',
                toolUseId: 'approval-1',
                toolName: 'Bash',
                action: { kind: 'bash.exec', command: 'echo hello' },
                effectiveDecision: { decision: 'ask' },
              })
              const approvalAnswers = await userInput.requestAnswers({
                toolUseId: 'approval-1',
                questions: [],
                signal: args.signal,
              })

              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [{ label: 'A', description: 'Option A' }],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              const askAnswers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })

              args.onEvent({
                type: 'assistant_delta',
                text: `approval=${String(approvalAnswers.decision ?? 'none')} choice=${String(askAnswers.Choice ?? '')}`,
              })
              args.onEvent({ type: 'complete' })
              return [
                ...args.history,
                args.user,
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'text',
                      text: `approval=${String(approvalAnswers.decision ?? 'none')} choice=${String(askAnswers.Choice ?? '')}`,
                    },
                  ],
                },
              ] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          promptProfile: 'lite',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const approvalRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.toolUseId === 'approval-1',
    )
    const approvalInputId = (approvalRequested.params as any).input.inputId as string
    const submitApproval = await server.handleMessage(
      request(4, 'turn/input/submit', {
        threadId,
        turnId,
        inputId: approvalInputId,
        answers: { decision: 'approve' },
        submissionId: 'submission-approval-1',
      }),
    )
    expect((submitApproval[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'submitted' &&
        (n.params as any)?.input?.toolUseId === 'approval-1',
    )

    const askRequested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.toolUseId === 'ask-1',
    )
    const askInputId = (askRequested.params as any).input.inputId as string
    const submitAsk = await server.handleMessage(
      request(5, 'turn/input/submit', {
        threadId,
        turnId,
        inputId: askInputId,
        answers: { Choice: 'A' },
        submissionId: 'submission-ask-1',
      }),
    )
    expect((submitAsk[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

    await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'submitted' &&
        (n.params as any)?.input?.toolUseId === 'ask-1',
    )
    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
  })

  it('coalesces duplicate/conflicting submissions for the same inputId', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })
    let releaseEngineAfterSubmissions: (() => void) | null = null
    const waitForSubmissionBurst = new Promise<void>((resolve) => {
      releaseEngineAfterSubmissions = resolve
    })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [
                    { label: 'A', description: 'Option A' },
                    { label: 'B', description: 'Option B' },
                  ],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              const answers = await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
              await waitForSubmissionBurst
              args.onEvent({ type: 'assistant_delta', text: String(answers.Choice ?? '') })
              args.onEvent({ type: 'complete' })
              return [
                ...args.history,
                args.user,
                { role: 'assistant', content: [{ type: 'text', text: String(answers.Choice ?? '') }] },
              ] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          promptProfile: 'lite',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    try {
      const submit1 = await server.handleMessage(
        request(4, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'A' },
          submissionId: 'submission-1',
        }),
      )
      expect((submit1[0] as any).result).toEqual({ accepted: true, status: 'accepted' })

      const submitSame = await server.handleMessage(
        request(5, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'A' },
          submissionId: 'submission-1',
        }),
      )
      expect((submitSame[0] as any).result).toEqual({ accepted: true, status: 'already_submitted_same' })

      const submitConflict = await server.handleMessage(
        request(6, 'turn/input/submit', {
          threadId,
          turnId,
          inputId,
          answers: { Choice: 'B' },
          submissionId: 'submission-2',
        }),
      )
      expect((submitConflict[0] as any).result).toEqual({ accepted: false, status: 'conflict_already_submitted' })
    } finally {
      releaseEngineAfterSubmissions?.()
    }

    await waitForNotification(
      notifications,
      (n) => n.method === 'turn/completed' && (n.params as any)?.turn?.id === turnId,
    )
    const resolvedSubmittedCount = notifications.filter(
      (n) => n.method === 'turn/inputResolved' && (n.params as any)?.input?.status === 'submitted',
    ).length
    expect(resolvedSubmittedCount).toBe(1)
  })

  it('interrupt resolves pending input before turn end', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-app-server-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }
    const notifications: Array<{ jsonrpc: '2.0'; method: string; params?: unknown }> = []
    const userInput = createUserInputManager()
    const threadStore = new ThreadStore({ cwd, env })

    let runner: TurnRunner | null = null
    let server: AppServer
    server = new AppServer({
      info: { name: 'formax', version: 'test' },
      threadStore,
      resolveTurnRunner: async () => {
        if (runner) return runner
        runner = new TurnRunner({
          engine: {
            async runTurn(args) {
              const questions = [
                {
                  question: 'Pick one?',
                  header: 'Choice',
                  options: [{ label: 'A', description: 'Option A' }],
                  multiSelect: false,
                },
              ]
              args.onEvent({ type: 'ask_user_question', toolUseId: 'ask-1', questions })
              await userInput.requestAnswers({ toolUseId: 'ask-1', questions, signal: args.signal })
              return [...args.history, args.user] as ChatHistory
            },
          },
          tools: [],
          allowedSubagents: [],
          model: 'test-model',
          promptProfile: 'lite',
          cwd,
          env,
          userInputManager: userInput,
          emitNotification: server.createTurnNotificationEmitter(),
        })
        return runner
      },
      emitNotification(message) {
        notifications.push(message)
      },
    })

    await server.handleMessage(request(1, 'initialize'))
    const threadStart = await server.handleMessage(request(2, 'thread/start'))
    const threadId = (threadStart[0] as any).result.thread.id as string
    const turnStart = await server.handleMessage(
      request(3, 'turn/start', {
        threadId,
        input: { text: 'hello' },
      }),
    )
    const turnId = (turnStart[0] as any).result.turn.id as string

    const requested = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/inputRequested' && (n.params as any)?.input?.kind === 'ask_user_question',
    )
    const inputId = (requested.params as any).input.inputId as string

    const interrupted = await server.handleMessage(
      request(4, 'turn/interrupt', {
        threadId,
        turnId,
      }),
    )
    expect((interrupted[0] as any).result).toEqual({})

    const resolved = await waitForNotification(
      notifications,
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'canceled' &&
        (n.params as any)?.input?.inputId === inputId,
    )
    expect((resolved.params as any)?.input?.reason).toBe('turn_interrupted')

    const failed = await waitForNotification(
      notifications,
      (n) => n.method === 'turn/failed' && (n.params as any)?.turn?.id === turnId,
    )
    expect((failed.params as any)?.turn?.status).toBe('interrupted')

    const resolvedIndex = notifications.findIndex(
      (n) =>
        n.method === 'turn/inputResolved' &&
        (n.params as any)?.input?.status === 'canceled' &&
        (n.params as any)?.input?.inputId === inputId,
    )
    const failedIndex = notifications.findIndex(
      (n) => n.method === 'turn/failed' && (n.params as any)?.turn?.id === turnId,
    )
    expect(resolvedIndex).toBeGreaterThanOrEqual(0)
    expect(failedIndex).toBeGreaterThan(resolvedIndex)
  })
})
