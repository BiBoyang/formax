import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContextCompressionService } from './contextCompressionService'
import { computeContextStats } from '../../../../chat/context/budget'
import { CACHE_EDITING_BETA_HEADER } from '../../../../chat/context/cacheEditing'
import { estimatePromptTokens } from '../../../../chat/context/estimate'
import { pruneForPromptBudget } from '../../../../chat/context/prune'
import { runCompactFlow } from './compactFlow'
import { readSessionMemoryFile } from '../../sessionSave/sessionMemorySidecar'
import { countNonToolUserTurns } from '../shared/utils'
import { buildCompactBoundaryMessage, buildCompactionSummaryUserText } from '../../../../chat/context/compact'

vi.mock('../../../../chat/context/budget', () => ({
  computeContextBudget: vi.fn((config: any) => ({
    contextWindowTokens: config.contextWindowTokens,
    effectiveLimitTokens: Math.floor(config.contextWindowTokens * (config.effectiveContextWindowPercent ?? 0.95)),
    autoCompactLimitTokens: Math.floor(
      Math.floor(config.contextWindowTokens * (config.effectiveContextWindowPercent ?? 0.95)) *
        (config.autoCompactLimitPercent ?? 0.9),
    ),
  })),
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

vi.mock('../../sessionSave/sessionMemorySidecar', () => ({
  readSessionMemoryFile: vi.fn(),
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
    delete process.env[CACHE_EDITING_BETA_HEADER]
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
    vi.mocked(readSessionMemoryFile).mockResolvedValue(null)
    vi.mocked(runCompactFlow).mockResolvedValue({
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }],
      summary: 'summary',
    } as any)
  })

  afterEach(() => {
    delete process.env[CACHE_EDITING_BETA_HEADER]
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

  it('auto-compacts, updates sequence state, and keeps post-compact terminal prune out of persisted history', async () => {
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
    expect(out.history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }])
    expect(out.collapseState).toEqual({
      applied: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    })
    expect(out.strategyFacts.collapse).toEqual({
      stage: 'collapse',
      role: 'semantic_projection',
      scope: 'request_history_projection',
      disposition: 'skipped',
      terminal: false,
      advisory: true,
      reason: 'no latest compact boundary for request-only collapse',
      inputTokens: 1234,
      outputTokens: 1234,
      applied: false,
      collapsedHeadMessageCount: 0,
      estimatedTokensSaved: 0,
      metadata: null,
    })
    expect(out.user).toEqual({ role: 'user', content: [{ type: 'text', text: 'after-final' }] })
    expect(out.context).toEqual({
      usedTokens: 1234,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('prefers rolling session memory for auto-compact when a session sidecar is available', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'plan',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['tighten the CTA copy'],
        planPath: '/repo/.formax/plan.md',
        planExcerpt: 'Ship memory-first compact',
        todoSummary: '1. finalize compact path',
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        summaryKind: 'model_summary',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 2,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
        rehydrationPlan: {
          schemaVersion: 1,
          items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
        },
      },
    } as any)

    const waitForSessionMemoryFlush = vi.fn().mockResolvedValue(undefined)
    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
      waitForSessionMemoryFlush,
    })
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(waitForSessionMemoryFlush).toHaveBeenCalledWith('/tmp/formax/session.jsonl')
    expect(readSessionMemoryFile).toHaveBeenCalledWith('/tmp/formax/session.jsonl')
    expect(runCompactFlow).not.toHaveBeenCalled()
    expect(out.autoCompacted).toBe(true)
    expect(out.history[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        meta: expect.objectContaining({
          compactBoundary: expect.objectContaining({
            summaryKind: 'session_memory',
            trigger: 'auto',
          }),
        }),
      }),
    )
    expect(out.history[1]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Session memory recap:'),
          }),
        ]),
      }),
    )
  })

  it('uses only the latest continuation segment for session-memory auto compact when a boundary already exists', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'normal',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['tighten the CTA copy'],
        planPath: null,
        planExcerpt: null,
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: 'auto',
        summaryKind: 'model_summary',
        keepStrategy: {
          kind: 'keep_combo',
          keepLastTurns: 1,
          keepMinTokens: 1200,
          keepMinUserTurns: 1,
        },
        rehydrationPlan: null,
      },
    } as any)

    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
    })
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'very old turn' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          meta: {
            compactBoundary: {
              schemaVersion: 1,
              trigger: 'auto',
              preTokens: 2048,
              summaryKind: 'model_summary',
              keepStrategy: {
                kind: 'keep_combo',
                keepLastTurns: 2,
                keepMinTokens: 1200,
                keepMinUserTurns: 1,
              },
            },
          },
        },
        { role: 'user', content: [{ type: 'text', text: 'old compact summary' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'carry working set' }] },
        { role: 'user', content: [{ type: 'text', text: 'latest user' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'latest assistant' }] },
      ] as any,
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(out.autoCompacted).toBe(true)
    expect(JSON.stringify(out.history)).not.toContain('very old turn')
    expect(JSON.stringify(out.history)).not.toContain('old compact summary')
    expect(JSON.stringify(out.history)).toContain('latest user')
    expect(JSON.stringify(out.history)).toContain('latest assistant')
  })

  it('reactively compacts with source=reactive when session memory is unavailable and keeps terminal prune request-only', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue(null)
    vi.mocked(pruneForPromptBudget).mockReturnValue({
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] },
        { role: 'user', content: [{ type: 'text', text: 'reactive-user' }] },
      ],
      pruned: true,
    } as any)

    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
    })
    const out = await service.runReactiveCompact({
      contextWindowTokens: 100_000,
      previousHistory: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(runCompactFlow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runCompactFlow).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        source: 'reactive',
        keepLastTurns: 3,
      }),
    )
    expect(vi.mocked(runCompactFlow).mock.calls[0]?.[0]).not.toHaveProperty('onStreamEvent')
    expect(out.history).toEqual([{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }])
    expect(out.requestHistory).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'reactive-summary' }] },
    ])
    expect(out.user).toEqual({ role: 'user', content: [{ type: 'text', text: 'reactive-user' }] })
  })

  it('applies the same request-time collapse on reactive retry preparation', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue(null)
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      if (serialized.includes('Older continuation collapsed for this request only.')) return 700
      if (serialized.includes('Older analysis Older analysis')) return 3200
      return 2400
    })
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 9000,
      autoCompactLimitTokens: 8500,
      percentRemaining: 74,
      shouldAutoCompact: false,
    }))
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(runCompactFlow).mockResolvedValue({
      compactedHistory: [
        buildCompactBoundaryMessage({
          trigger: 'reactive',
          preTokens: 4096,
          summaryKind: 'model_summary',
          keepStrategy: {
            kind: 'keep_combo',
            keepLastTurns: 2,
            keepMinTokens: 1200,
            keepMinUserTurns: 1,
          },
        }),
        { role: 'user', content: [{ type: 'text', text: buildCompactionSummaryUserText('Earlier compact summary') }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Older analysis '.repeat(300) }] },
        assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
        userToolResult('read-1', 'line\n'.repeat(800)),
        { role: 'user', content: [{ type: 'text', text: 'Investigate auth redirect regression carefully.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'carry latest working set' }] },
        { role: 'user', content: [{ type: 'text', text: 'Patch redirect without changing unrelated flows.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'latest assistant state' }] },
      ],
      summary: 'summary',
    } as any)

    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
    })
    const out = await service.runReactiveCompact({
      contextWindowTokens: 100_000,
      previousHistory: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
      triggerReason: { kind: 'reactive_error', detail: 'context limit' },
    })

    expect(JSON.stringify(out.history)).toContain('Older analysis')
    expect(JSON.stringify(out.requestHistory)).toContain('Older continuation collapsed for this request only.')
    expect(out.collapseState).toEqual(
      expect.objectContaining({
        applied: true,
        collapsedHeadMessageCount: expect.any(Number),
        estimatedTokensSaved: expect.any(Number),
        metadata: expect.objectContaining({
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
        }),
      }),
    )
    expect(out.context).toEqual({
      usedTokens: 700,
      limitTokens: 9000,
      percentRemaining: 74,
      source: 'estimate',
    })
  })

  it('falls back to model-summary auto-compact when session memory is unavailable', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue(null)

    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
    })
    await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(readSessionMemoryFile).toHaveBeenCalledWith('/tmp/formax/session.jsonl')
    expect(runCompactFlow).toHaveBeenCalledTimes(1)
  })

  it('falls back to model-summary auto-compact when the session memory sidecar shape is invalid', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue({ schemaVersion: 1 } as any)

    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
    })
    await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(runCompactFlow).toHaveBeenCalledTimes(1)
  })

  it('emits a failed lifecycle event before falling back when session-memory rebuild breaks after start', async () => {
    vi.mocked(readSessionMemoryFile).mockResolvedValue({
      schemaVersion: 1,
      durableFacts: {
        workspaceRoot: '/repo',
        projectMemoryPath: '/repo/.formax/memory/MEMORY.md',
      },
      activeTask: {
        mode: 'normal',
        recentFiles: ['/repo/src/session.ts'],
        recentUserPrompts: ['tighten CTA copy'],
        planPath: null,
        planExcerpt: null,
        todoSummary: null,
      },
      currentStrategy: {
        lastCompactTrigger: null,
        summaryKind: null,
        keepStrategy: null,
        rehydrationPlan: null,
      },
    } as any)

    let shouldThrowAfterLifecycleStart = false
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      if (Array.isArray(messages) && messages.length === 1 && shouldThrowAfterLifecycleStart) {
        shouldThrowAfterLifecycleStart = false
        throw new Error('pre-token failed')
      }
      return 1234
    })

    const onCompactLifecycle = vi.fn((ev: any) => {
      if (ev?.type === 'compact_started' && ev?.source === 'auto') {
        shouldThrowAfterLifecycleStart = true
      }
    })
    const { service } = createService({
      getSessionFilePath: () => '/tmp/formax/session.jsonl',
      onCompactLifecycle,
    })
    await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [{ role: 'user', content: [{ type: 'text', text: 'h1' }] }],
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(onCompactLifecycle).toHaveBeenNthCalledWith(1, { type: 'compact_started', source: 'auto' })
    expect(onCompactLifecycle).toHaveBeenNthCalledWith(2, {
      type: 'compact_failed',
      source: 'auto',
      error: 'pre-token failed',
    })
    expect(runCompactFlow).toHaveBeenCalledTimes(1)
  })

  it('does not content-stub old heavy tool results before auto-compact without cache editing', async () => {
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      return serialized.includes('[Older tool result cleared by microcompact:') ? 800 : 7000
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

    expect(runCompactFlow).toHaveBeenCalledTimes(1)
    expect((out.history[0] as any).content[0].text).toBe('compacted')
    expect((out.requestHistory[0] as any).content[0].text).toBe('compacted')
    expect(out.context).toEqual({
      usedTokens: 7000,
      limitTokens: 9000,
      percentRemaining: 86,
      source: 'estimate',
    })
  })

  it('keeps request history unchanged by microcompact without cache editing across pressure tiers', async () => {
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 10_000,
      autoCompactLimitTokens: 9_000,
      percentRemaining: 50,
      shouldAutoCompact: false,
    }))

    const history = [
      assistantToolUse('read-1', 'Read', { file_path: '/repo/src/a.ts' }),
      userToolResult('read-1', 'a'.repeat(4000)),
      assistantToolUse('grep-1', 'Grep', { pattern: 'login', path: '/repo/src' }),
      userToolResult('grep-1', 'b'.repeat(4000)),
      assistantToolUse('glob-1', 'Glob', { pattern: '**/*.ts', path: '/repo/src' }),
      userToolResult('glob-1', 'src/a.ts\nsrc/b.ts\nsrc/c.ts'.repeat(300)),
      assistantToolUse('read-2', 'Read', { file_path: '/repo/src/d.ts' }),
      userToolResult('read-2', 'd'.repeat(4000)),
    ]

    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      if (serialized.includes('pressure=critical')) return 9_500
      if (serialized.includes('pressure=relaxed')) return 3_500
      return serialized.includes('[Older tool result cleared by microcompact:') ? 700 : 1_000
    })

    const { service } = createService({
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

    const relaxed = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history,
      user: { role: 'user', content: [{ type: 'text', text: 'pressure=relaxed' }] },
      system: [{ type: 'text', text: 'sys' }],
    })
    const critical = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 11,
      lastAutoCompactSeqRef: { current: 0 },
      history,
      user: { role: 'user', content: [{ type: 'text', text: 'pressure=critical' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(JSON.stringify(relaxed.history)).not.toContain('Grep "login"')
    expect(JSON.stringify(relaxed.history)).not.toContain('Glob "**/*.ts"')
    expect(JSON.stringify(relaxed.history)).not.toContain('[Older tool result cleared by microcompact:')

    expect((critical.history[1] as any).content[0].content).toBe('a'.repeat(4000))
    expect((critical.history[3] as any).content[0].content).toBe('b'.repeat(4000))
    expect((critical.history[7] as any).content[0].content).toBe('d'.repeat(4000))
    expect((critical.requestHistory[1] as any).content[0].content).toBe('a'.repeat(4000))
    expect((critical.requestHistory[3] as any).content[0].content).toBe('b'.repeat(4000))
    expect((critical.requestHistory[5] as any).content[0].content).toBe('src/a.ts\nsrc/b.ts\nsrc/c.ts'.repeat(300))
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

  it('runs manual compact with keepLastTurns=0, forwards usage events, and returns the canonical persisted compact result', async () => {
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
      compactedHistory: [{ role: 'user', content: [{ type: 'text', text: 'compacted' }] }],
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

  it('finalizes post-turn history via the canonical persisted candidate and refreshes context stats', () => {
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
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'full' }] }],
      context: {
        usedTokens: 1234,
        limitTokens: 9000,
        percentRemaining: 86,
        source: 'estimate',
      },
    })
  })

  it('stamps assistant timestamps for cache-editing main-thread time-based microcompact', () => {
    process.env[CACHE_EDITING_BETA_HEADER] = 'cache-editing-test'
    const { service } = createService({
      cfg: createCfg({
        llm: {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-latest',
          apiKey: '',
          baseUrl: 'https://api.anthropic.com/v1',
          timeoutMs: 60_000,
          thinkingMode: true,
        },
      }),
    })

    const out = service.finalizeHistoryAfterTurn({
      contextWindowTokens: 100_000,
      history: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(out.history[0]?.meta?.timestamp).toEqual(expect.any(String))
  })

  it('keeps microcompact request-only during post-turn finalization', () => {
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      return serialized.includes('[Older tool result cleared by microcompact:') ? 700 : 8_500
    })
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 9_000,
      autoCompactLimitTokens: 8_500,
      percentRemaining: 10,
      shouldAutoCompact: false,
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

    expect((out.history[1] as any).content[0].content).toBe('a'.repeat(4000))
    expect((out.history[7] as any).content[0].content).toBe('d'.repeat(4000))
  })

  it('prepares cache edit plans through the shared turn projection without mutating persisted history', async () => {
    process.env[CACHE_EDITING_BETA_HEADER] = 'cache-editing-test'
    vi.mocked(pruneForPromptBudget).mockImplementation(({ messages }: any) => ({
      messages,
      pruned: false,
    }))
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      return serialized.includes('[Older tool result cleared by microcompact:') ? 700 : 8_500
    })
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 9_000,
      autoCompactLimitTokens: 8_500,
      percentRemaining: 10,
      shouldAutoCompact: false,
    }))

    const { service } = createService({
      cfg: createCfg({
        llm: {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-latest',
          apiKey: '',
          baseUrl: 'https://api.anthropic.com/v1',
          timeoutMs: 60_000,
          thinkingMode: true,
        },
      }),
    })
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

    expect((out.history[1] as any).content[0].content).toBe('a'.repeat(4000))
    expect((out.requestHistory[1] as any).content[0].content).toBe('a'.repeat(4000))
    expect(out.cacheEditPlan?.provider).toBe('anthropic')
    expect(out.cacheEditPlan?.deletes.map((deleteRef) => deleteRef.cacheReference)).toEqual([
      'read-1',
      'read-2',
      'read-3',
    ])
  })

  it('builds a collapsed requestHistory while leaving persisted history unchanged', async () => {
    vi.mocked(computeContextStats).mockImplementation(({ usedTokens }: any) => ({
      contextWindowTokens: 100_000,
      usedTokens,
      effectiveLimitTokens: 9000,
      autoCompactLimitTokens: 8500,
      percentRemaining: 74,
      shouldAutoCompact: false,
    }))
    vi.mocked(estimatePromptTokens).mockImplementation(({ messages }: any) => {
      const serialized = JSON.stringify(messages)
      if (serialized.includes('Older continuation collapsed for this request only.')) return 700
      if (serialized.includes('Older analysis Older analysis')) return 3200
      return 2400
    })

    const compactSummary = buildCompactionSummaryUserText('Earlier compact summary', {
      recentFiles: ['/repo/src/old.ts'],
    })

    const { service } = createService()
    const out = await service.prepareHistoryForTurn({
      contextWindowTokens: 100_000,
      sendSeq: 10,
      lastAutoCompactSeqRef: { current: 0 },
      history: [
        { role: 'user', content: [{ type: 'text', text: 'persisted pre-boundary turn' }] },
        buildCompactBoundaryMessage({
          trigger: 'auto',
          preTokens: 4096,
          summaryKind: 'model_summary',
          keepStrategy: {
            kind: 'keep_combo',
            keepLastTurns: 2,
            keepMinTokens: 1200,
            keepMinUserTurns: 1,
          },
        }),
        { role: 'user', content: [{ type: 'text', text: compactSummary }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Older analysis '.repeat(300) }] },
        assistantToolUse('read-1', 'Read', { file_path: '/repo/src/auth.ts' }),
        userToolResult('read-1', 'line\n'.repeat(800)),
        { role: 'user', content: [{ type: 'text', text: 'Investigate auth redirect regression carefully.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'carry latest working set' }] },
        { role: 'user', content: [{ type: 'text', text: 'Patch redirect without changing unrelated flows.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'latest assistant state' }] },
      ] as any,
      user: { role: 'user', content: [{ type: 'text', text: 'next' }] },
      system: [{ type: 'text', text: 'sys' }],
    })

    expect(JSON.stringify(out.history)).toContain('Older analysis')
    expect(JSON.stringify(out.history)).toContain('Patch redirect without changing unrelated flows.')
    expect(JSON.stringify(out.requestHistory)).toContain('Older continuation collapsed for this request only.')
    expect(out.collapseState).toEqual(
      expect.objectContaining({
        applied: true,
        metadata: expect.objectContaining({
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
        }),
      }),
    )
    expect(out.strategyFacts.collapse).toEqual(
      expect.objectContaining({
        applied: true,
        metadata: expect.objectContaining({
          schemaVersion: 1,
          kind: 'request_recap',
          keepLastTurns: 2,
        }),
      }),
    )
    expect(JSON.stringify(out.requestHistory)).toContain('Patch redirect without changing unrelated flows.')
    expect(JSON.stringify(out.requestHistory)).not.toContain('persisted pre-boundary turn')
    expect(out.requestHistory[0]?.meta?.compactBoundary).toBeUndefined()
    expect(out.context).toEqual({
      usedTokens: 700,
      limitTokens: 9000,
      percentRemaining: 74,
      source: 'estimate',
    })
  })
})
