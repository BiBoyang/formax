import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMainSendTurn } from './sendMainTurn'
import { getKnownContextWindowTokens } from '../../../../chat/context/modelWindow'
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
import { createContextCompressionService } from './contextCompressionService'
import { getDeferredToolExposureStore } from '../../../../tools/runtime/deferredToolExposure'

vi.mock('../../../../chat/context/modelWindow', () => ({
  getKnownContextWindowTokens: vi.fn(),
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

vi.mock('./contextCompressionService', () => ({
  createContextCompressionService: vi.fn(),
}))

const prepareHistoryForTurn = vi.fn()
const finalizeHistoryAfterTurn = vi.fn()
const runReactiveCompact = vi.fn()

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
      onRequestCollapse: vi.fn(),
      onRequestSnip: vi.fn(),
      onReactiveCompact: vi.fn(),
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
    vi.mocked(buildSkillToolSpecForCwdWithOptions).mockReturnValue({ name: 'Skill', patched: true } as any)
    vi.mocked(buildAvailableSkillsSystemReminderText).mockReturnValue(
      '<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- alpha: Alpha skill\n</system-reminder>',
    )
    prepareHistoryForTurn.mockImplementation(async ({ history, user, contextWindowTokens }: any) => ({
      history,
      requestHistory: history,
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        removals: [],
      },
      user,
      context:
        contextWindowTokens === undefined
          ? null
          : {
              usedTokens: 1234,
              limitTokens: 9000,
              percentRemaining: 86,
              source: 'estimate',
            },
      autoCompacted: false,
      showAutoCompactNotice: false,
    }))
    finalizeHistoryAfterTurn.mockImplementation(({ history, contextWindowTokens }: any) => ({
      history,
      context:
        contextWindowTokens === undefined
          ? null
          : {
              usedTokens: 1234,
              limitTokens: 9000,
              percentRemaining: 86,
              source: 'estimate',
            },
    }))
    vi.mocked(createContextCompressionService).mockReturnValue({
      prepareHistoryForTurn,
      finalizeHistoryAfterTurn,
      runReactiveCompact,
      runManualCompact: vi.fn(),
    } as any)
    vi.mocked(formatErrorSubline).mockImplementation((msg: string) => `ERR:${msg}`)
    vi.mocked(isAbortLikeError).mockReturnValue(false)
  })

  it('reactively compacts and retries once when the provider rejects for context overflow', async () => {
    const reactiveCacheEditPlan = {
      provider: 'anthropic' as const,
      deletes: [
        {
          type: 'delete' as const,
          cacheReference: 'reactive-cache-ref',
          toolUseId: 'toolu-reactive',
          toolName: 'Read',
          messageIndex: 0,
          blockIndex: 0,
        },
      ],
    }
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
      cacheEditPlan: reactiveCacheEditPlan,
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 64,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          preservedTailMessageCount: 3,
          retainedCompactSummary: true,
          recentUserPromptCount: 2,
          recentFileCount: 1,
          earlierToolResultBlockCount: 4,
          recapFingerprint: 'abcdef0123456789',
        },
        commit: null,
      },
      reactiveCompactState: {
        applied: true,
        strategy: 'session_memory',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: {
        usedTokens: 900,
        limitTokens: 9000,
        percentRemaining: 90,
        source: 'estimate',
      },
    })
    const harness = createHarness()
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(
        new Error("This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens."),
      )
      .mockResolvedValueOnce([
        { role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] },
        { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'assistant' }] },
      ])

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('completed')
    expect(runReactiveCompact).toHaveBeenCalledWith(
      expect.objectContaining({
        previousHistory: [],
        user: expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([{ type: 'text', text: 'user-block' }]),
        }),
      }),
    )
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(2)
    expect(harness._spies.engine.runTurn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
        requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
        requestUser: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
        cacheEditPlan: reactiveCacheEditPlan,
        user: expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([{ type: 'text', text: 'user-block' }]),
        }),
      }),
    )
    expect(harness._spies.setError).not.toHaveBeenCalledWith(
      "This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens.",
    )
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      metadata: expect.objectContaining({
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
      }),
      commit: null,
    })
    expect(harness.refs.onReactiveCompact).toHaveBeenCalledWith({
      triggerKind: 'maximum_context_length',
      triggerDetail:
        "This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens.",
      strategy: 'session_memory',
    })
  })

  it('replaces the failed request cache edit plan with the reactive compact plan on retry', async () => {
    const initialCacheEditPlan = {
      provider: 'anthropic' as const,
      deletes: [
        {
          type: 'delete' as const,
          cacheReference: 'initial-cache-ref',
          toolUseId: 'toolu-initial',
          toolName: 'Read',
          messageIndex: 0,
          blockIndex: 0,
        },
      ],
    }
    const reactiveCacheEditPlan = {
      provider: 'anthropic' as const,
      deletes: [
        {
          type: 'delete' as const,
          cacheReference: 'reactive-cache-ref',
          toolUseId: 'toolu-reactive',
          toolName: 'Read',
          messageIndex: 0,
          blockIndex: 0,
        },
      ],
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-history' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-request' }] }],
      cacheEditPlan: initialCacheEditPlan,
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'initial-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-history' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request' }] }],
      cacheEditPlan: reactiveCacheEditPlan,
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
      strategyFacts: {},
      reactiveCompactState: {
        applied: true,
        strategy: 'model_summary',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: null,
    })
    const harness = createHarness()
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(new Error('HTTP 413: request too large'))
      .mockResolvedValueOnce([{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }])

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('completed')
    expect(harness._spies.engine.runTurn.mock.calls[0]?.[0].cacheEditPlan).toBe(initialCacheEditPlan)
    expect(harness._spies.engine.runTurn.mock.calls[1]?.[0].cacheEditPlan).toBe(reactiveCacheEditPlan)
    expect(harness._spies.engine.runTurn.mock.calls[1]?.[0].cacheEditPlan).not.toBe(initialCacheEditPlan)
  })

  it('does not run a second reactive compact when the reactive retry also overflows', async () => {
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
      cacheEditPlan: null,
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
      strategyFacts: {},
      reactiveCompactState: {
        applied: true,
        strategy: 'model_summary',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: null,
    })
    const harness = createHarness()
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(new Error('HTTP 413: request too large'))
      .mockRejectedValueOnce(new Error('API Error: 400 prompt is too long after reactive compact'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(2)
    expect(runReactiveCompact).toHaveBeenCalledTimes(1)
    expect(harness._spies.setError).toHaveBeenCalledWith('API Error: 400 prompt is too long after reactive compact')
  })

  it('preserves abort semantics before reactive overflow classification', async () => {
    vi.mocked(isAbortLikeError).mockReturnValueOnce(true)
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('Request aborted after prompt is too long'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('aborted')
    expect(runReactiveCompact).not.toHaveBeenCalled()
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(harness._spies.setError).not.toHaveBeenCalledWith('Request aborted after prompt is too long')
  })

  it('does not reactively compact auth or rate-limit errors even when they mention overflow', async () => {
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(
      new Error('API Error: 429 rate limit exceeded; prompt is too long'),
    )

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(runReactiveCompact).not.toHaveBeenCalled()
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(harness._spies.setError).toHaveBeenCalledWith('API Error: 429 rate limit exceeded; prompt is too long')
  })

  it('drains the pending initial collapse commit before reactive compact on provider overflow', async () => {
    const initialCommit = {
      collapsedRange: { kind: 'model_facing_index_range' as const, startIndex: 0, endIndexExclusive: 3 },
      compactBoundaryFingerprint: 'compact-generation-1',
      recapMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: 'initial recap' }] },
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-prepared' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-request' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          preservedTailMessageCount: 4,
          retainedCompactSummary: true,
          recentUserPromptCount: 2,
          recentFileCount: 1,
          earlierToolResultBlockCount: 0,
          recapFingerprint: 'initial-collapse-fingerprint',
        },
        commit: initialCommit,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'initial-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      strategyFacts: {},
      reactiveCompactState: {
        applied: true,
        strategy: 'model_summary',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: null,
      cacheEditPlan: null,
    })

    const harness = createHarness()
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(new Error('HTTP 413: request too large'))
      .mockResolvedValueOnce([{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }])

    await runMainSendTurn(harness)

    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 96,
      metadata: expect.objectContaining({
        recapFingerprint: 'initial-collapse-fingerprint',
      }),
      commit: initialCommit,
    })
    expect(harness.refs.onRequestCollapse.mock.invocationCallOrder[0]).toBeLessThan(
      runReactiveCompact.mock.invocationCallOrder[0],
    )
  })

  it('keeps reactive overflow retry recoverable when pending collapse drainage fails', async () => {
    const initialCommit = {
      collapsedRange: { kind: 'model_facing_index_range' as const, startIndex: 0, endIndexExclusive: 3 },
      compactBoundaryFingerprint: 'compact-generation-1',
      recapMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: 'initial recap' }] },
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-prepared' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-request' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          preservedTailMessageCount: 4,
          retainedCompactSummary: true,
          recentUserPromptCount: 2,
          recentFileCount: 1,
          earlierToolResultBlockCount: 0,
          recapFingerprint: 'initial-collapse-fingerprint',
        },
        commit: initialCommit,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'initial-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
      cacheEditPlan: null,
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
      strategyFacts: {},
      reactiveCompactState: {
        applied: true,
        strategy: 'model_summary',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: null,
    })
    const harness = createHarness()
    harness.refs.onRequestCollapse.mockRejectedValueOnce(new Error('session write failed'))
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(new Error('HTTP 413: request too large'))
      .mockResolvedValueOnce([{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }])

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('completed')
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith(expect.objectContaining({ commit: initialCommit }))
    expect(runReactiveCompact).toHaveBeenCalledTimes(1)
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(2)
    expect(harness._spies.setError).not.toHaveBeenCalledWith('session write failed')
  })

  it('drains pending collapse but not durable snip when reactive compact fails after initial overflow', async () => {
    const initialCommit = {
      collapsedRange: { kind: 'model_facing_index_range' as const, startIndex: 0, endIndexExclusive: 3 },
      compactBoundaryFingerprint: 'compact-generation-1',
      recapMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: 'initial recap' }] },
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-prepared' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-request' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          recapFingerprint: 'initial-collapse-fingerprint',
        },
        commit: initialCommit,
      },
      snipState: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 80,
        compactBoundaryFingerprint: 'compact-generation-1',
        baseProjectionFingerprint: 'baseline-fp',
        sourceProjectionKind: 'model_facing_baseline',
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'initial-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    runReactiveCompact.mockRejectedValueOnce(new Error('Compact failed: empty summary'))
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('HTTP 413: request too large'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledTimes(1)
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith(expect.objectContaining({ commit: initialCommit }))
    expect(harness.refs.onRequestSnip).not.toHaveBeenCalled()
  })

  it('drains pending collapse but not reactive durable compression when the reactive retry fails', async () => {
    const initialCommit = {
      collapsedRange: { kind: 'model_facing_index_range' as const, startIndex: 0, endIndexExclusive: 3 },
      compactBoundaryFingerprint: 'compact-generation-1',
      recapMessage: { role: 'user' as const, content: [{ type: 'text' as const, text: 'initial recap' }] },
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-prepared' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'initial-request' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          recapFingerprint: 'initial-collapse-fingerprint',
        },
        commit: initialCommit,
      },
      snipState: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 80,
        compactBoundaryFingerprint: 'compact-generation-1',
        baseProjectionFingerprint: 'baseline-fp',
        sourceProjectionKind: 'model_facing_baseline',
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'initial-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    runReactiveCompact.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'reactive-request-summary' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 64,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          recapFingerprint: 'reactive-collapse-fingerprint',
        },
        commit: {
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
          compactBoundaryFingerprint: 'compact-generation-2',
          recapMessage: { role: 'user', content: [{ type: 'text', text: 'reactive recap' }] },
        },
      },
      snipState: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 70,
        compactBoundaryFingerprint: 'compact-generation-2',
        baseProjectionFingerprint: 'reactive-baseline-fp',
        sourceProjectionKind: 'model_facing_baseline',
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      strategyFacts: {},
      reactiveCompactState: {
        applied: true,
        strategy: 'model_summary',
      },
      user: { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      context: null,
      cacheEditPlan: null,
    })
    const harness = createHarness()
    harness._spies.engine.runTurn
      .mockRejectedValueOnce(new Error('HTTP 413: request too large'))
      .mockRejectedValueOnce(new Error('provider failed after reactive compact'))

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledTimes(1)
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith(expect.objectContaining({ commit: initialCommit }))
    expect(harness.refs.onRequestSnip).not.toHaveBeenCalled()
  })

  it('surfaces the original provider overflow error when reactive compact itself fails', async () => {
    runReactiveCompact.mockRejectedValueOnce(new Error('Compact failed: empty summary'))
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(
      new Error("This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens."),
    )

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('failed')
    expect(harness._spies.engine.runTurn).toHaveBeenCalledTimes(1)
    expect(harness._spies.setError).toHaveBeenCalledWith(
      "This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens.",
    )
  })

  it('preserves abort semantics when the reactive compact attempt is cancelled', async () => {
    vi.mocked(isAbortLikeError)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    runReactiveCompact.mockRejectedValueOnce(new Error('Request aborted'))
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(
      new Error("This model's maximum context length is 200000 tokens. However, your messages resulted in 214528 tokens."),
    )

    const result = await runMainSendTurn(harness)

    expect(result.turnOutcome).toBe('aborted')
    expect(harness._spies.setError).not.toHaveBeenCalledWith('Request aborted')
  })

  it('runs a successful main turn with patched tools and context updates', async () => {
    const harness = createHarness()
    const result = await runMainSendTurn(harness)

    expect(result).toEqual({
      userMessageId: 'user-id',
      turnOutcome: 'completed',
    })
    expect(createContextCompressionService).toHaveBeenCalledTimes(1)
    expect(prepareHistoryForTurn).toHaveBeenCalledTimes(1)
    expect(finalizeHistoryAfterTurn).toHaveBeenCalledTimes(1)
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

  it('prepares dynamic runtime tools before resolving tools for the current turn', async () => {
    const tools = [{ name: 'Skill' }, { name: 'Read' }]
    const engine = {
      prepareTurn: vi.fn(async () => {
        tools.push({ name: 'mcp__github__create_issue' })
      }),
      runTurn: vi.fn(async (args: any) => [
        ...(args.history || []),
        args.user,
        { role: 'assistant', content: [{ type: 'text', text: 'assistant' }] },
      ]),
    }
    const harness = createHarness({
      deps: {
        ...createHarness().deps,
        engine,
        tools,
      },
    })

    await runMainSendTurn(harness as any)

    expect(engine.prepareTurn).toHaveBeenCalledTimes(1)
    expect(engine.runTurn.mock.calls[0][0].tools.map((tool: any) => tool.name)).toEqual([
      'Skill',
      'Read',
      'mcp__github__create_issue',
    ])
  })

  it('passes prepared requestHistory separately from persisted history into engine.runTurn', async () => {
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'request-projection' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          preservedTailMessageCount: 4,
          retainedCompactSummary: true,
          recentUserPromptCount: 2,
          recentFileCount: 1,
          earlierToolResultBlockCount: 5,
          recapFingerprint: 'abcdef0123456789',
        },
        commit: null,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()

    await runMainSendTurn(harness as any)

    expect(harness._spies.engine.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted-summary' }] }],
        requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'request-projection' }] }],
        requestUser: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
        user: expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([{ type: 'text', text: 'user-block' }]),
        }),
      }),
    )
    expect(harness.refs.onRequestCollapse).toHaveBeenCalledWith({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 96,
      metadata: expect.objectContaining({
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
      }),
      commit: null,
    })
  })

  it('records request snip after a successful initial turn', async () => {
    const snipState = {
      applied: true,
      removedMessageCount: 1,
      estimatedTokensSaved: 120,
      compactBoundaryFingerprint: 'compact-generation',
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline' as const,
      removals: [
        {
          kind: 'model_facing_index_range' as const,
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'request snip removed older assistant text message',
          removedMessageFingerprints: ['removed-fp'],
        },
      ],
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'request-projection' }] }],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      snipState,
      user: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()

    await runMainSendTurn(harness as any)

    expect(harness.refs.onRequestSnip).toHaveBeenCalledWith({
      phase: 'initial',
      state: snipState,
    })
  })

  it('records request snip before the dependent request collapse fact', async () => {
    const snipState = {
      applied: true,
      removedMessageCount: 1,
      estimatedTokensSaved: 120,
      compactBoundaryFingerprint: 'compact-generation',
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline' as const,
      removals: [
        {
          kind: 'model_facing_index_range' as const,
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'request snip removed older assistant text message',
          removedMessageFingerprints: ['removed-fp'],
        },
      ],
    }
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'persisted-summary' }] }],
      requestHistory: [{ role: 'assistant', content: [{ type: 'text', text: 'request-projection' }] }],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 3,
        estimatedTokensSaved: 96,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
          recapFingerprint: 'abcdef0123456789',
        },
        commit: {
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
          compactBoundaryFingerprint: 'compact-generation',
          recapMessage: { role: 'assistant', content: [{ type: 'text', text: 'recap' }] },
        },
      },
      snipState,
      user: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()

    await runMainSendTurn(harness as any)

    expect(harness.refs.onRequestSnip.mock.invocationCallOrder[0]).toBeLessThan(
      harness.refs.onRequestCollapse.mock.invocationCallOrder[0],
    )
  })

  it('does not record request compression facts when the initial turn fails', async () => {
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 120,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
        },
        commit: null,
      },
      snipState: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 80,
        compactBoundaryFingerprint: 'compact-generation',
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('provider failed'))

    const result = await runMainSendTurn(harness as any)

    expect(result.turnOutcome).toBe('failed')
    expect(harness.refs.onRequestCollapse).not.toHaveBeenCalled()
    expect(harness.refs.onRequestSnip).not.toHaveBeenCalled()
  })

  it('does not record request compression facts when the initial turn is aborted', async () => {
    vi.mocked(isAbortLikeError).mockReturnValueOnce(true)
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: true,
        collapsedHeadMessageCount: 2,
        estimatedTokensSaved: 120,
        metadata: {
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
        },
        commit: null,
      },
      snipState: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 80,
        compactBoundaryFingerprint: 'compact-generation',
        removals: [{ kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 1 }],
      },
      user: { role: 'user', content: [{ type: 'text', text: 'prepared-user' }] },
      context: null,
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()
    harness._spies.engine.runTurn.mockRejectedValueOnce(new Error('aborted'))

    const result = await runMainSendTurn(harness as any)

    expect(result.turnOutcome).toBe('aborted')
    expect(harness.refs.onRequestCollapse).not.toHaveBeenCalled()
    expect(harness.refs.onRequestSnip).not.toHaveBeenCalled()
  })

  it('keeps terminal-pruned current user request-only while persisting the original user message', async () => {
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'request-fit-user' }] },
      context: {
        usedTokens: 8900,
        limitTokens: 9000,
        percentRemaining: 1,
        source: 'estimate',
      },
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()

    await runMainSendTurn(harness as any)

    const callArgs = harness._spies.engine.runTurn.mock.calls[0]?.[0]
    expect(callArgs.requestUser).toEqual({ role: 'user', content: [{ type: 'text', text: 'request-fit-user' }] })
    expect(callArgs.user.content).toEqual([
      { type: 'text', text: 'reminder' },
      { type: 'text', text: 'style-block' },
      { type: 'text', text: 'semantic-block' },
      { type: 'text', text: 'user-block' },
    ])
    expect(harness.refs.historyRef.current[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'user-block' }],
    })
    expect(JSON.stringify(harness.refs.historyRef.current)).not.toContain('request-fit-user')
  })

  it('keeps request-only injected blocks out of persisted history after request user force-fit', async () => {
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'force-fit-without-injected-blocks' }] },
      context: {
        usedTokens: 8990,
        limitTokens: 9000,
        percentRemaining: 1,
        source: 'estimate',
      },
      autoCompacted: false,
      showAutoCompactNotice: false,
    })
    const harness = createHarness()
    harness.refs.pendingInjectedBlocksRef.current = [{ type: 'text', text: 'pending-restore-only' }]

    await runMainSendTurn(harness as any)

    const callArgs = harness._spies.engine.runTurn.mock.calls[0]?.[0]
    expect(JSON.stringify(callArgs.requestUser)).toContain('force-fit-without-injected-blocks')
    expect(JSON.stringify(callArgs.user)).toContain('pending-restore-only')
    expect(harness.refs.historyRef.current[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'user-block' }],
    })
    expect(JSON.stringify(harness.refs.historyRef.current)).not.toContain('pending-restore-only')
    expect(JSON.stringify(harness.refs.historyRef.current)).not.toContain('force-fit-without-injected-blocks')
  })

  it('emits auto-compact notice only when prepare step reports it should be shown', async () => {
    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'user-block' }] },
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
      autoCompacted: true,
      showAutoCompactNotice: true,
    })
    const harness = createHarness()

    await runMainSendTurn(harness)

    expect(harness._spies.emitCanonicalUiMessage).toHaveBeenCalledWith({
      role: 'assistant',
      content: 'Conversation history auto-compacted (summary kept for future turns).',
      uiKind: 'command_subline',
    })

    prepareHistoryForTurn.mockResolvedValueOnce({
      history: [],
      requestHistory: [],
      collapseState: {
        applied: false,
        collapsedHeadMessageCount: 0,
        estimatedTokensSaved: 0,
        metadata: null,
        commit: null,
      },
      user: { role: 'user', content: [{ type: 'text', text: 'user-block' }] },
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
      autoCompacted: true,
      showAutoCompactNotice: false,
    })
    const harnessWithoutNotice = createHarness()

    await runMainSendTurn(harnessWithoutNotice)

    expect(harnessWithoutNotice._spies.emitCanonicalUiMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Conversation history auto-compacted (summary kept for future turns).',
      }),
    )
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
    expect(prepareHistoryForTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        contextWindowTokens: undefined,
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
    expect(runReactiveCompact).not.toHaveBeenCalled()
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
    vi.mocked(createContextCompressionService).mockImplementationOnce((args: any) => {
      expect(args.getPlanPath()).toBeNull()
      return {
        prepareHistoryForTurn,
        finalizeHistoryAfterTurn,
        runReactiveCompact,
        runManualCompact: vi.fn(),
      } as any
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
    expect(existingReminderService.generateInjectedBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ includeAutoMemory: false }),
    )
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

  it('passes includeAutoMemory=true to reminder injection when deferred exposure is enabled', async () => {
    const existingReminderService = {
      generateInjectedBlocks: vi.fn(() => [{ type: 'text', text: 'existing-reminder' }]),
    }
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
        reminderServiceRef: { current: existingReminderService },
        tools: [{ name: 'Skill' }, { name: 'Read' }],
        runtimeFlags: { deferredToolExposureEnabled: true },
        allowedSubagents: [],
        mode: 'normal',
        getReplMode: () => 'normal',
        setReplMode: vi.fn(),
        handleEvent: vi.fn(),
      },
    })

    await runMainSendTurn(harness as any)

    expect(existingReminderService.generateInjectedBlocks).toHaveBeenCalledTimes(1)
    expect(existingReminderService.generateInjectedBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ includeAutoMemory: true }),
    )
  })

  it('filters REPL tool exposure from FORMAX_ALLOWED_TOOLS/FORMAX_DISABLED_TOOLS env', async () => {
    const prevAllowed = process.env.FORMAX_ALLOWED_TOOLS
    const prevDisabled = process.env.FORMAX_DISABLED_TOOLS
    process.env.FORMAX_ALLOWED_TOOLS = 'Read,Write'
    process.env.FORMAX_DISABLED_TOOLS = 'Write'
    try {
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
          tools: [{ name: 'Read' }, { name: 'Write' }],
          runtimeFlags: { deferredToolExposureEnabled: false },
          allowedSubagents: [],
          mode: 'normal',
          getReplMode: () => 'normal',
          setReplMode: vi.fn(),
          handleEvent: vi.fn(),
        },
      })

      await runMainSendTurn(harness as any)

      const callArgs = harness.deps.engine.runTurn.mock.calls[0][0]
      expect(callArgs.tools.map((tool: any) => tool.name)).toEqual(['Read'])
    } finally {
      if (prevAllowed === undefined) delete process.env.FORMAX_ALLOWED_TOOLS
      else process.env.FORMAX_ALLOWED_TOOLS = prevAllowed
      if (prevDisabled === undefined) delete process.env.FORMAX_DISABLED_TOOLS
      else process.env.FORMAX_DISABLED_TOOLS = prevDisabled
    }
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
