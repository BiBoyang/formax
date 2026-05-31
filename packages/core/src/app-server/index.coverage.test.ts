import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    transport: {
      lines: [] as string[],
      sent: [] as unknown[],
      send: async (message: unknown) => {
        state.transport.sent.push(message)
      },
    },
    appServerOptions: null as any,
    handleMessage: (async () => []) as (message: unknown, options: any) => Promise<unknown[]>,
    createRuntimeSpy: vi.fn(async (_args?: unknown) => ({
      engine: {},
      tools: [],
      allowedSubagents: [],
      cfg: {
        llm: {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          thinkingMode: true,
          contextWindowTokens: null,
        },
        context: {
          effectiveContextWindowPercent: 0.9,
          autoCompactTokenLimitPercent: 0.7,
          baselineTokens: 0,
          compactKeepLastTurns: 4,
          enableAutoCompact: true,
        },
        ui: {},
      },
      runtimeFlags: {},
      userInputManager: {},
    })),
    turnRunnerCtorArgs: [] as any[],
    turnRunnerInstances: [] as any[],
    sessionFilePath: null as string | null,
    sessionReplay: null as any,
    restoreContext: { mode: 'normal' as 'normal' | 'acceptEdits' | 'plan', planPath: null as string | null },
    turnRunnerPlanPath: null as string | null,
    turnRunnerAdoptCalls: [] as Array<{ threadId: string; planPath: string | null }>,
  },
}))

vi.mock('./transport/stdio.js', () => {
  class StdioPayloadTooLargeError extends Error {
    readonly maxBytes: number
    readonly actualBytes: number
    readonly direction: 'request' | 'event'

    constructor(args: { direction: 'request' | 'event'; maxBytes: number; actualBytes: number }) {
      super('PAYLOAD_TOO_LARGE')
      this.maxBytes = args.maxBytes
      this.actualBytes = args.actualBytes
      this.direction = args.direction
    }
  }

  return {
    createStdioJsonlTransport: () => ({
      send: (message: unknown) => state.transport.send(message),
      listen: async (onLine: (line: string) => Promise<void>) => {
        for (const line of state.transport.lines) {
          await onLine(line)
        }
      },
    }),
    StdioPayloadTooLargeError,
  }
})

vi.mock('./server.js', () => ({
  AppServer: class {
    options: any

    constructor(options: any) {
      this.options = options
      state.appServerOptions = options
    }

    createTurnNotificationEmitter() {
      return () => {}
    }

    async handleMessage(message: unknown) {
      return state.handleMessage(message, this.options)
    }
  },
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime: (args: unknown) => state.createRuntimeSpy(args),
}))

vi.mock('../features/repl/sessionSave/index.js', () => ({
  findSessionFileBySessionId: async () => state.sessionFilePath,
  readSessionFile: async () =>
    state.sessionReplay ?? {
      meta: {
        type: 'session_meta',
        v: 1,
        ts: '2026-05-20T00:00:00.000Z',
        sessionId: 'thread-1',
        startedAt: '2026-05-20T00:00:00.000Z',
        cwd: '/tmp/repo',
        provider: 'anthropic',
      },
      messages: [],
      history: [],
      parseErrors: 0,
    },
}))

vi.mock('../features/repl/sessionRestore/sessionMemory.js', () => ({
  persistSessionMemoryFromHistory: async () => {},
  resolveSessionMemoryRestoreContext: async () => state.restoreContext,
  resolveSessionMemoryRestoreArtifacts: async (args: { fallbackMode: 'normal' | 'acceptEdits' | 'plan'; fallbackPlanPath: string | null }) => ({
    mode: args.fallbackMode,
    planPath: args.fallbackPlanPath,
    nextTurnInjectedBlocks: [],
    pendingSessionMemoryRestore: null,
  }),
  waitForSessionMemoryWriteFlush: async () => {},
}))

vi.mock('../features/repl/sessionSave/requestCollapseEvents.js', () => ({
  readLatestRequestCollapseEventFromSession: async () => null,
}))

