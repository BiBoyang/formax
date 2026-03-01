import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRuntimeFlags: vi.fn(),
  createChatRuntime: vi.fn(),
  createLlmClients: vi.fn(),
  createPolicyAndHooksRuntime: vi.fn(),
  createRuntimeConfigContext: vi.fn(),
  createSubagentRuntime: vi.fn(),
  createToolingRuntime: vi.fn(),
}))

vi.mock('../config/runtimeFlags.js', () => ({
  createRuntimeFlags: mocks.createRuntimeFlags,
}))
vi.mock('../legacy/bootstrap/chatRuntime.js', () => ({
  createChatRuntime: mocks.createChatRuntime,
}))
vi.mock('../legacy/bootstrap/llmClients.js', () => ({
  createLlmClients: mocks.createLlmClients,
}))
vi.mock('../legacy/bootstrap/policyHooks.js', () => ({
  createPolicyAndHooksRuntime: mocks.createPolicyAndHooksRuntime,
}))
vi.mock('../legacy/bootstrap/runtimeConfig.js', () => ({
  createRuntimeConfigContext: mocks.createRuntimeConfigContext,
}))
vi.mock('../legacy/bootstrap/subagents.js', () => ({
  createSubagentRuntime: mocks.createSubagentRuntime,
}))
vi.mock('../legacy/bootstrap/tooling.js', () => ({
  createToolingRuntime: mocks.createToolingRuntime,
}))

import { createRuntime } from './createRuntime.js'

describe('createRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the runtime graph and uses explicit runtime flags when provided', async () => {
    const bootstrap = {
      cwd: '/repo',
      env: { NODE_ENV: 'test' },
      cfg: {
        paths: { logsDir: '/repo/logs' },
      },
      fileStore: { kind: 'store' },
    }
    const llm = {
      client: { name: 'main-client' },
      webFetchClient: { name: 'webfetch-client' },
      model: 'gpt-4o-mini',
    }
    const tooling = {
      toolRegistry: { getHandlers: vi.fn() },
      taskManager: { kind: 'task-manager' },
      userInputManager: { kind: 'user-input' },
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
      onBeforeConfigLoad: expect.any(Function),
      onAfterSetupCompleted: expect.any(Function),
    })
    expect(mocks.createLlmClients).toHaveBeenCalledWith({ cfg: bootstrap.cfg, env: bootstrap.env })
    expect(mocks.createToolingRuntime).toHaveBeenCalledWith({
      cwd: bootstrap.cwd,
      env: bootstrap.env,
      webFetchClient: llm.webFetchClient,
    })
    expect(mocks.createPolicyAndHooksRuntime).toHaveBeenCalledWith({
      cfgPathsLogsDir: '/repo/logs',
      fileStore: bootstrap.fileStore,
      userInputManager: tooling.userInputManager,
      toolRegistry: tooling.toolRegistry,
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
    expect(out.engine).toBe(chatRuntime.engine)
    expect(out.tools).toEqual([{ name: 'Read' }])
  })

  it('creates runtime flags from environment when explicit flags are missing', async () => {
    const env = { FORMAX_DEBUG_TRACE_TOOLS: '1' }
    const bootstrap = {
      cwd: '/repo',
      env,
      cfg: { paths: { logsDir: '/repo/logs' } },
      fileStore: {},
    }
    mocks.createRuntimeConfigContext.mockResolvedValue(bootstrap)
    mocks.createLlmClients.mockReturnValue({ client: {}, webFetchClient: {}, model: 'x' })
    mocks.createToolingRuntime.mockReturnValue({ toolRegistry: {}, taskManager: {}, userInputManager: {} })
    mocks.createPolicyAndHooksRuntime.mockReturnValue({ audit: {}, hooks: {}, preflight: vi.fn(), createExecutor: vi.fn() })
    mocks.createSubagentRuntime.mockResolvedValue({ allowedSubagents: [], reloadSubagents: vi.fn(), tools: [] })
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
})
