import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const mcpServerManagerInstances: any[] = []
  return {
    createRuntimeFlags: vi.fn(),
    createChatRuntime: vi.fn(),
    createLlmClients: vi.fn(),
    createPolicyAndHooksRuntime: vi.fn(),
    createRuntimeConfigContext: vi.fn(),
    createSubagentRuntime: vi.fn(),
    createToolingRuntime: vi.fn(),
    createSdkMcpClientFactory: vi.fn(() => ({ kind: 'sdk-client-factory' })),
    mcpActivateImpl: vi.fn(async (_signal?: AbortSignal) => ({ bindings: [], diagnostics: [] })),
    mcpServerManagerInstances,
    McpServerManager: class {
      options: any
      activate = vi.fn((signal?: AbortSignal) => mocks.mcpActivateImpl(signal))
      dispose = vi.fn(async () => {})

      constructor(options: any) {
        this.options = options
        mcpServerManagerInstances.push(this)
      }
    },
  }
})

vi.mock('../config/runtimeFlags.js', () => ({
  createRuntimeFlags: mocks.createRuntimeFlags,
}))
vi.mock('./bootstrap/chatRuntime.js', () => ({
  createChatRuntime: mocks.createChatRuntime,
}))
vi.mock('./bootstrap/llmClients.js', () => ({
  createLlmClients: mocks.createLlmClients,
}))
vi.mock('./bootstrap/policyHooks.js', () => ({
  createPolicyAndHooksRuntime: mocks.createPolicyAndHooksRuntime,
}))
vi.mock('./bootstrap/runtimeConfig.js', () => ({
  createRuntimeConfigContext: mocks.createRuntimeConfigContext,
}))
vi.mock('./bootstrap/subagents.js', () => ({
  createSubagentRuntime: mocks.createSubagentRuntime,
}))
vi.mock('./bootstrap/tooling.js', () => ({
  createToolingRuntime: mocks.createToolingRuntime,
}))
vi.mock('../mcp/sdkClient.js', () => ({
  createSdkMcpClientFactory: mocks.createSdkMcpClientFactory,
}))
vi.mock('../mcp/serverManager.js', () => ({
  McpServerManager: mocks.McpServerManager,
}))

import { createRuntime } from './createRuntime.js'