vi.mock('../features/repl/sessionSave/reactiveCompactEvents.js', () => ({
  readLatestReactiveCompactEventFromSession: async () => null,
}))

vi.mock('./turnRunner.js', () => ({
  DEFAULT_INPUT_TTL_MS: 60_000,
  DEFAULT_MAX_PENDING_INPUTS_PER_THREAD: 5,
  TurnRunner: class {
    private readonly planPaths = new Map<string, string | null>()

    constructor(args: unknown) {
      state.turnRunnerCtorArgs.push(args)
      state.turnRunnerInstances.push(this)
    }

    async startTurn() {
      return { turn: { id: 'turn-1' } }
    }

    async interruptTurn() {
      return { ok: true }
    }

    async submitInput() {
      return { ok: true }
    }

    getPlanPath(threadId: string) {
      return this.planPaths.get(threadId) ?? state.turnRunnerPlanPath
    }

    adoptPlanPath(threadId: string, planPath: string | null) {
      this.planPaths.set(threadId, planPath)
      state.turnRunnerPlanPath = planPath
      state.turnRunnerAdoptCalls.push({ threadId, planPath })
    }
  },
}))

import { runAppServer } from './index.js'
import { JSON_RPC_ERRORS } from './jsonrpc.js'
import { StdioPayloadTooLargeError } from './transport/stdio.js'

