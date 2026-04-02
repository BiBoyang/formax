import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createContextCompressionService } from './contextCompressionService'
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

vi.mock('../shared/utils', async () => {
  const actual = await vi.importActual<object>('../shared/utils')
  return {
    ...actual,
    countNonToolUserTurns: vi.fn(),
  }
})

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

function createService(overrides?: Record<string, unknown>) {
  const handleEvent = vi.fn()
  const service = createContextCompressionService({
    cfg: createCfg(),
    engine: { runTurn: vi.fn() } as any,
    mode: 'normal',
    getReplMode: () => 'normal',
    setReplMode: vi.fn(),
    getPlanPath: () => null,
    cwd: '/tmp',
    signal: new AbortController().signal,
    promptBudget: null,
    model: 'claude-3-5-sonnet-latest',
    thinkingEnabled: true,
    handleEvent,
    onCompactLifecycle: vi.fn(),
    ...(overrides || {}),
  })

  return { service, handleEvent }
}

function assistantToolUse(id: string, name: string, input: Record<string, unknown>): any {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input }],
  }
}

function userToolResult(id: string, content: string): any {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }],
  }
}

describe('createContextCompressionService', () => {
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
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(runCompactFlow).mockResolvedValue({
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }],
      summary: 'summary',
    } as any)
  })

  it('skips auto-compact when guard conditions are not met and still prepares the turn', async () => {
    const cases = [
      {
        name: 'disabled',
        service: createService({
          cfg: createCfg({
            context: {
              enableAutoCompact: false,
              autoCompactMinTurnsBetweenRuns: 2,
              compactKeepLastTurns: 3,
              effectiveContextWindowPercent: 0.9,
              autoCompactLimitPercent: 0.85,
              baselineTokens: 1000,
            },
          }),
        }).service,
        args: { contextWindowTokens: 100_000, sendSeq: 10, lastAutoCompactSeqRef: { current: 0 }, history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }], user: { role: 'user', content: [{ type: 'text', text: 'next' }] }, system: [{ type: 'text', text: 'sys' }] },
      },
      {
        name: 'no-window',
        service: createService().service,
        args: { contextWindowTokens: undefined, sendSeq: 10, lastAutoCompactSeqRef: { current: 0 }, history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }], user: { role: 'user', content: [{ type: 'text', text: 'next' }] }, system: [{ type: 'text', text: 'sys' }] },
      },
      {
        name: 'empty-history',
        service: createService().service,
        args: { contextWindowTokens: 100_000, sendSeq: 10, lastAutoCompactSeqRef: { current: 0 }, history: [], user: { role: 'user', content: [{ type: 'text', text: 'next' }] }, system: [{ type: 'text', text: 'sys' }] },
      },
      {
        name: 'too-few-turns',
        service: createService().service,
        args: { contextWindowTokens: 100_000, sendSeq: 10, lastAutoCompactSeqRef: { current: 0 }, history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }], user: { role: 'user', content: [{ type: 'text', text: 'next' }] }, system: [{ type: 'text', text: 'sys' }] },
        beforeRun: () => vi.mocked(countNonToolUserTurns).mockReturnValueOnce(1),
      },
      {
        name: 'cooldown',
        service: createService().service,
        args: { contextWindowTokens: 100_000, sendSeq: 3, lastAutoCompactSeqRef: { current: 2 }, history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }], user: { role: 'user', content: [{ type: 'text', text: 'next' }] }, system: [{ type: 'text', text: 'sys' }] },
      },
    ]

    for (const testCase of cases) {
      testCase.beforeRun?.()
      const out = await testCase.service.prepareHistoryForTurn(testCase.args as any)
      expect(out.autoCompacted, testCase.name).toBe(false)
      expect(out.showAutoCompactNotice, testCase.name).toBe(false)
      if (testCase.args.contextWindowTokens === undefined) {
        expect(out.context, testCase.name).toBeNull()
      } else {
        expect(out.context, testCase.name).toEqual({
          usedTokens: 1234,
          limitTokens: 9000,
          percentRemaining: 86,
          source: 'estimate',
        })
      }
    }

    expect(runCompactFlow).not.toHaveBeenCalled()
  })

  it('auto-compacts, updates sequence state, and re-prunes before returning prepared history', async () => {
    vi.mocked(pruneForPromptBudget)
      .mockReturnValueOnce({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'after-auto' }] }],
        pruned: true,
      } as any)
      .mockReturnValueOnce({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'after-final' }] }],
        pruned: true,
      } as any)

    const { service } = createService()
    const lastAutoCompactSeqRef = { current: 0 }
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef,
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(runCompactFlow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runCompactFlow).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        source: 'auto',
        keepLastTurns: 3,
      }),
    )
    expect(lastAutoCompactSeqRef.current).toBe(10)
    expect(out.autoCompacted).toBe(true)
    expect(out.showAutoCompactNotice).toBe(true)
    expect(out.history).toEqual([])
    expect(out.user).toEqual({ role: 'user', content: [{ type: 'text', text: 'after-final' }] })
    expect(out.context).toEqual({
      usedTokens: 1234,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('microcompacts old heavy tool results before auto-compact is decided', async () => {
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      return serialized.includes('[Older tool result cleared by microcompact:') ? 800 : 2200
    })
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 9000,
      autoCompactLimitTokens: 1500,
      percentRemaining: 86,
      shouldAutoCompact: usedTokens >= 1500,
    }))

    const { service } = createService()
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [
        assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
        userToolResult('read-1', 'a'.repeat(4000)),
        assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
        userToolResult('read-2', 'b'.repeat(4000)),
        assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
        userToolResult('read-3', 'c'.repeat(4000)),
        assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
        userToolResult('read-4', 'd'.repeat(4000)),
      ],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(runCompactFlow).not.toHaveBeenCalled()
    expect(out.history[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'read-1',
          content: '[Older tool result cleared by microcompact: Read /repo/src/a.ts]',
        },
      ],
    })
    expect(out.context).toEqual({
      usedTokens: 800,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('swallows auto-compact failures and keeps turn preparation best-effort', async () => {
    vi.mocked(runCompactFlow).mockRejectedValueOnce(new Error('compact failed'))

    const { service } = createService()
    const lastAutoCompactSeqRef = { current: 0 }
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef,
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(lastAutoCompactSeqRef.current).toBe(0)
    expect(out.autoCompacted).toBe(false)
    expect(out.history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'h1' }] }])
    expect(out.user).toEqual({ role: 'user', content: [{ type: 'text', text: 'next' }] })
    expect(out.context).toEqual({
      usedTokens: 1234,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('runs manual compact with keepLastTurns=0, forwards usage events, and prunes the result', async () => {
    vi.mocked(pruneForPromptBudget).mockReturnValueOnce({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'manual-pruned' }] }],
      pruned: true,
    } as any)

    const { service, handleEvent } = createService()
    const out = await service.runManualCompact({
      contextWindowTokens: 100_000,
      previousHistory: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      keepLastTurns: 0,
      instructions: 'keep this',
      system: [{ type: 'text', text: 'sys' }],
    })

    const compactArgs = vi.mocked(runCompactFlow).mock.calls[0]?.[0] as any
    compactArgs.onStreamEvent({ type: 'usage', usage: { input_tokens: 1, output_tokens: 2 } })
    compactArgs.onStreamEvent({ type: 'assistant_delta', text: 'ignore' })

    expect(handleEvent).toHaveBeenCalledTimes(1)
    expect(compactArgs).toEqual(
      expect.objectContaining({
        source: 'manual',
        keepLastTurns: 0,
        instructions: 'keep this',
      }),
    )
    expect(out).toEqual({
      summary: 'summary',
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'manual-pruned' }] }],
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
    })
  })

  it('propagates empty-summary style manual compact failures', async () => {
    vi.mocked(runCompactFlow).mockRejectedValueOnce(new Error('Compact failed: empty summary'))

    const { service } = createService()
    await expect(
      service.runManualCompact({
        contextWindowTokens: 100_000,
        previousHistory: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
        keepLastTurns: 0,
        instructions: '',
        system: [{ type: 'text', text: 'sys' }],
      }),
    ).rejects.toThrow('Compact failed: empty summary')
  })

  it('finalizes post-turn history by pruning and refreshing context stats', () => {
    vi.mocked(pruneForPromptBudget).mockReturnValueOnce({
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'post-pruned' }] }],
      pruned: true,
    } as any)

    const { service } = createService()
    const out = service.finalizeHistoryAfterTurn({
      contextWindowTokens: 100_000,
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'full' }] }],
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(out).toEqual({
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'post-pruned' }] }],
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
    })
  })

  it('microcompacts older eligible tool results during post-turn finalization', () => {
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))

    const { service } = createService()
    const out = service.finalizeHistoryAfterTurn({
      contextWindowTokens: 100_000,
      history: [
        assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
        userToolResult('read-1', 'a'.repeat(4000)),
        assistantToolUse('read-2', 'Read', { file_path: '/repo/src/b.ts' }),
        userToolResult('read-2', 'b'.repeat(4000)),
        assistantToolUse('read-3', 'Read', { file_path: '/repo/src/c.ts' }),
        userToolResult('read-3', 'c'.repeat(4000)),
        assistantToolUse('read-4', 'Read', { file_path: '/repo/src/d.ts' }),
        userToolResult('read-4', 'd'.repeat(4000)),
      ],
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(out.history[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'read-1',
          content: '[Older tool result cleared by microcompact: Read /repo/src/a.ts]',
        },
      ],
    })
    expect((out.history[7] as any).content[0].content).toBe('d'.repeat(4000))
  })
})
