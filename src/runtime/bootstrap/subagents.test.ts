import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfigPaths: vi.fn(),
  createSubAgentRegistry: vi.fn(),
  createSubAgentRunner: vi.fn(),
  createTaskSubAgentToolHandler: vi.fn(),
  createTaskToolModule: vi.fn(),
  patchTaskToolForSubagents: vi.fn(),
  getKnownContextWindowTokens: vi.fn(),
  createToolExecutor: vi.fn(),
}))

vi.mock('../../adapters/fs/configPaths.js', () => ({
  getConfigPaths: mocks.getConfigPaths,
}))
vi.mock('../../subagents/registry.js', () => ({
  createSubAgentRegistry: mocks.createSubAgentRegistry,
}))
vi.mock('../../subagents/runner.js', () => ({
  createSubAgentRunner: mocks.createSubAgentRunner,
}))
vi.mock('../../tools/executor/handlers/taskSubAgent.js', () => ({
  createTaskSubAgentToolHandler: mocks.createTaskSubAgentToolHandler,
}))
vi.mock('../../tools/modules/task/index.js', () => ({
  createTaskToolModule: mocks.createTaskToolModule,
}))
vi.mock('../../tools/patches/taskSubagent.js', () => ({
  patchTaskToolForSubagents: mocks.patchTaskToolForSubagents,
}))
vi.mock('../../chat/context/modelWindow.js', () => ({
  getKnownContextWindowTokens: mocks.getKnownContextWindowTokens,
}))
vi.mock('../../tools/executor/index.js', () => ({
  createToolExecutor: mocks.createToolExecutor,
}))

import { createSubagentRuntime } from './subagents.js'

describe('createSubagentRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads subagents, wires task handler, and exposes reload + patched tools', async () => {
    const registry = {
      loadFromDirectories: vi.fn(async () => {}),
      list: vi
        .fn()
        .mockReturnValueOnce([{ name: 'a', description: 'A' }])
        .mockReturnValueOnce([{ name: 'b', description: 'B' }]),
    }
    mocks.createSubAgentRegistry.mockReturnValue(registry)
    mocks.getConfigPaths.mockReturnValue({ globalConfigDir: '/cfg' })
    mocks.getKnownContextWindowTokens.mockReturnValue(8192)

    const localExecutor = { kind: 'local-executor' }
    const runner = { kind: 'runner' }
    const taskHandler = { kind: 'task-handler' }
    const taskModule = { name: 'Task' }
    const toolsBeforePatch = [{ name: 'Read' }]
    const toolsAfterPatch = [{ name: 'Read' }, { name: 'Task' }]
    const addPatch = vi.fn()
    const register = vi.fn()
    const listSpecs = vi.fn().mockResolvedValueOnce(toolsBeforePatch).mockResolvedValueOnce(toolsAfterPatch)

    mocks.createSubAgentRunner.mockReturnValue(runner)
    mocks.createTaskSubAgentToolHandler.mockReturnValue(taskHandler)
    mocks.createTaskToolModule.mockReturnValue(taskModule)
    mocks.createToolExecutor.mockReturnValue(localExecutor)

    const toolRegistry = {
      listSpecs,
      getHandlers: vi.fn(() => ({ Bash: vi.fn() })),
      register,
      addPatch,
    }

    const out = await createSubagentRuntime({
      cfg: {
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          contextWindowTokens: 16_000,
        },
        context: {
          effectiveContextWindowPercent: 0.8,
          autoCompactTokenLimitPercent: 0.9,
          baselineTokens: 2000,
        },
        paths: {
          subagentsDir: '/cfg/agents',
        },
      } as any,
      env: {},
      cwd: '/repo',
      client: { stream: vi.fn() } as any,
      toolRegistry: toolRegistry as any,
      taskManager: { set: vi.fn() } as any,
      preflight: vi.fn(),
      createLocalExecutor: () => localExecutor as any,
    })

    expect(mocks.getConfigPaths).toHaveBeenCalledWith({ cwd: '/repo', env: {} })
    expect(registry.loadFromDirectories).toHaveBeenCalledWith(['/cfg/agents'])
    expect(mocks.getKnownContextWindowTokens).not.toHaveBeenCalled()
    expect(mocks.createSubAgentRunner).toHaveBeenCalledWith({
      client: expect.any(Object),
      executor: localExecutor,
      allTools: toolsBeforePatch,
      promptBudget: {
        contextWindowTokens: 16000,
        effectiveContextWindowPercent: 0.8,
        autoCompactLimitPercent: 0.9,
        baselineTokens: 2000,
      },
    })
    expect(mocks.createTaskSubAgentToolHandler).toHaveBeenCalledWith({
      registry,
      runner,
      taskManager: expect.any(Object),
    })
    expect(mocks.createTaskToolModule).toHaveBeenCalledWith(taskHandler)
    expect(register).toHaveBeenCalledWith(taskModule)
    expect(addPatch).toHaveBeenCalledTimes(1)
    const patchFn = addPatch.mock.calls[0][0]
    patchFn([{ name: 'Bash' }])
    expect(mocks.patchTaskToolForSubagents).toHaveBeenCalledWith([{ name: 'Bash' }], [{ name: 'a', description: 'A' }])

    expect(out.allowedSubagents).toEqual([{ name: 'a', description: 'A' }])
    expect(out.tools).toEqual(toolsAfterPatch)
    expect(await out.reloadSubagents()).toEqual([{ name: 'b', description: 'B' }])
  })

  it('builds local executor and uses model token lookup when runtime tokens are absent', async () => {
    const registry = {
      loadFromDirectories: vi.fn(async () => {}),
      list: vi.fn(() => []),
    }
    mocks.createSubAgentRegistry.mockReturnValue(registry)
    mocks.getConfigPaths.mockReturnValue({ globalConfigDir: '/global' })
    mocks.getKnownContextWindowTokens.mockReturnValueOnce(undefined)
    mocks.createSubAgentRunner.mockReturnValue({})
    mocks.createTaskSubAgentToolHandler.mockReturnValue({})
    mocks.createTaskToolModule.mockReturnValue({})
    mocks.createToolExecutor.mockReturnValue({ kind: 'executor' })

    const toolRegistry = {
      listSpecs: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      getHandlers: vi.fn(() => ({ Read: vi.fn() })),
      register: vi.fn(),
      addPatch: vi.fn(),
    }

    await createSubagentRuntime({
      cfg: {
        llm: {
          provider: 'anthropic',
          model: 'claude-sonnet',
          contextWindowTokens: undefined,
        },
        context: {
          effectiveContextWindowPercent: 0.75,
          autoCompactTokenLimitPercent: 0.85,
          baselineTokens: 1000,
        },
        paths: {
          subagentsDir: '/project/.formax/agents',
        },
      } as any,
      env: {},
      cwd: '/repo',
      client: { stream: vi.fn() } as any,
      toolRegistry: toolRegistry as any,
      taskManager: {} as any,
      preflight: vi.fn(),
    })

    expect(registry.loadFromDirectories).toHaveBeenCalledWith(['/global/agents', '/project/.formax/agents'])
    expect(mocks.getKnownContextWindowTokens).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet',
    })
    expect(mocks.createToolExecutor).toHaveBeenCalledWith({ Read: expect.any(Function) }, { preflight: expect.any(Function) })
    expect(mocks.createSubAgentRunner).toHaveBeenCalledWith({
      client: expect.any(Object),
      executor: { kind: 'executor' },
      allTools: [],
      promptBudget: null,
    })
  })
})
