import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMainSendTurn } from './sendMainTurn'
import { computeContextStats } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import { buildSystemPrompt } from '../../../../prompts'
import { buildOutputStyleInjectedBlocks } from '../../../../prompts/reminders/outputStyle'
import {
  buildAvailableSkillsSystemReminderText,
  buildSkillToolSpecForCwdWithOptions,
} from '../../../../tools/modules/skill'
import { buildTurnInput } from '../../../semantics/adapters/turnInputBuilder'
import { formatErrorSubline } from '../shared/errorSubline'
import { makeMessageId } from '../shared/ids'
import { isAbortLikeError } from '../shared/utils'
import { maybeRunAutoCompactBeforeTurn } from './sendAutoCompact'
import { getDeferredToolExposureStore } from '../../../../tools/runtime/deferredToolExposure'

vi.mock('../../../../chat/context/budget', () => ({
  computeContextStats: vi.fn(),
}))

vi.mock('../../../../chat/context/estimate', () => ({
  estimatePromptTokens: vi.fn(),
}))

vi.mock('../../../../chat/context/modelWindow', () => ({
  getKnownContextWindowTokens: vi.fn(),
}))

vi.mock('../../../../chat/context/prune', () => ({
  pruneForPromptBudget: vi.fn(),
}))

vi.mock('../../../../prompts', () => ({
  buildSystemPrompt: vi.fn(),
}))

vi.mock('../../../../prompts/reminders/outputStyle', () => ({
  buildOutputStyleInjectedBlocks: vi.fn(),
}))

vi.mock('../../../../tools/modules/skill', () => ({
  buildSkillToolSpecForCwdWithOptions: vi.fn(),
  buildAvailableSkillsSystemReminderText: vi.fn(),
}))

vi.mock('../../reminders/ReminderService', () => ({
  ReminderService: class ReminderServiceMock {
    generateInjectedBlocks() {
      return [{ type: 'text', text: 'reminder' }]
    }
  },
}))

vi.mock('../../../semantics/adapters/turnInputBuilder', () => ({
  buildTurnInput: vi.fn(),
}))

vi.mock('../shared/errorSubline', () => ({
  formatErrorSubline: vi.fn(),
}))

vi.mock('../shared/ids', () => ({
  makeMessageId: vi.fn(),
}))

vi.mock('../shared/utils', () => ({
  isAbortLikeError: vi.fn(),
}))

vi.mock('./sendAutoCompact', () => ({
  maybeRunAutoCompactBeforeTurn: vi.fn(),
}))

function createCfg(overrides?: Record<string, unknown>): any {
  return {
    llm: {
      model: 'claude-3-5-sonnet-latest',
      thinkingMode: true,
      contextWindowTokens: 200_000,
    },
    ui: {
      outputStyle: 'default',
    },
    context: {
      effectiveContextWindowPercent: 0.9,
      autoCompactTokenLimitPercent: 0.85,
      baselineTokens: 1000,
      compactKeepLastTurns: 4,
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 2,
    },
    ...(overrides || {}),
  }
}

