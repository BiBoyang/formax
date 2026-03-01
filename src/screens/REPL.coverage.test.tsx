import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import type { RuntimeConfig } from '../config/config'

let mockState: any
let mockActions: any
let controllerArgs: any
let commandRegistryArgs: any
let hotkeysArgs: any
let inputBarProps: any
let configDialogProps: any
let modelDialogProps: any
let lastExploreGroupResult: any = null

const planSessionMock = {
  getPlanPath: vi.fn(() => null),
  startNewPlan: vi.fn(() => '/tmp/plan.md'),
}

const loadRuntimeConfigMock = vi.fn()
const loadWorkspaceRootsMock = vi.fn(async () => ({ workspaceRoots: ['/ws'], warnings: ['warn'] }))
const persistDefaultModelTierMock = vi.fn(async () => {})

vi.mock('../config/config', async () => {
  const actual = (await vi.importActual('../config/config')) as Record<string, unknown>
  return {
    ...actual,
    loadRuntimeConfig: loadRuntimeConfigMock,
  }
})

vi.mock('../features/commands/replEnvironmentService', async () => {
  const actual = (await vi.importActual('../features/commands/replEnvironmentService')) as Record<string, unknown>
  return {
    ...actual,
    loadWorkspaceRoots: loadWorkspaceRootsMock,
    persistDefaultModelTier: persistDefaultModelTierMock,
    resolveUserAgentsDir: () => '/tmp/user-agents',
  }
})

vi.mock('../features/repl/planSession', async () => {
  const actual = (await vi.importActual('../features/repl/planSession')) as Record<string, unknown>
  return {
    ...actual,
    createPlanSessionManager: () => planSessionMock,
  }
})

vi.mock('./repl/createReplCommandRegistry', async () => {
  const actual = (await vi.importActual('./repl/createReplCommandRegistry')) as Record<string, unknown>
  return {
    ...actual,
    createReplCommandRegistry: (args: any) => {
      commandRegistryArgs = args
      return {
        list: () => [],
        suggest: () => [],
      }
    },
  }
})

vi.mock('./repl/hotkeys', async () => {
  const actual = (await vi.importActual('./repl/hotkeys')) as Record<string, unknown>
  return {
    ...actual,
    useReplHotkeys: (args: any) => {
      hotkeysArgs = args
    },
  }
})

vi.mock('../features/repl/useReplController', async () => {
  const actual = (await vi.importActual('../features/repl/useReplController')) as Record<string, unknown>
  return {
    ...actual,
    useReplController: (args: any) => {
      controllerArgs = args
      return {
        state: mockState,
        actions: mockActions,
      }
    },
  }
})

vi.mock('../components/chat/InputBar', () => ({
  InputBar: (props: any) => {
    inputBarProps = props
    return <Text>{`INPUT:${props.inputMode}:${props.suggestions?.length ?? 0}`}</Text>
  },
}))

vi.mock('./repl/transcript', () => ({
  ReplTranscript: (props: any) => <Text>{`PRIMARY:${props.version}:${props.transcriptSeq}`}</Text>,
  ExpandedReplTranscript: (props: any) => <Text>{`EXPANDED:${props.version}:${props.transcriptSeq}`}</Text>,
}))

vi.mock('./repl/panels', async () => {
  const actual = (await vi.importActual('./repl/panels')) as Record<string, unknown>
  return {
    ...actual,
    ExploreAgentsPanel: (props: any) => <Text>{`EXPLORE:${props.tasks?.length ?? 0}`}</Text>,
    DetailedTranscriptPanel: (props: any) => <Text>{`DETAIL:${props.lines?.length ?? 0}:${props.title ?? ''}`}</Text>,
    formatTaskPanelTitle: () => 'Task title',
  }
})

vi.mock('./repl/messageItems', async () => {
  const actual = (await vi.importActual('./repl/messageItems')) as Record<string, unknown>
  return {
    ...actual,
    findLastContiguousExploreTaskGroup: () => lastExploreGroupResult,
  }
})

vi.mock('../tui/agents/AgentsDialog', () => ({
  AgentsDialog: (props: any) => <Text>{`AGENTS:${props.toolNames?.length ?? 0}`}</Text>,
}))

