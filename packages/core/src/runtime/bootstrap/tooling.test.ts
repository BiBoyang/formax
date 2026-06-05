import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const toolRegistryInstances: any[] = []
  const taskManagerInstances: any[] = []
  const registerBuiltinToolModules = vi.fn()
  const createWebFetchToolModule = vi.fn()
  const createTaskOutputToolModule = vi.fn()
  const createUserInputManager = vi.fn()
  const createAskUserQuestionToolModule = vi.fn()
  const createKillShellToolModule = vi.fn()
  const createToolSearchToolModule = vi.fn()
  const createMcpToolModule = vi.fn()
  const LocalBashPresenter = { name: 'LocalBashPresenter' }
  const mcpServerManagerInstances: any[] = []

  class ToolRegistry {
    register = vi.fn()
    getHandlers = vi.fn(() => ({}))
    listSpecs = vi.fn(async () => [])
    addPatch = vi.fn()

    constructor() {
      toolRegistryInstances.push(this)
    }
  }

  class TaskManager {
    constructor() {
      taskManagerInstances.push(this)
    }
  }

  class McpServerManager {
    options: any

    constructor(options: any) {
      this.options = options
      mcpServerManagerInstances.push(this)
    }
  }

  return {
    ToolRegistry,
    TaskManager,
    McpServerManager,
    registerBuiltinToolModules,
    createWebFetchToolModule,
    createTaskOutputToolModule,
    createUserInputManager,
    createAskUserQuestionToolModule,
    createKillShellToolModule,
    createToolSearchToolModule,
    createMcpToolModule,
    LocalBashPresenter,
    toolRegistryInstances,
    taskManagerInstances,
    mcpServerManagerInstances,
  }
})

vi.mock('../../tools/registry.js', () => ({
  ToolRegistry: mocks.ToolRegistry,
}))
vi.mock('../../tools/modules/index.js', () => ({
  registerBuiltinToolModules: mocks.registerBuiltinToolModules,
}))
vi.mock('../../tools/modules/webFetch/index.js', () => ({
  createWebFetchToolModule: mocks.createWebFetchToolModule,
}))
vi.mock('../../tools/runtime/taskManager.js', () => ({
  TaskManager: mocks.TaskManager,
}))
vi.mock('../../tools/modules/taskOutput/index.js', () => ({
  createTaskOutputToolModule: mocks.createTaskOutputToolModule,
}))
vi.mock('../../tools/runtime/userInputManager.js', () => ({
  createUserInputManager: mocks.createUserInputManager,
}))
vi.mock('../../tools/modules/askUserQuestion/index.js', () => ({
  createAskUserQuestionToolModule: mocks.createAskUserQuestionToolModule,
}))
vi.mock('../../tools/modules/killShell/index.js', () => ({
  createKillShellToolModule: mocks.createKillShellToolModule,
}))
vi.mock('../../tools/modules/toolSearch/index.js', () => ({
  createToolSearchToolModule: mocks.createToolSearchToolModule,
}))
vi.mock('../../mcp/serverManager.js', () => ({
  McpServerManager: mocks.McpServerManager,
}))
vi.mock('../../tools/modules/mcp/index.js', () => ({
  createMcpToolModule: mocks.createMcpToolModule,
}))
vi.mock('../../components/tool/LocalBashPresenter.js', () => ({
  LocalBashPresenter: mocks.LocalBashPresenter,
}))

import { createToolingRuntime } from './tooling.js'