function createHarness(overrides?: Record<string, unknown>): any {
  let messages: any[] = []
  const setMessages = (updater: any) => {
    messages = typeof updater === 'function' ? updater(messages) : updater
  }
  const setContext = vi.fn()
  const setError = vi.fn()
  const setIsLoading = vi.fn()
  const setLoadingText = vi.fn()
  const setThinkingText = vi.fn()
  const emitCanonicalUiMessage = vi.fn()

  const engine = {
    runTurn: vi.fn(async (args: any) => [
      ...(args.history || []),
      args.user,
      { role: 'assistant', content: [{ type: 'text', text: 'assistant' }] },
    ]),
  }

  const base = {
    input: {
      text: 'hello',
      slashEffect: null,
      provider: 'anthropic',
    },
    deps: {
      engine,
      cfg: createCfg(),
      planSession: {
        getPlanPath: () => '/plans/current.md',
        startNewPlan: () => '/plans/new.md',
      },
      reminderServiceRef: { current: null },
      tools: [{ name: 'Skill' }, { name: 'Read' }],
      allowedSubagents: [],
      mode: 'normal',
      getReplMode: () => 'normal',
      setReplMode: vi.fn(),
      handleEvent: vi.fn(),
    },
    refs: {
      historyRef: { current: [] as any[] },
      pendingInjectedBlocksRef: { current: [] as any[] },
      contextBudgetConfigRef: { current: null },
      abortControllerRef: { current: null as AbortController | null },
      assistantBufferRef: { current: '' },
      thinkingBufferRef: { current: '' },
      thinkingLastFlushAtRef: { current: 0 },
      currentAssistantIdRef: { current: null as string | null },
      pendingExitPlanReminderRef: { current: true },
      sendSeqRef: { current: 0 },
      lastAutoCompactSeqRef: { current: 0 },
      onCompactLifecycle: vi.fn(),
    },
    state: {
      setMessages,
      setIsLoading,
      setLoadingText,
      setThinkingText,
      setError,
      setContext,
      emitCanonicalUiMessage,
    },
    _spies: {
      setContext,
      setError,
      setIsLoading,
      setLoadingText,
      setThinkingText,
      emitCanonicalUiMessage,
      getMessages: () => messages,
      engine,
    },
  }

  return {
    ...base,
    ...(overrides || {}),
  }
}