vi.mock('../tui/permissions/PermissionsDialog', () => ({
  PermissionsDialog: () => <Text>PERMISSIONS</Text>,
}))

vi.mock('../tui/hooks/HooksDialog', () => ({
  HooksDialog: () => <Text>HOOKS</Text>,
}))

vi.mock('../tui/config/ConfigDialog', () => ({
  ConfigDialog: (props: any) => {
    configDialogProps = props
    return <Text>{`CONFIG:${typeof props.onExit}`}</Text>
  },
}))

vi.mock('../tui/model/ModelDialog', () => ({
  ModelDialog: (props: any) => {
    modelDialogProps = props
    return <Text>{`MODEL:${props.currentTier}`}</Text>
  },
}))

vi.mock('../tui/resume/ResumeDialog', () => ({
  ResumeDialog: () => <Text>RESUME</Text>,
}))

vi.mock('../../package.json', () => ({
  default: { version: '' },
}))

const engine = {
  runTurn: async ({ history }: any) => history,
}

const cfg: RuntimeConfig = {
  llm: {
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: '',
    timeoutMs: 600000,
    thinkingMode: true,
    defaultTier: 'sonnet',
    configuredModel: '',
    tierModels: {},
  } as any,
  paths: {
    logsDir: '',
    subagentsDir: '',
    planDir: '',
  },
  context: {
    effectiveContextWindowPercent: 0.95,
    autoCompactTokenLimitPercent: 0.9,
    baselineTokens: 12000,
    compactKeepLastTurns: 4,
    enableAutoCompact: true,
    autoCompactMinTurnsBetweenRuns: 8,
  },
  ui: {
    assistantTextMode: 'stream',
    promptProfile: 'lite',
    showContextMeter: true,
    showAutoCompactNotice: true,
    outputStyle: 'default',
    verboseOutput: false,
  },
}

