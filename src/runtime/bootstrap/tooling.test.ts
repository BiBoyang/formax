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
  const LocalBashPresenter = { name: 'LocalBashPresenter' }

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

  return {
    ToolRegistry,
    TaskManager,
    registerBuiltinToolModules,
    createWebFetchToolModule,
    createTaskOutputToolModule,
    createUserInputManager,
    createAskUserQuestionToolModule,
    createKillShellToolModule,
    createToolSearchToolModule,
    LocalBashPresenter,
    toolRegistryInstances,
    taskManagerInstances,
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
vi.mock('../../components/tool/LocalBashPresenter.js', () => ({
  LocalBashPresenter: mocks.LocalBashPresenter,
}))

import { createToolingRuntime } from './tooling.js'

describe('createToolingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.toolRegistryInstances.length = 0
    mocks.taskManagerInstances.length = 0
    mocks.createUserInputManager.mockReturnValue({ kind: 'user-input' })
    mocks.createWebFetchToolModule.mockReturnValue({ name: 'WebFetch' })
    mocks.createTaskOutputToolModule.mockReturnValue({ name: 'TaskOutput' })
    mocks.createKillShellToolModule.mockReturnValue({ name: 'KillShell' })
    mocks.createAskUserQuestionToolModule.mockReturnValue({ name: 'AskUserQuestion' })
    mocks.createToolSearchToolModule.mockReturnValue({ name: 'ToolSearch' })
  })

  it('registers builtins plus extra tool modules and returns runtime objects', () => {
    const webFetchClient = { stream: vi.fn() }

    const out = createToolingRuntime({
      cwd: '/repo',
      env: {
        FORMAX_WEBFETCH_MAX_TOKENS: '4096',
        FORMAX_WEBFETCH_MAX_INPUT_CHARS: '240000',
      },
      webFetchClient: webFetchClient as any,
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

    expect(out.toolRegistry).toBe(registry)
    expect(out.taskManager).toBe(taskManager)
    expect(out.userInputManager).toEqual({ kind: 'user-input' })
  })

  it('uses default WebFetch limits when env vars are absent', () => {
    createToolingRuntime({
      cwd: '/repo',
      env: {},
      webFetchClient: { stream: vi.fn() } as any,
    })

    expect(mocks.createWebFetchToolModule).toHaveBeenCalledWith({
      client: expect.any(Object),
      maxTokens: 1024,
      maxInputChars: 120000,
    })
  })
})