describe('runMainSendTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(makeMessageId).mockImplementation((role: string) => `${role}-id`)
    vi.mocked(buildTurnInput).mockReturnValue({
      userBlocks: [{ type: 'text', text: 'user-block' }],
      semanticBlocks: [{ type: 'text', text: 'semantic-block' }],
    } as any)
    vi.mocked(buildOutputStyleInjectedBlocks).mockReturnValue([{ type: 'text', text: 'style-block' }] as any)
    vi.mocked(buildSystemPrompt).mockReturnValue([{ type: 'text', text: 'system' }] as any)
    vi.mocked(getKnownContextWindowTokens).mockReturnValue(150_000)
    vi.mocked(estimatePromptTokens).mockReturnValue(1234)
    vi.mocked(computeContextStats).mockReturnValue({
      usedTokens: 1234,
      effectiveLimitTokens: 9000,
      percentRemaining: 86,
      shouldAutoCompact: false,
    } as any)
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(buildSkillToolSpecForCwdWithOptions).mockReturnValue({ name: 'Skill', patched: true } as any)
    vi.mocked(buildAvailableSkillsSystemReminderText).mockReturnValue(
      '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- alpha: Alpha skill\n</system-reminder>',
    )
    vi.mocked(maybeRunAutoCompactBeforeTurn).mockResolvedValue(undefined)
    vi.mocked(formatErrorSubline).mockImplementation((msg: string) => `ERR:${msg}`)
    vi.mocked(isAbortLikeError).mockReturnValue(false)
  })

  it('runs a successful main turn with patched tools and context updates', async () => {
    const harness = createHarness()
    const result = await runMainSendTurn(harness)

    expect(result).toEqual({
      userMessageId: 'user-id',
      turnOutcome: 'completed',
    })
    expect(maybeRunAutoCompactBeforeTurn).toHaveBeenCalledTimes(1)
    expect(harness.refs.sendSeqRef.current).toBe(1)
    expect(harness.refs.pendingExitPlanReminderRef.current).toBe(false)
    expect(harness.refs.pendingInjectedBlocksRef.current).toEqual([])
    expect(harness.refs.abortControllerRef.current).toBeNull()
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(buildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'legacy' }),
    )
    expect(harness._spies.engine.runTurn.mock.calls[0][0].tools).toEqual([
      { name: 'Skill', patched: true },
      { name: 'Read' },
    ])
    expect(buildSkillToolSpecForCwdWithOptions).toHaveBeenCalledWith(
      expect.any(String),
      { includeAvailableSkillsInDescription: true },
    )
    expect(harness._spies.setContext).toHaveBeenCalledWith({
      usedTokens: 1234,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('falls back to unknown model context window and clears context when unavailable', async () => {
    vi.mocked(getKnownContextWindowTokens).mockReturnValueOnce(undefined as any)
    const harness = createHarness()
    harness.deps.cfg = createCfg({
      llm: {
        model: 'claude-3-5-sonnet-latest',
        thinkingMode: true,
        contextWindowTokens: undefined,
      },
    })

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('completed')
    expect(harness._spies.setContext).toHaveBeenCalledWith(null)
    expect(pruneForPromptBudget).not.toHaveBeenCalledWith(
      expect.objectContaining({
        contextWindowTokens: expect.any(Number),
      }),
    )
  })

  it('strips injected blocks from persisted history when present', async () => {
    const harness = createHarness()
    harness.refs.pendingInjectedBlocksRef.current = [
      { type: 'text', text: 'inj-1' },
      { type: 'text', text: 'inj-2' },
    ]
    harness._spies.engine.runTurn.mockResolvedValueOnce([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'reminder' },
          { type: 'text', text: 'style-block' },
          { type: 'text', text: 'semantic-block' },
          { type: 'text', text: 'inj-1' },
          { type: 'text', text: 'inj-2' },
          { type: 'text', text: 'user-block' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ])

    await runMainSendTurn(harness)

    expect(harness.refs.historyRef.current[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'user-block' }],
    })
  })

  it('marks aborted outcome when error is abort-like', async () => {
    vi.mocked(isAbortLikeError).mockReturnValueOnce(true)
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('aborted'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('aborted')
    expect(harness._spies.setError).not.toHaveBeenCalledWith('aborted')
  })

  it('reports non-abort errors through canonical emitter when available', async () => {
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('boom'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(harness._spies.setError).toHaveBeenCalledWith('boom')
    expect(harness._spies.emitCanonicalUiMessage).toHaveBeenCalledWith({
      role: 'assistant',
      content: 'ERR:boom',
      uiKind: 'command_subline',
    })
  })

  it('falls back to legacy transcript error row when canonical emitter is absent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-13T01:00:00.000Z'))
    const harness = createHarness()
    harness.state.emitCanonicalUiMessage = undefined
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('legacy-fail'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    const rows = harness._spies.getMessages()
    expect(rows[rows.length - 1]).toMatchObject({
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'ERR:legacy-fail',
    })
    vi.useRealTimers()
  })

  it('supports plan-mode turn setup with slash llm blocks and existing reminder service', async () => {
    const existingReminderService = {
      generateInjectedBlocks: vi.fn(() => [{ type: 'text', text: 'existing-reminder' }]),
    }
    const harness = createHarness()
    harness.input.slashEffect = {
      kind: 'llm',
      loadingText: 'Plan Thinking',
      blocks: [{ type: 'text', text: 'llm-block' }],
    }
    harness.deps.mode = 'plan'
    harness.deps.planSession = {
      getPlanPath: () => null,
      startNewPlan: () => '/plans/generated.md',
    }
    harness.deps.reminderServiceRef.current = existingReminderService

    vi.mocked(buildTurnInput).mockImplementationOnce((args: any) => {
      expect(args.mode).toBe('plan')
      expect(args.planPath).toBe('/plans/generated.md')
      expect(args.slashLlmBlocks).toEqual([{ type: 'text', text: 'llm-block' }])
      return {
        userBlocks: [{ type: 'text', text: 'user-block' }],
        semanticBlocks: [{ type: 'text', text: 'semantic-block' }],
      } as any
    })
    vi.mocked(maybeRunAutoCompactBeforeTurn).mockImplementationOnce(async (args: any) => {
      expect(args.getPlanPath()).toBeNull()
    })
    harness._spies.engine.runTurn.mockImplementationOnce(async (args: any) => {
      expect(args.exec.getPlanPath()).toBeNull()
      return [
        ...(args.history || []),
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      ]
    })

    const result = await runMainSendTurn(harness)
    expect(result.turnOutcome).toBe('completed')
    expect(harness._spies.setLoadingText).toHaveBeenCalledWith('Plan Thinking')
    expect(existingReminderService.generateInjectedBlocks).toHaveBeenCalledTimes(1)
  })

  it('enables deferred tool exposure in REPL when runtime flag is set', async () => {
    const sessionKey = 'repl-deferred-test'
    getDeferredToolExposureStore().resetSession(sessionKey)

    const harness = createHarness({
      deps: {
        engine: {
          runTurn: vi.fn(async (args: any) => [
            ...(args.history || []),
            args.user,
            { role: 'assistant', content: [{ type: 'text', text: 'assistant' }] },
          ]),
        },
        cfg: createCfg(),
        planSession: {
          getPlanPath: () => '/plans/current.md',
          startNewPlan: () => '/plans/new.md',
        },
        reminderServiceRef: { current: null },
        tools: [{ name: 'Skill' }, { name: 'Read' }],
        runtimeFlags: { deferredToolExposureEnabled: true },
        allowedSubagents: [],
        mode: 'normal',
        getReplMode: () => 'normal',
        setReplMode: vi.fn(),
        handleEvent: vi.fn(),
      },
      refs: {
        historyRef: { current: [] as any[] },
        pendingInjectedBlocksRef: { current: [] as any[] },
        contextBudgetConfigRef: { current: null },
        abortControllerRef: { current: null as AbortController | null },
        assistantBufferRef: { current: '' },
        thinkingBufferRef: { current: '' },
        thinkingLastFlushAtRef: { current: 0 },
        currentAssistantIdRef: { current: null as string | null },
        pendingExitPlanReminderRef: { current: true },
        deferredToolExposureSessionKeyRef: { current: sessionKey },
        sendSeqRef: { current: 0 },
        lastAutoCompactSeqRef: { current: 0 },
        onCompactLifecycle: vi.fn(),
      },
    })

    await runMainSendTurn(harness as any)

    const callArgs = harness.deps.engine.runTurn.mock.calls[0][0]
    expect(callArgs.tools.map((tool: any) => tool.name)).toEqual(['ToolSearch'])
    expect(typeof callArgs.resolveToolsForCall).toBe('function')
    expect(buildSkillToolSpecForCwdWithOptions).toHaveBeenCalledWith(
      expect.any(String),
      { includeAvailableSkillsInDescription: false },
    )
    expect(buildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'deferred_aligned' }),
    )

    const userText = callArgs.user.content
      .map((block: any) => String(block?.text || ''))
      .join('\n')
    expect(userText).toContain('<available-deferred-tools>')
    expect(userText).toContain('The following skills are available for use with the Skill tool:')
    expect(userText).toContain('Read')
    expect(userText).toContain('Skill')

    getDeferredToolExposureStore().searchAndLoad({
      sessionKey,
      query: 'select:Read',
    })
    expect(callArgs.resolveToolsForCall().map((tool: any) => tool.name)).toEqual(['ToolSearch', 'Read'])
  })

  it('uses Thinking fallback for llm slash effect without loadingText', async () => {
    const harness = createHarness()
    harness.input.slashEffect = {
      kind: 'llm',
      loadingText: '',
      blocks: [],
    }

    await runMainSendTurn(harness)

    expect(harness._spies.setLoadingText).toHaveBeenCalledWith('Thinking')
  })

  it('skips strip path when no injected blocks are present', async () => {
    vi.mocked(buildOutputStyleInjectedBlocks).mockReturnValueOnce([] as any)
    vi.mocked(buildTurnInput).mockReturnValueOnce({
      userBlocks: [{ type: 'text', text: 'plain-user' }],
      semanticBlocks: [],
    } as any)
    const harness = createHarness()
    harness.refs.pendingInjectedBlocksRef.current = []
    harness._spies.engine.runTurn.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'plain-user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ])

    await runMainSendTurn(harness)

    expect(harness.refs.historyRef.current[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'plain-user' }],
    })
  })

  it('handles non-Error throws with fallback error text and filters stale assistant placeholders', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-13T02:00:00.000Z'))
    const harness = createHarness()
    harness.state.emitCanonicalUiMessage = undefined
    harness.state.setMessages(() => [
      { id: 'keep-boundary', role: 'assistant', content: '', ui: { kind: 'compact_boundary' } },
      { id: 'drop-empty', role: 'assistant', content: '', ui: { kind: 'command_subline' } },
      { id: 'keep-user', role: 'user', content: 'existing' },
    ])
    harness._spies.engine.runTurn.mockRejectedValueOnce('string-fail')

    const result = await runMainSendTurn(harness)
    expect(result.turnOutcome).toBe('failed')
    expect(harness._spies.setError).toHaveBeenCalledWith('Failed to send message')
    const rows = harness._spies.getMessages()
    expect(rows.find((row: any) => row.id === 'drop-empty')).toBeUndefined()
    expect(rows.find((row: any) => row.id === 'keep-boundary')).toBeTruthy()
    expect(rows[rows.length - 1]).toMatchObject({
      role: 'assistant',
      content: 'ERR:Failed to send message',
    })
    vi.useRealTimers()
  })

  it('keeps history unchanged when strip target row is missing or too short', async () => {
    const harnessMissing = createHarness()
    harnessMissing.refs.historyRef.current = [{ role: 'assistant', content: [{ type: 'text', text: 'pre' }] }]
    harnessMissing.refs.pendingInjectedBlocksRef.current = [{ type: 'text', text: 'inj' }]
    harnessMissing._spies.engine.runTurn.mockResolvedValueOnce([
      { role: 'assistant', content: [{ type: 'text', text: 'only-assistant' }] },
    ])
    await runMainSendTurn(harnessMissing)
    expect(harnessMissing.refs.historyRef.current).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'only-assistant' }] },
    ])

    const harnessShort = createHarness()
    harnessShort.refs.pendingInjectedBlocksRef.current = [{ type: 'text', text: 'inj' }]
    harnessShort._spies.engine.runTurn.mockResolvedValueOnce([
      { role: 'user', content: [{ type: 'text', text: 'inj' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ])
    await runMainSendTurn(harnessShort)
    expect(harnessShort.refs.historyRef.current[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'inj' }],
    })
  })

  it('uses null planPath in plan mode when plan session is unavailable', async () => {
    const harness = createHarness()
    harness.deps.mode = 'plan'
    harness.deps.planSession = null

    vi.mocked(buildTurnInput).mockImplementationOnce((args: any) => {
      expect(args.planPath).toBeNull()
      return {
        userBlocks: [{ type: 'text', text: 'user-block' }],
        semanticBlocks: [{ type: 'text', text: 'semantic-block' }],
      } as any
    })

    const result = await runMainSendTurn(harness)
    expect(result.turnOutcome).toBe('completed')
  })

  it('uses null planPath in normal mode when plan session is unavailable', async () => {
    const harness = createHarness()
    harness.deps.mode = 'normal'
    harness.deps.planSession = null

    vi.mocked(buildTurnInput).mockImplementationOnce((args: any) => {
      expect(args.planPath).toBeNull()
      return {
        userBlocks: [{ type: 'text', text: 'user-block' }],
        semanticBlocks: [{ type: 'text', text: 'semantic-block' }],
      } as any
    })

    const result = await runMainSendTurn(harness)
    expect(result.turnOutcome).toBe('completed')
  })
})