describe('createRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mcpActivateImpl.mockResolvedValue({ bindings: [], diagnostics: [] })
    mocks.mcpServerManagerInstances.length = 0
  })

  it('builds the runtime graph and uses explicit runtime flags when provided', async () => {
    const bootstrap = {
      cwd: '/repo',
      env: { NODE_ENV: 'test' },
      cfg: {
        paths: { logsDir: '/repo/logs' },
        mcp: { servers: { github: { type: 'stdio', command: 'github-mcp', enabled: true } } },
      },
      fileStore: { kind: 'store' },
    }
    const llm = {
      client: { name: 'main-client' },
      webFetchClient: { name: 'webfetch-client' },
      model: 'gpt-4o-mini',
    }
    const tooling = {
      toolRegistry: { getHandlers: vi.fn(), listSpecs: vi.fn(async () => [{ name: 'Read' }, { name: 'mcp__github__create_issue' }]) },
      taskManager: { kind: 'task-manager' },
      userInputManager: { kind: 'user-input' },
      mcpServerManager: { kind: 'mcp-manager' },
    }
    const policyHooks = {
      audit: { kind: 'audit' },
      hooks: { kind: 'hooks' },
      preflight: vi.fn(),
      createExecutor: vi.fn(() => ({ kind: 'local-executor' })),
    }
    const subagent = {
      allowedSubagents: [],
      reloadSubagents: vi.fn(async () => []),
      refreshTools: vi.fn(async () => {}),
      tools: [{ name: 'Read' }],
    }
    const chatRuntime = {
      executor: { kind: 'executor' },
      engine: { kind: 'engine' },
    }

    mocks.createRuntimeConfigContext.mockResolvedValue(bootstrap)
    mocks.createLlmClients.mockReturnValue(llm)
    mocks.createToolingRuntime.mockReturnValue(tooling)
    mocks.createPolicyAndHooksRuntime.mockReturnValue(policyHooks)
    mocks.createSubagentRuntime.mockResolvedValue(subagent)
    mocks.createChatRuntime.mockReturnValue(chatRuntime)

    const explicitFlags = { traceTools: true } as any

    const out = await createRuntime({
      cwd: '/repo',
      env: { NODE_ENV: 'test' },
      forceSetup: true,
      onBeforeConfigLoad: vi.fn(),
      onAfterSetupCompleted: vi.fn(),
      runtimeFlags: explicitFlags,
    })

    expect(mocks.createRuntimeConfigContext).toHaveBeenCalledWith({
      cwd: '/repo',
      env: { NODE_ENV: 'test' },
      forceSetup: true,
      loadMcpConfig: true,
      onBeforeConfigLoad: expect.any(Function),
      onAfterSetupCompleted: expect.any(Function),
    })
    expect(mocks.createLlmClients).toHaveBeenCalledWith({ cfg: bootstrap.cfg, env: bootstrap.env })
    expect(mocks.createSdkMcpClientFactory).toHaveBeenCalledWith({ cwd: bootstrap.cwd, env: bootstrap.env })
    expect(mocks.mcpServerManagerInstances[0].options.config).toEqual(bootstrap.cfg.mcp)
    expect(mocks.mcpServerManagerInstances[0].options.blobWriter).toEqual({
      writeBlob: expect.any(Function),
    })
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledTimes(1)
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(
      mocks.mcpServerManagerInstances[0].activate.mock.invocationCallOrder[0],
    ).toBeGreaterThan(mocks.createSubagentRuntime.mock.invocationCallOrder[0])
    expect(mocks.createToolingRuntime).toHaveBeenCalledWith({
      cwd: bootstrap.cwd,
      env: bootstrap.env,
      webFetchClient: llm.webFetchClient,
      mcpServerManager: mocks.mcpServerManagerInstances[0],
    })
    expect(mocks.createPolicyAndHooksRuntime).toHaveBeenCalledWith({
      cfgPathsLogsDir: '/repo/logs',
      fileStore: bootstrap.fileStore,
      userInputManager: tooling.userInputManager,
      toolRegistry: tooling.toolRegistry,
      mcpServerManager: tooling.mcpServerManager,
      env: bootstrap.env,
    })
    expect(mocks.createSubagentRuntime).toHaveBeenCalledWith({
      cfg: bootstrap.cfg,
      env: bootstrap.env,
      cwd: bootstrap.cwd,
      client: llm.client,
      toolRegistry: tooling.toolRegistry,
      taskManager: tooling.taskManager,
      preflight: policyHooks.preflight,
      createLocalExecutor: policyHooks.createExecutor,
    })
    expect(mocks.createRuntimeFlags).not.toHaveBeenCalled()
    expect(mocks.createChatRuntime).toHaveBeenCalledWith({
      client: llm.client,
      toolRegistry: tooling.toolRegistry,
      preflight: policyHooks.preflight,
      hooks: policyHooks.hooks,
      audit: policyHooks.audit,
      runtimeFlags: explicitFlags,
    })
    expect(out.runtimeFlags).toBe(explicitFlags)
    expect(out.engine).toMatchObject(chatRuntime.engine)
    expect(out.tools).toEqual([{ name: 'Read' }])
    const activationSignal = mocks.mcpServerManagerInstances[0].activate.mock.calls[0][0] as AbortSignal
    expect(activationSignal.aborted).toBe(false)
    await Promise.resolve()
    expect(subagent.refreshTools).toHaveBeenCalledTimes(1)
    await out.dispose()
    expect(activationSignal.aborted).toBe(true)
    expect(mocks.mcpServerManagerInstances[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('creates runtime flags from environment when explicit flags are missing', async () => {
    const env = { FORMAX_DEBUG_TRACE_TOOLS: '1' }
    const bootstrap = {
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
      fileStore: {},
    }
    mocks.createRuntimeConfigContext.mockResolvedValue(bootstrap)
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: {},
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })

    const out = await createRuntime({
      cwd: '/repo',
      env,
    })

    expect(mocks.createRuntimeFlags).toHaveBeenCalledWith(env)
    expect(mocks.createChatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeFlags: { fromEnv: true },
      }),
    )
    expect(out.runtimeFlags).toEqual({ fromEnv: true })
  })

  it('does not await background MCP activation for the REPL entrypoint', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })
    mocks.mcpActivateImpl.mockImplementation((signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))

    const out = await createRuntime({ cwd: '/repo', env })

    expect(out.engine).toHaveProperty('prepareTurn')
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledWith(expect.any(AbortSignal))
    await out.dispose()
    expect(mocks.mcpServerManagerInstances[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('does not block dispose when background MCP activation ignores abort', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })
    mocks.mcpActivateImpl.mockImplementation(() => new Promise(() => {}))

    const out = await createRuntime({ cwd: '/repo', env })

    await expect(out.dispose()).resolves.toBeUndefined()
    expect(mocks.mcpServerManagerInstances[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('waits for background REPL MCP activation before preparing a turn', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    const runTurn = vi.fn(async () => ['done'])
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: { runTurn } })
    let resolveActivation!: () => void
    mocks.mcpActivateImpl.mockImplementation(() => new Promise<{ bindings: any[]; diagnostics: any[] }>((resolve) => {
      resolveActivation = () => resolve({ bindings: [], diagnostics: [] })
    }))

    const out = await createRuntime({ cwd: '/repo', env })
    const preparePromise = out.engine.prepareTurn?.()
    await Promise.resolve()

    expect(runTurn).not.toHaveBeenCalled()
    resolveActivation()
    await expect(preparePromise).resolves.toBeUndefined()
    await expect(out.engine.runTurn({} as any)).resolves.toEqual(['done'])
    expect(runTurn).toHaveBeenCalledTimes(1)
    await out.dispose()
  })

  it('does not block REPL turns indefinitely when background MCP activation stalls', async () => {
    vi.useFakeTimers()
    try {
      const env = { NODE_ENV: 'test' }
      mocks.createRuntimeConfigContext.mockResolvedValue({
        cwd: '/repo',
        env,
        cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
        fileStore: {},
      })
      mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
      mocks.createToolingRuntime.mockReturnValue({
        toolRegistry: {},
        taskManager: {},
        userInputManager: {},
        mcpServerManager: { kind: 'mcp-manager' },
      })
      mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
      mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
      mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
      const runTurn = vi.fn(async () => ['done'])
      mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: { runTurn } })
      mocks.mcpActivateImpl.mockImplementation((signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))

      const out = await createRuntime({ cwd: '/repo', env })
      const preparePromise = out.engine.prepareTurn?.()
      await Promise.resolve()

      expect(runTurn).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(preparePromise).resolves.toBeUndefined()
      expect(runTurn).not.toHaveBeenCalled()
      await expect(out.engine.runTurn({} as any)).resolves.toEqual(['done'])
      expect(runTurn).toHaveBeenCalledTimes(1)

      const secondPreparePromise = out.engine.prepareTurn?.()
      await Promise.resolve()
      expect(runTurn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(secondPreparePromise).resolves.toBeUndefined()
      await expect(out.engine.runTurn({} as any)).resolves.toEqual(['done'])
      expect(runTurn).toHaveBeenCalledTimes(2)
      await out.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses an empty MCP config for app-server entrypoint', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: {
        paths: { logsDir: '/repo/logs' },
        mcp: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })

    await createRuntime({
      cwd: '/repo',
      env,
      mcpRuntimeEntrypoint: 'app-server',
    })

    expect(mocks.createRuntimeConfigContext).toHaveBeenCalledWith(expect.objectContaining({
      loadMcpConfig: false,
    }))
    expect(mocks.mcpServerManagerInstances[0].options.config).toEqual({ servers: {} })
    expect(mocks.mcpServerManagerInstances[0].activate).not.toHaveBeenCalled()
  })

  it('uses an empty MCP config for SDK entrypoint without an explicit overlay', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: {
        paths: { logsDir: '/repo/logs' },
        mcp: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })

    await createRuntime({
      cwd: '/repo',
      env,
      mcpRuntimeEntrypoint: 'sdk',
    })

    expect(mocks.createRuntimeConfigContext).toHaveBeenCalledWith(expect.objectContaining({
      loadMcpConfig: false,
    }))
    expect(mocks.mcpServerManagerInstances[0].options.config).toEqual({ servers: {} })
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledTimes(1)
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledWith()
  })

  it('uses the explicit SDK MCP overlay instead of persisted config', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: {
        paths: { logsDir: '/repo/logs' },
        mcp: { servers: { local: { type: 'stdio', command: 'local-mcp', enabled: true } } },
      },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), refreshTools: vi.fn(), tools: [] })
    mocks.createRuntimeFlags.mockReturnValue({ fromEnv: true })
    mocks.createChatRuntime.mockReturnValue({ executor: {}, engine: {} })

    await createRuntime({
      cwd: '/repo',
      env,
      mcpRuntimeEntrypoint: 'sdk',
      mcpServersOverlay: {
        overlay: { type: 'stdio', command: 'overlay-mcp' },
      },
    })

    expect(mocks.mcpServerManagerInstances[0].options.config).toEqual({
      servers: {
        overlay: { type: 'stdio', command: 'overlay-mcp', enabled: true },
      },
    })
    expect(mocks.mcpServerManagerInstances[0].activate).toHaveBeenCalledTimes(1)
    expect(
      mocks.mcpServerManagerInstances[0].activate.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.createSubagentRuntime.mock.invocationCallOrder[0])
  })

  it('disposes the MCP manager if bootstrap fails after activation', async () => {
    const env = { NODE_ENV: 'test' }
    mocks.createRuntimeConfigContext.mockResolvedValue({
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' }, mcp: { servers: {} } },
      fileStore: {},
    })
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({
      toolRegistry: {},
      taskManager: {},
      userInputManager: {},
      mcpServerManager: { kind: 'mcp-manager' },
    })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockRejectedValue(new Error('subagent failed'))

    await expect(createRuntime({ cwd: '/repo', env })).rejects.toThrow('subagent failed')
    expect(mocks.mcpServerManagerInstances[0].dispose).toHaveBeenCalledTimes(1)
  })
})
