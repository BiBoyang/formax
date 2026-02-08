import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '../env/config.js'

const clearTerminal = vi.fn(async () => {})
const stopConsoleLogger = vi.fn()
const createRuntime = vi.fn()
const resolveInitialSession = vi.fn()
const renderReplApp = vi.fn()

vi.mock('../utils/terminal.js', () => ({
  clearTerminal,
}))

vi.mock('../utils/consoleLogger.js', () => ({
  startConsoleLogger: vi.fn(),
  stopConsoleLogger,
}))

vi.mock('../runtime/createRuntime.js', () => ({
  createRuntime,
}))

vi.mock('./bootstrap/session.js', () => ({
  resolveInitialSession,
}))

vi.mock('./bootstrap/renderReplApp.js', () => ({
  renderReplApp,
}))

function createCfg(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    llm: {
      provider: 'anthropic',
      apiKey: 'k',
      baseUrl: 'https://example.test',
      model: 'claude-sonnet-4-5-20250929',
      timeoutMs: 30000,
      thinkingMode: true,
    },
    context: {
      effectiveContextWindowPercent: 100,
      autoCompactTokenLimitPercent: 90,
      baselineTokens: 0,
      compactKeepLastTurns: 8,
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 1,
    },
    paths: {
      logsDir: '/tmp/formax-logs',
      planDir: '/tmp/formax-plan',
      subagentsDir: '/tmp/formax-agents',
    },
    ui: {
      assistantTextMode: 'stream',
      promptProfile: 'full',
      showContextMeter: true,
      showAutoCompactNotice: true,
      outputStyle: 'default',
      verboseOutput: false,
    },
    ...overrides,
  }
}

describe('runLegacyCli', () => {
  const originalEnv = process.env
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const processExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }

    const cfg = createCfg()
    createRuntime.mockResolvedValue({
      cwd: '/repo',
      env: process.env,
      fileStore: {},
      cfg,
      model: cfg.llm.model,
      client: { kind: 'main-client' },
      webFetchClient: { kind: 'web-fetch-client' },
      toolRegistry: { kind: 'tool-registry' },
      taskManager: { kind: 'task-manager' },
      userInputManager: { kind: 'user-input-manager' },
      audit: { kind: 'audit' },
      hooks: { kind: 'hooks' },
      preflight: vi.fn(),
      createExecutor: vi.fn(() => ({ kind: 'executor' })),
      allowedSubagents: [{ name: 'design-planner', description: 'planner' }],
      reloadSubagents: vi.fn(async () => [{ name: 'design-planner', description: 'planner' }]),
      tools: [],
      runtimeFlags: {},
      executor: { kind: 'chat-executor' },
      engine: { kind: 'chat-engine' },
    })
    resolveInitialSession.mockResolvedValue(null)
    renderReplApp.mockReturnValue({
      clear: vi.fn(),
    })
  })

  afterAll(() => {
    process.env = originalEnv
    stderrWrite.mockRestore()
    processExit.mockRestore()
  })

  it('boots REPL with orchestrated services', async () => {
    const { runLegacyCli } = await import('./runLegacyCli.js')
    await runLegacyCli()

    expect(clearTerminal).toHaveBeenCalledTimes(1)
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        env: process.env,
      }),
    )
    expect(renderReplApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSession: null,
      }),
    )
    expect(processExit).not.toHaveBeenCalled()
  })

  it('resolves initial session when FORMAX_RESUME_LAST=1', async () => {
    process.env.FORMAX_RESUME_LAST = '1'
    resolveInitialSession.mockResolvedValueOnce({
      filePath: '/tmp/session.jsonl',
      messages: [],
      history: [],
    })

    const { runLegacyCli } = await import('./runLegacyCli.js')
    await runLegacyCli()

    expect(resolveInitialSession).toHaveBeenCalledWith({
      cwd: '/repo',
      env: process.env,
    })
    expect(renderReplApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSession: {
          filePath: '/tmp/session.jsonl',
          messages: [],
          history: [],
        },
      }),
    )
  })

  it('prints error and exits when setup/bootstrap fails', async () => {
    createRuntime.mockRejectedValueOnce(new Error('Setup canceled'))

    const { runLegacyCli } = await import('./runLegacyCli.js')
    await runLegacyCli()

    expect(stopConsoleLogger).toHaveBeenCalledTimes(1)
    expect(clearTerminal).toHaveBeenCalledTimes(2)
    expect(stderrWrite).toHaveBeenCalledWith('Error: Setup canceled\n')
    expect(processExit).toHaveBeenCalledWith(1)
    expect(renderReplApp).not.toHaveBeenCalled()
  })
})