describe('createToolingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.toolRegistryInstances.length = 0
    mocks.taskManagerInstances.length = 0
    mocks.mcpServerManagerInstances.length = 0
    mocks.createUserInputManager.mockReturnValue({ kind: 'user-input' })
    mocks.createWebFetchToolModule.mockReturnValue({ name: 'WebFetch' })
    mocks.createTaskOutputToolModule.mockReturnValue({ name: 'TaskOutput' })
    mocks.createKillShellToolModule.mockReturnValue({ name: 'KillShell' })
    mocks.createAskUserQuestionToolModule.mockReturnValue({ name: 'AskUserQuestion' })
    mocks.createToolSearchToolModule.mockReturnValue({ name: 'ToolSearch' })
    mocks.createMcpToolModule.mockReturnValue({ name: 'mcp' })
  })

  it('registers builtins plus extra tool modules and returns runtime objects', () => {
    const webFetchClient = { stream: vi.fn() }
    const mcpServerManager = { kind: 'mcp-manager' }

    const out = createToolingRuntime({
      cwd: '/repo',
      env: {
        FORMAX_WEBFETCH_MAX_TOKENS: '4096',
        FORMAX_WEBFETCH_MAX_INPUT_CHARS: '240000',
      },
      webFetchClient: webFetchClient as any,
      mcpServerManager: mcpServerManager as any,
    })

    const registry = mocks.toolRegistryInstances[0]
    const taskManager = mocks.taskManagerInstances[0]

    expect(mocks.registerBuiltinToolModules).toHaveBeenCalledWith(registry, {
      taskManager,
      userInput: { kind: 'user-input' },
      cwd: '/repo',
    })
    expect(mocks.createToolSearchToolModule).toHaveBeenCalledTimes(1)
    expect(registry.register).toHaveBeenNthCalledWith(1, { name: 'ToolSearch' })
    expect(registry.register).toHaveBeenNthCalledWith(2, {
      name: 'LocalBash',
      presenter: mocks.LocalBashPresenter,
    })
    expect(mocks.createWebFetchToolModule).toHaveBeenCalledWith({
      client: webFetchClient,
      maxTokens: 4096,
      maxInputChars: 240000,
    })
    expect(registry.register).toHaveBeenNthCalledWith(3, { name: 'WebFetch' })
    expect(mocks.createTaskOutputToolModule).toHaveBeenCalledWith(taskManager)
    expect(registry.register).toHaveBeenNthCalledWith(4, { name: 'TaskOutput' })
    expect(mocks.createKillShellToolModule).toHaveBeenCalledWith(taskManager)
    expect(registry.register).toHaveBeenNthCalledWith(5, { name: 'KillShell' })
    expect(mocks.createAskUserQuestionToolModule).toHaveBeenCalledWith({ kind: 'user-input' })
    expect(registry.register).toHaveBeenNthCalledWith(6, { name: 'AskUserQuestion' })
    expect(mocks.createMcpToolModule).toHaveBeenCalledWith({
      manager: mcpServerManager,
    })
    expect(registry.register).toHaveBeenNthCalledWith(7, { name: 'mcp' })

    expect(out.toolRegistry).toBe(registry)
    expect(out.taskManager).toBe(taskManager)
    expect(out.userInputManager).toEqual({ kind: 'user-input' })
    expect(out.mcpServerManager).toBe(mcpServerManager)
  })

  it('does not instantiate an MCP server manager inside tooling', () => {
    const mcpServerManager = { kind: 'mcp-manager' }

    const out = createToolingRuntime({
      cwd: '/repo',
      env: {},
      webFetchClient: { stream: vi.fn() } as any,
      mcpServerManager: mcpServerManager as any,
    })

    expect(mocks.mcpServerManagerInstances).toHaveLength(0)
    expect(mocks.createMcpToolModule).toHaveBeenCalledWith({ manager: mcpServerManager })
    expect(out.mcpServerManager).toBe(mcpServerManager)
  })

  it('uses default WebFetch limits when env vars are absent', () => {
    createToolingRuntime({
      cwd: '/repo',
      env: {},
      webFetchClient: { stream: vi.fn() } as any,
      mcpServerManager: { kind: 'mcp-manager' } as any,
    })

    expect(mocks.createWebFetchToolModule).toHaveBeenCalledWith({
      client: expect.any(Object),
      maxTokens: 1024,
      maxInputChars: 120000,
    })
  })
})