function baseState(overrides?: Partial<any>) {
  return {
    staticMessages: [],
    transientMessages: [],
    transcriptSeq: 1,
    isLoading: false,
    loadingText: '',
    thinkingText: '',
    thinkingStartedAtMs: null,
    error: null,
    context: null,
    allowedSubagents: [],
    agentsDialogOpen: false,
    permissionsDialogOpen: false,
    hooksDialogOpen: false,
    configDialogOpen: false,
    modelDialogOpen: false,
    resumeDialogOpen: false,
    ...overrides,
  }
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('REPL.tsx coverage branches', () => {
  beforeEach(() => {
    controllerArgs = undefined
    commandRegistryArgs = undefined
    hotkeysArgs = undefined
    inputBarProps = undefined
    configDialogProps = undefined
    modelDialogProps = undefined
    planSessionMock.getPlanPath.mockReset()
    planSessionMock.startNewPlan.mockReset()
    planSessionMock.getPlanPath.mockReturnValue(null)
    planSessionMock.startNewPlan.mockReturnValue('/tmp/plan.md')

    loadRuntimeConfigMock.mockReset()
    loadRuntimeConfigMock.mockResolvedValue({
      ...cfg,
      llm: { ...cfg.llm, defaultTier: 'opus' },
      ui: { ...cfg.ui, promptProfile: 'default' },
    })

    loadWorkspaceRootsMock.mockClear()
    persistDefaultModelTierMock.mockClear()

    mockActions = {
      send: vi.fn(async () => {}),
      abort: vi.fn(),
      closeConfigDialog: vi.fn(),
      closeModelDialog: vi.fn(),
      closeResumeDialog: vi.fn(),
      resumeSession: vi.fn(),
      renameSession: vi.fn(),
      closeAgentsDialog: vi.fn(),
      closePermissionsDialog: vi.fn(),
      closeHooksDialog: vi.fn(),
      generateAgentDraft: vi.fn(),
      saveAgentFromDialog: vi.fn(),
    }

    mockState = baseState()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('covers mode/config/model callbacks and plan path setup', async () => {
    const { REPL } = await import('./REPL')
    render(<REPL engine={engine as any} tools={[{ name: 'Bash' } as any]} cfg={cfg} />)

    expect(controllerArgs).toBeTruthy()
    controllerArgs.onModeChange('plan')
    expect(planSessionMock.startNewPlan).toHaveBeenCalledTimes(1)
    controllerArgs.onModeChange('normal')

    planSessionMock.getPlanPath.mockReturnValue('/existing.md')
    controllerArgs.onModeChange('plan')
    expect(planSessionMock.startNewPlan).toHaveBeenCalledTimes(1)

    loadRuntimeConfigMock.mockResolvedValueOnce({
      ...cfg,
      llm: { ...cfg.llm, defaultTier: 'invalid-tier' },
      ui: { ...cfg.ui, promptProfile: 'lite' },
    })
    const fallbackTier = await commandRegistryArgs.setDefaultModelTier('haiku')
    expect(fallbackTier).toBe('sonnet')

    loadRuntimeConfigMock.mockResolvedValueOnce({
      ...cfg,
      llm: { ...cfg.llm, defaultTier: 'opus' },
      ui: { ...cfg.ui, promptProfile: 'default' },
    })
    const parsedTier = await commandRegistryArgs.setDefaultModelTier('sonnet')
    expect(parsedTier).toBe('opus')
    expect(persistDefaultModelTierMock).toHaveBeenCalledTimes(2)

    mockState = baseState({ configDialogOpen: true })
    const ui = render(<REPL engine={engine as any} tools={[]} cfg={cfg} />)
    await tick()

    // Trigger handleConfigExit(kind=changed) via dialog callback.
    configDialogProps.onExit({ kind: 'changed' })
    expect(mockActions.closeConfigDialog).toHaveBeenCalledWith({ kind: 'changed' })
    expect(loadRuntimeConfigMock).toHaveBeenCalled()
    configDialogProps.onExit({ kind: 'dismissed' })

    mockState = baseState({ modelDialogOpen: true })
    ui.rerender(<REPL engine={engine as any} tools={[]} cfg={cfg} />)
    await tick()
    await modelDialogProps.onApplyTier('haiku')
    expect(ui.lastFrame() || '').toContain('MODEL:')

    mockState = baseState({ resumeDialogOpen: true })
    ui.rerender(<REPL engine={engine as any} tools={[]} cfg={cfg} />)
    await tick()
    expect(ui.lastFrame() || '').toContain('RESUME')
  }, 30000)

  it('covers loading queue, expanded panels, context branches and bash backspace path', async () => {
    const { REPL } = await import('./REPL')

    mockState = baseState({
      agentsDialogOpen: true,
      allowedSubagents: [{ name: 'a', description: '' }],
      isLoading: true,
      loadingText: 'compacting conversation now',
      thinkingText: 'thinking...',
      thinkingStartedAtMs: Date.now(),
      context: {
        percentRemaining: Number.NaN,
        usedTokens: 12,
        limitTokens: 100,
        source: 'usage',
      },
      staticMessages: [
        { role: 'assistant', content: 'banner', ui: { kind: 'compact_banner' } },
        { role: 'assistant', content: 'ignored', ui: { kind: 'compact_boundary' } },
        { role: 'assistant', content: 'think', ui: { kind: 'thinking_block' } },
        {
          role: 'tool',
          content: 'not-task',
          toolInfo: { name: 'Read', transcriptLines: ['noop'] },
        },
        {
          role: 'tool',
          content: 'task',
          toolInfo: { name: 'Task', transcriptLines: ['line1', 'line2'] },
        },
      ],
    })

    const ui = render(<REPL engine={engine as any} tools={[{ name: 'Read' } as any, { name: 'Write' } as any]} cfg={cfg} />)
    await tick(10)

    expect(ui.lastFrame() || '').toContain('AGENTS:2')

    mockState = { ...mockState, agentsDialogOpen: false }
    ui.rerender(<REPL engine={engine as any} tools={[{ name: 'Read' } as any, { name: 'Write' } as any]} cfg={cfg} />)
    await tick(10)
    hotkeysArgs.onRecallQueuedMessage()
    await tick(10)

    // Empty submissions are ignored.
    await inputBarProps.onSubmit('   ')

    // Queue messages while loading; then recall one via hotkeys callback.
    await inputBarProps.onSubmit('queued-1')
    await inputBarProps.onSubmit('queued-2')
    await tick(10)

    hotkeysArgs.onRecallQueuedMessage()
    await tick(10)
    hotkeysArgs.onRecallQueuedMessage()
    hotkeysArgs.onRecallQueuedMessage()
    await tick(10)

    // Trigger bash mode and onBackspaceAtStart callback path.
    hotkeysArgs.setBashModeActive(true)
    await tick(10)
    expect(inputBarProps.inputMode).toBe('bash')
    await inputBarProps.onSubmit('echo hi')
    await tick(10)
    hotkeysArgs.setBashModeActive(true)
    await tick(10)
    if (typeof inputBarProps.onBackspaceAtStart === 'function') inputBarProps.onBackspaceAtStart()
    await tick(10)

    // Arm ctrl+c timer path (set future -> timer callback clears it).
    hotkeysArgs.setCtrlCArmedUntilMs(Date.now() + 30)
    await tick(100)
    hotkeysArgs.setCtrlCArmedUntilMs(Date.now() + 500)
    await tick(10)
    hotkeysArgs.setCtrlCArmedUntilMs(null)
    await tick(10)
    hotkeysArgs.setCtrlCArmedUntilMs(Date.now() - 1)
    await tick(10)

    // Finish loading to trigger auto-flush of queued messages.
    mockState = { ...mockState, isLoading: false }
    ui.rerender(<REPL engine={engine as any} tools={[{ name: 'Read' } as any]} cfg={cfg} />)
    await tick(20)
    hotkeysArgs.setBashModeActive(true)
    await tick(10)
    expect(inputBarProps.inputMode).toBe('bash')
    await inputBarProps.onSubmit('echo live')
    await tick(10)

    // Expanded view + history folding branches.
    lastExploreGroupResult = { tasks: [{}, {}] }
    hotkeysArgs.setExpandedTranscriptOpen(true)
    await tick(10)

    expect((ui.lastFrame() || '').includes('EXPANDED:0.0.0')).toBe(true)
    expect((ui.lastFrame() || '').includes('EXPLORE:2')).toBe(true)
    expect((ui.lastFrame() || '').includes('DETAIL:2:Task title')).toBe(true)

    hotkeysArgs.setExpandedTranscriptHideHistory(true)
    await tick(10)

    lastExploreGroupResult = { tasks: [{}] }
    mockState = {
      ...mockState,
      isLoading: true,
      thinkingText: 'still-thinking',
      transientMessages: [{ role: 'assistant', content: 'x', ui: { kind: 'compact_boundary' } }],
      staticMessages: [
        {
          role: 'tool',
          content: 'task2',
          toolInfo: { name: 'Task', transcriptLines: ['x'] },
        },
      ],
    }
    ui.rerender(<REPL engine={engine as any} tools={[]} cfg={{ ...cfg, ui: { ...cfg.ui, showContextMeter: false } }} />)
    await tick(10)

    // Exercise nullish/binary branches with non-stable getters.
    let exploreReads = 0
    lastExploreGroupResult = {
      get tasks() {
        exploreReads++
        return exploreReads === 1 ? [{ id: 'a' }] : undefined
      },
    }
    let taskInfoReads = 0
    mockState = {
      ...mockState,
      staticMessages: [
        {
          role: 'tool',
          content: 'task3',
          get toolInfo() {
            taskInfoReads++
            if (taskInfoReads === 1) return { name: 'Task', transcriptLines: ['z'] }
            return undefined
          },
        },
        {
          role: 'tool',
          content: 'not-task-2',
          toolInfo: { name: 'Read', transcriptLines: ['ignored'] },
        },
        { role: 'assistant', content: '', ui: { kind: 'compact_banner' } },
      ],
      transientMessages: [{ role: 'assistant', content: 'b', ui: { kind: 'compact_boundary' } }],
    }
    ui.rerender(<REPL engine={engine as any} tools={[]} cfg={cfg} />)
    await tick(10)

    // Cleanup path for timer effect.
    ui.unmount()
  }, 30000)

  it('covers cancelled workspace root load branch on unmount', async () => {
    let resolveRoots: ((v: any) => void) | null = null
    loadWorkspaceRootsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRoots = resolve
      }),
    )

    const { REPL } = await import('./REPL')
    const ui = render(<REPL engine={engine as any} tools={[]} cfg={cfg} />)
    ui.unmount()
    resolveRoots?.({ workspaceRoots: ['/later'], warnings: [] })
    await tick(10)
  }, 30000)
})