describe('runAppServer (coverage branches)', () => {
  beforeEach(() => {
    state.transport.lines = []
    state.transport.sent = []
    state.transport.send = async (message: unknown) => {
      state.transport.sent.push(message)
    }
    state.appServerOptions = null
    state.handleMessage = async () => []
    state.createRuntimeSpy.mockClear()
    state.turnRunnerCtorArgs = []
    state.turnRunnerInstances = []
    state.sessionFilePath = null
    state.sessionReplay = null
    state.restoreContext = { mode: 'normal', planPath: null }
    state.turnRunnerPlanPath = null
    state.turnRunnerAdoptCalls = []
  })

  it('rethrows non-payload transport errors from safeSend', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0",']
    state.transport.send = async () => {
      throw new Error('send failed')
    }

    await expect(runAppServer({ cwd: '/tmp/repo', env: {} })).rejects.toThrow('send failed')
  })

  it('uses process defaults when args are omitted', async () => {
    state.transport.lines = []
    await runAppServer()
    expect(state.appServerOptions).not.toBeNull()
  })

  it('keeps /context text and json diagnostics aligned with compact boundary and plan path', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}']
    state.sessionFilePath = '/tmp/thread-1.jsonl'
    state.restoreContext = { mode: 'plan', planPath: '/repo/.formax/plan.md' }
    state.sessionReplay = {
      meta: {
        type: 'session_meta',
        v: 1,
        ts: '2026-05-20T00:00:00.000Z',
        sessionId: 'thread-1',
        startedAt: '2026-05-20T00:00:00.000Z',
        cwd: '/repo',
        provider: 'anthropic',
      },
      messages: [],
      history: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          meta: {
            compactBoundary: {
              schemaVersion: 1,
              trigger: 'manual',
              preTokens: 2048,
              summaryKind: 'session_memory',
            },
          },
        },
        { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      ],
      parseErrors: 0,
    }
    let effects: any[] = []
    state.handleMessage = async (_message, options) => {
      effects = [
        await options.resolveContextDiagnostics({
          threadId: 'thread-1',
          cwd: '/repo',
          mode: 'normal',
          modeExplicit: false,
          includeExitPlanReminder: false,
          nextTurnInjectedBlocks: [],
          format: 'text',
        }),
        await options.resolveContextDiagnostics({
          threadId: 'thread-1',
          cwd: '/repo',
          mode: 'normal',
          modeExplicit: false,
          includeExitPlanReminder: false,
          nextTurnInjectedBlocks: [],
          format: 'json',
        }),
        await options.resolveContextDiagnostics({
          threadId: 'thread-1',
          cwd: '/repo',
          mode: 'normal',
          modeExplicit: true,
          includeExitPlanReminder: false,
          nextTurnInjectedBlocks: [],
          format: 'json',
        }),
      ]
      await options.resolveTurnRunner()
      state.sessionFilePath = null
      state.turnRunnerPlanPath = '/repo/live-plan.md'
      effects.push(
        await options.resolveContextDiagnostics({
          threadId: 'thread-1',
          cwd: '/repo',
          mode: 'normal',
          modeExplicit: true,
          includeExitPlanReminder: false,
          nextTurnInjectedBlocks: [],
          format: 'json',
        }),
      )
      return []
    }

    await runAppServer({ cwd: '/repo', env: {} })

    expect(effects[0].stdout).toContain('- Trigger: manual')
    expect(effects[0].stdout).toContain('- Mode: plan')
    expect(effects[0].diagnostics.latestCompactBoundary).toMatchObject({
      schemaVersion: 1,
      trigger: 'manual',
      preTokens: 2048,
      summaryKind: 'session_memory',
    })
    const parsedJson = JSON.parse(effects[1].stdout)
    expect(parsedJson.mode).toBe('plan')
    expect(parsedJson.latestCompactBoundary).toMatchObject({
      schemaVersion: 1,
      trigger: 'manual',
      preTokens: 2048,
      summaryKind: 'session_memory',
    })
    expect(parsedJson.nextTurnFixed.workingSetSignals).toMatchObject({
      modeState: 'plan',
      hasPlanState: true,
    })
    const explicitNormalJson = JSON.parse(effects[2].stdout)
    expect(explicitNormalJson.mode).toBe('normal')
    expect(explicitNormalJson.nextTurnFixed.workingSetSignals).toMatchObject({
      modeState: 'normal',
      hasPlanState: true,
    })
    const livePlanJson = JSON.parse(effects[3].stdout)
    expect(livePlanJson.mode).toBe('normal')
    expect(livePlanJson.nextTurnFixed.workingSetSignals).toMatchObject({
      modeState: 'normal',
      hasPlanState: true,
    })
  })

  it('builds lazy turn runner, forwards limits, and emits notifications', async () => {
    state.transport.lines = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}',
      '{"jsonrpc":"2.0","id":2,"method":"turn/start","params":{"threadId":"thread-1","input":"hello"}}',
    ]
    state.transport.send = async (message: unknown) => {
      if ((message as any)?.method === 'turn/started') throw new Error('notification send failed')
      state.transport.sent.push(message)
    }
    state.handleMessage = async (message, options) => {
      const m = message as any
      if (m.kind !== 'request') return []
      if (m.request?.method === 'initialize') {
        options.emitNotification({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: 'thread-1' } })
        return [{ jsonrpc: '2.0', id: m.request.id, result: { ok: true } }]
      }
      if (m.request?.method === 'turn/start') {
        await options.resolveTurnRunner()
        await options.resolveTurnRunner()
        return [{ jsonrpc: '2.0', id: m.request.id, result: { turn: { id: 'turn-1' } } }]
      }
      return []
    }

    const ensureThreadFile = vi.fn(async ({ threadId }: { threadId: string; cwd: string }) => `/tmp/${threadId}.json`)
    const threadStore = {
      startThread: async () => ({
        id: 'thread-1',
        cwd: '/tmp/repo',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
      resumeThread: async () => ({
        thread: {
          id: 'thread-1',
          cwd: '/tmp/repo',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        staleInputs: [],
      }),
      listThreads: async () => ({ data: [], nextCursor: null }),
      readThread: async () => ({
        thread: {
          id: 'thread-1',
          cwd: '/tmp/repo',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        transcriptPreview: [],
      }),
      listThreadMessages: async () => ({ data: [], nextCursor: null }),
      ensureThreadFile,
    }

    await runAppServer({
      cwd: '/tmp/repo',
      env: {},
      threadStore,
      maxRequestBytes: 200.9,
      maxEventBytes: 200.4,
      maxPendingInputsPerThread: 0,
      defaultInputTtlMs: -4,
    })

    expect(state.createRuntimeSpy).toHaveBeenCalledTimes(1)
    expect(state.turnRunnerCtorArgs).toHaveLength(1)
    const ensureThreadFilePath = state.turnRunnerCtorArgs[0]?.ensureThreadFilePath as
      | ((args: { threadId: string; cwd: string }) => Promise<string>)
      | undefined
    expect(typeof ensureThreadFilePath).toBe('function')
    const ensuredPath = await ensureThreadFilePath!({ threadId: 'thread-1', cwd: '/tmp/repo' })
    expect(ensuredPath).toBe('/tmp/thread-1.json')
    expect(ensureThreadFile).toHaveBeenCalledTimes(1)
    expect(state.appServerOptions?.limits).toMatchObject({
      maxRequestBytes: 200,
      maxEventBytes: 200,
      maxPendingInputsPerThread: 5,
      defaultInputTtlMs: 60_000,
      maxInFlightTurnsPerThread: 1,
    })
    expect(state.transport.sent.length).toBeGreaterThanOrEqual(2)
  })

  it('preserves a thread plan path when runtime profile changes and a new runner is bound', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}']
    const env = {
      ...process.env,
      FORMAX_API_KEY: 'sk-test',
      FORMAX_BASE_URL: 'https://api.example-a.test/v1',
    }
    let migratedPlanPath: string | null = null
    state.handleMessage = async (_message, options) => {
      const firstRunner = await options.resolveTurnRunner({ threadId: 'thread-1', cwd: '/tmp/repo' })
      state.turnRunnerInstances[0]?.adoptPlanPath('thread-1', '/tmp/repo/live-plan.md')
      state.turnRunnerAdoptCalls = []
      env.FORMAX_BASE_URL = 'https://api.example-b.test/v1'
      const secondRunner = await options.resolveTurnRunner({ threadId: 'thread-1', cwd: '/tmp/repo' })
      migratedPlanPath = secondRunner.getPlanPath?.('thread-1') ?? null
      expect(firstRunner).not.toBe(secondRunner)
      return []
    }

    await runAppServer({ cwd: '/tmp/repo', env })

    expect(state.turnRunnerCtorArgs).toHaveLength(2)
    expect(state.turnRunnerAdoptCalls).toEqual([{ threadId: 'thread-1', planPath: '/tmp/repo/live-plan.md' }])
    expect(migratedPlanPath).toBe('/tmp/repo/live-plan.md')
  })

  it('invalidates cached runners when non-profile runtime config changes', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}']
    const env = {
      ...process.env,
      FORMAX_API_KEY: 'sk-test',
      FORMAX_SUBAGENTS_DIR: '/tmp/agents-a',
    }
    state.handleMessage = async (_message, options) => {
      const firstRunner = await options.resolveTurnRunner({ cwd: '/tmp/repo' })
      env.FORMAX_SUBAGENTS_DIR = '/tmp/agents-b'
      const secondRunner = await options.resolveTurnRunner({ cwd: '/tmp/repo' })
      expect(firstRunner).not.toBe(secondRunner)
      return []
    }

    await runAppServer({ cwd: '/tmp/repo', env })

    expect(state.turnRunnerCtorArgs).toHaveLength(2)
    expect(state.createRuntimeSpy).toHaveBeenCalledTimes(2)
  })

  it('converts oversized outbound events into PAYLOAD_TOO_LARGE response events', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":9,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}']
    let sendCount = 0
    state.transport.send = async (message: unknown) => {
      sendCount += 1
      if (sendCount === 1) {
        throw new StdioPayloadTooLargeError({ direction: 'event', maxBytes: 64, actualBytes: 128 })
      }
      state.transport.sent.push(message)
    }
    state.handleMessage = async (message) => {
      const m = message as any
      if (m.kind !== 'request') return []
      return [{ jsonrpc: '2.0', id: m.request?.id ?? null, result: { huge: 'x'.repeat(200) } }]
    }

    await runAppServer({ cwd: '/tmp/repo', env: {} })

    expect(state.transport.sent).toHaveLength(1)
    const out = state.transport.sent[0] as any
    expect(out?.error?.code).toBe(JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE)
    expect(out?.error?.message).toBe('PAYLOAD_TOO_LARGE')
    expect(out?.error?.data?.direction).toBe('event')
  })

  it('handles missing ensureThreadFile and payload-too-large responses without ids', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":7,"method":"turn/start","params":{"threadId":"thread-1","input":"hi"}}']
    let sendCount = 0
    state.transport.send = async (message: unknown) => {
      sendCount += 1
      if (sendCount === 1) {
        throw new StdioPayloadTooLargeError({ direction: 'event', maxBytes: 32, actualBytes: 96 })
      }
      state.transport.sent.push(message)
    }
    state.handleMessage = async (message, options) => {
      const m = message as any
      if (m.kind === 'request' && m.request?.method === 'turn/start') {
        await options.resolveTurnRunner()
      }
      return [{ jsonrpc: '2.0', result: { ok: true } }]
    }

    const threadStore = {
      startThread: async () => ({
        id: 'thread-1',
        cwd: '/tmp/repo',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
      resumeThread: async () => ({
        thread: {
          id: 'thread-1',
          cwd: '/tmp/repo',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        staleInputs: [],
      }),
      listThreads: async () => ({ data: [], nextCursor: null }),
      readThread: async () => ({
        thread: {
          id: 'thread-1',
          cwd: '/tmp/repo',
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        transcriptPreview: [],
      }),
      listThreadMessages: async () => ({ data: [], nextCursor: null }),
    }

    await runAppServer({ cwd: '/tmp/repo', env: {}, threadStore })

    const ctorArgs = state.turnRunnerCtorArgs[0] as any
    expect(ctorArgs.ensureThreadFilePath).toBeUndefined()
    const out = state.transport.sent[0] as any
    expect(out?.id).toBeNull()
    expect(out?.error?.code).toBe(JSON_RPC_ERRORS.PAYLOAD_TOO_LARGE)
  })

  it('rethrows non-payload transport errors while streaming responses', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":3,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}']
    state.transport.send = async () => {
      throw new Error('event send failed')
    }
    state.handleMessage = async (message) => {
      const m = message as any
      if (m.kind !== 'request') return []
      return [{ jsonrpc: '2.0', id: m.request?.id ?? null, result: { ok: true } }]
    }

    await expect(runAppServer({ cwd: '/tmp/repo', env: {} })).rejects.toThrow('event send failed')
  })

  it('returns overloaded errors when request ingress queue is saturated', async () => {
    const totalRequests = 18
    state.transport.lines = Array.from({ length: totalRequests }, (_, index) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'initialize',
        params: { clientInfo: { name: `web-${index + 1}`, version: '1.0.0' } },
      }),
    )

    let releaseFirst: (() => void) | null = null
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let handled = 0
    state.handleMessage = async (message) => {
      handled += 1
      if (handled === 1) {
        await firstRequestGate
      }
      const req = (message as any)?.request
      return [{ jsonrpc: '2.0', id: req?.id ?? null, result: { ok: true } }]
    }
    setTimeout(() => {
      releaseFirst?.()
    }, 20)

    await runAppServer({
      cwd: '/tmp/repo',
      env: {},
      ingressQueueCapacity: 1,
      outboundQueueCapacity: 64,
    })

    const overloads = state.transport.sent.filter(
      (message: any) =>
        message?.error?.code === JSON_RPC_ERRORS.OVERLOADED && message?.error?.message === 'Server overloaded; retry later.',
    )
    expect(overloads.length).toBeGreaterThan(0)
    expect(overloads.length).toBeLessThan(totalRequests)
  })

  it('waits for queue space instead of overloading notifications when ingress queue is saturated', async () => {
    state.transport.lines = [
      '{"jsonrpc":"2.0","method":"initialized"}',
      '{"jsonrpc":"2.0","method":"initialized"}',
      '{"jsonrpc":"2.0","method":"initialized"}',
    ]

    let releaseFirst: (() => void) | null = null
    const firstNotificationGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let handledNotifications = 0
    state.handleMessage = async (message) => {
      if ((message as any)?.kind === 'notification') {
        handledNotifications += 1
      }
      if (handledNotifications === 1) {
        await firstNotificationGate
      }
      return []
    }
    setTimeout(() => {
      releaseFirst?.()
    }, 20)

    await runAppServer({
      cwd: '/tmp/repo',
      env: {},
      ingressQueueCapacity: 1,
      outboundQueueCapacity: 8,
    })

    expect(handledNotifications).toBe(3)
    const overloads = state.transport.sent.filter((message: any) => message?.error?.code === JSON_RPC_ERRORS.OVERLOADED)
    expect(overloads).toEqual([])
  })

  it('aborts processing promptly when outbound writer fails under ingress pressure', async () => {
    state.transport.lines = Array.from({ length: 30 }, (_, index) =>
      JSON.stringify({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'initialize',
        params: { clientInfo: { name: `web-${index + 1}`, version: '1.0.0' } },
      }),
    )
    state.transport.send = async () => {
      throw new Error('writer down')
    }
    state.handleMessage = async (message) => {
      const req = (message as any)?.request
      return [{ jsonrpc: '2.0', id: req?.id ?? null, result: { ok: true } }]
    }

    await expect(
      runAppServer({
        cwd: '/tmp/repo',
        env: {},
        ingressQueueCapacity: 1,
        outboundQueueCapacity: 1,
      }),
    ).rejects.toThrow('writer down')
  })

  it('does not emit PAYLOAD_TOO_LARGE response when dropped notification exceeds outbound limits', async () => {
    state.transport.lines = ['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"web","version":"1.0.0"}}}']
    state.transport.send = async (message: unknown) => {
      if ((message as any)?.method === 'turn/started') {
        throw new StdioPayloadTooLargeError({ direction: 'event', maxBytes: 64, actualBytes: 256 })
      }
      state.transport.sent.push(message)
    }
    state.handleMessage = async (_message, options) => {
      options.emitNotification({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId: 'thread-1' },
      })
      return []
    }

    await runAppServer({ cwd: '/tmp/repo', env: {} })

    expect(state.transport.sent).toEqual([])
  })

  it('keeps invalid envelopes mapped to INVALID_REQUEST under ingress saturation', async () => {
    state.transport.lines = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"web-1","version":"1.0.0"}}}',
      '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"clientInfo":{"name":"web-2","version":"1.0.0"}}}',
      '{"jsonrpc":"2.0","id":99,"method":""}',
    ]

    let releaseFirst: (() => void) | null = null
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let handledRequests = 0
    state.handleMessage = async (message) => {
      if ((message as any)?.kind === 'request') {
        handledRequests += 1
      }
      if (handledRequests === 1) {
        await firstRequestGate
      }
      const req = (message as any)?.request
      return req ? [{ jsonrpc: '2.0', id: req.id, result: { ok: true } }] : []
    }
    setTimeout(() => {
      releaseFirst?.()
    }, 20)

    await runAppServer({
      cwd: '/tmp/repo',
      env: {},
      ingressQueueCapacity: 1,
      outboundQueueCapacity: 16,
    })

    const invalidOut = state.transport.sent.find((row: any) => row?.id === 99) as any
    expect(invalidOut?.error?.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST)
    expect(String(invalidOut?.error?.message || '')).toContain('method must be a non-empty string')
    expect(invalidOut?.error?.code).not.toBe(JSON_RPC_ERRORS.OVERLOADED)
  })
})
