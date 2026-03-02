import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeRunAutoCompactBeforeTurn } from './sendAutoCompact'
import { computeContextStats } from '../../../../chat/context/budget'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import { runCompactFlow } from './compactFlow'
import { countNonToolUserTurns } from '../shared/utils'

vi.mock('../../../../chat/context/budget', () => ({
  computeContextStats: vi.fn(),
}))

vi.mock('../../../../chat/context/estimate', () => ({
  estimatePromptTokens: vi.fn(),
}))

vi.mock('../../../../chat/context/prune', () => ({
  pruneForPromptBudget: vi.fn(),
}))

vi.mock('./compactFlow', () => ({
  runCompactFlow: vi.fn(),
}))

vi.mock('../shared/utils', () => ({
  countNonToolUserTurns: vi.fn(),
}))

function createCfg(overrides?: Record<string, unknown>): any {
  return {
    llm: {
      model: 'claude-3-5-sonnet-latest',
      thinkingMode: true,
    },
    context: {
      enableAutoCompact: true,
      autoCompactMinTurnsBetweenRuns: 2,
      compactKeepLastTurns: 3,
      effectiveContextWindowPercent: 0.9,
      autoCompactTokenLimitPercent: 0.85,
      baselineTokens: 1000,
    },
    ui: {
      showAutoCompactNotice: true,
    },
    ...(overrides || {}),
  }
}

function createArgs(overrides?: Record<string, unknown>): any {
  let messages: any[] = []
  const setMessages = (updater: any) => {
    messages = typeof updater === 'function' ? updater(messages) : updater
  }

  const base = {
    cfg: createCfg(),
    contextWindowTokens: 100_000,
    sendSeq: 10,
    lastAutoCompactSeqRef: { current: 0 },
    historyRef: { current: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }] },
    user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
    system: [{ type: 'text', text: 'sys' }],
    engine: { runTurn: vi.fn() },
    mode: 'normal',
    getReplMode: () => 'normal',
    setReplMode: vi.fn(),
    getPlanPath: () => null,
    cwd: '/tmp',
    signal: new AbortController().signal,
    promptBudget: null,
    handleEvent: vi.fn(),
    onCompactLifecycle: vi.fn(),
    emitCanonicalUiMessage: vi.fn(),
    setMessages,
    _getMessages: () => messages,
  }

  return {
    ...base,
    ...(overrides || {}),
  }
}

describe('maybeRunAutoCompactBeforeTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countNonToolUserTurns).mockReturnValue(3)
    vi.mocked(estimatePromptTokens).mockReturnValue(1234)
    vi.mocked(computeContextStats).mockReturnValue({
      usedTokens: 1234,
      effectiveLimitTokens: 9000,
      percentRemaining: 86,
      shouldAutoCompact: true,
    } as any)
    vi.mocked(runCompactFlow).mockResolvedValue({
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }],
      summary: 'summary',
    } as any)
    vi.mocked(pruneForPromptBudget).mockReturnValue({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'pruned' }] }],
      pruned: true,
    } as any)
  })

  it('returns early when guards are not satisfied', async () => {
    const disabled = createArgs({
      cfg: createCfg({
        context: {
          enableAutoCompact: false,
          autoCompactMinTurnsBetweenRuns: 2,
          compactKeepLastTurns: 3,
          effectiveContextWindowPercent: 0.9,
          autoCompactTokenLimitPercent: 0.85,
          baselineTokens: 1000,
        },
      }),
    })
    await maybeRunAutoCompactBeforeTurn(disabled)
    expect(runCompactFlow).not.toHaveBeenCalled()

    const noWindow = createArgs({ contextWindowTokens: undefined })
    await maybeRunAutoCompactBeforeTurn(noWindow)
    expect(runCompactFlow).not.toHaveBeenCalled()

    const shortHistory = createArgs({ historyRef: { current: [] } })
    await maybeRunAutoCompactBeforeTurn(shortHistory)
    expect(runCompactFlow).not.toHaveBeenCalled()

    vi.mocked(countNonToolUserTurns).mockReturnValueOnce(1)
    const tooFewTurns = createArgs()
    await maybeRunAutoCompactBeforeTurn(tooFewTurns)
    expect(runCompactFlow).not.toHaveBeenCalled()

    const tooSoon = createArgs({
      sendSeq: 3,
      lastAutoCompactSeqRef: { current: 2 },
    })
    await maybeRunAutoCompactBeforeTurn(tooSoon)
    expect(runCompactFlow).not.toHaveBeenCalled()
  })

  it('returns when stats says no auto compact needed', async () => {
    vi.mocked(computeContextStats).mockReturnValueOnce({
      usedTokens: 1234,
      effectiveLimitTokens: 9000,
      percentRemaining: 86,
      shouldAutoCompact: false,
    } as any)

    const args = createArgs()
    await maybeRunAutoCompactBeforeTurn(args)

    expect(estimatePromptTokens).toHaveBeenCalledTimes(1)
    expect(runCompactFlow).not.toHaveBeenCalled()
    expect(args.lastAutoCompactSeqRef.current).toBe(0)
  })

  it('runs compact flow and emits canonical notice when enabled', async () => {
    const args = createArgs()
    await maybeRunAutoCompactBeforeTurn(args)

    expect(runCompactFlow).toHaveBeenCalledTimes(1)
    expect(args.historyRef.current).toEqual([{ role: 'user', content: [{ type: 'text', text: 'pruned' }] }])
    expect(args.lastAutoCompactSeqRef.current).toBe(10)
    expect(args.emitCanonicalUiMessage).toHaveBeenCalledWith({
      role: 'assistant',
      content: 'Conversation history auto-compacted (summary kept for future turns).',
      uiKind: 'command_subline',
    })
    expect(args._getMessages()).toEqual([])
  })

  it('falls back to legacy setMessages path when canonical emitter is not provided', async () => {
    const args = createArgs({
      emitCanonicalUiMessage: undefined,
    })
    await maybeRunAutoCompactBeforeTurn(args)

    const rows = args._getMessages()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'Conversation history auto-compacted (summary kept for future turns).',
    })
  })

  it('swallows compact errors and keeps turn flow running', async () => {
    vi.mocked(runCompactFlow).mockRejectedValueOnce(new Error('compact failed'))

    const args = createArgs()
    await expect(maybeRunAutoCompactBeforeTurn(args)).resolves.toBeUndefined()
    expect(args.lastAutoCompactSeqRef.current).toBe(0)
    expect(args._getMessages()).toEqual([])
  })

  it('updates history but skips notice when showAutoCompactNotice is disabled', async () => {
    const args = createArgs({
      cfg: createCfg({
        ui: { showAutoCompactNotice: false },
      }),
      emitCanonicalUiMessage: vi.fn(),
    })

    await maybeRunAutoCompactBeforeTurn(args)

    expect(args.historyRef.current).toEqual([{ role: 'user', content: [{ type: 'text', text: 'pruned' }] }])
    expect(args.lastAutoCompactSeqRef.current).toBe(10)
    expect(args.emitCanonicalUiMessage).not.toHaveBeenCalled()
    expect(args._getMessages()).toEqual([])
  })
})
