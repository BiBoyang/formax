import { describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../../../../chat/engine'
import { runCompactFlow } from './compactFlow'

function baseArgs(overrides?: Partial<Parameters<typeof runCompactFlow>[0]>): Parameters<typeof runCompactFlow>[0] {
  return {
    source: 'manual',
    instructions: 'Keep the key decisions and outcomes.',
    engine: {
      runTurn: vi.fn(),
    } as any,
    previousHistory: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] as ChatHistory,
    keepLastTurns: 0,
    system: [],
    cwd: '/tmp',
    signal: new AbortController().signal,
    promptBudget: null,
    model: 'model-x',
    thinkingEnabled: true,
    mode: 'normal',
    getReplMode: () => 'normal',
    setReplMode: () => {},
    getPlanPath: () => null,
    onStreamEvent: undefined,
    onLifecycle: undefined,
    ...(overrides || {}),
  }
}

describe('runCompactFlow', () => {
  it('streams compact lifecycle and returns rebuilt summary history', async () => {
    const onStreamEvent = vi.fn()
    const onLifecycle = vi.fn()
    const runTurn = vi.fn(async (args: any) => {
      args.onEvent({ type: 'thinking_delta', delta: 'a' })
      args.onEvent({ type: 'assistant_delta', delta: 'ignored' })
      args.onEvent({ type: 'thinking_stop' })
      args.onEvent({ type: 'usage', usage: { input_tokens: 1, output_tokens: 2 } })
      return [{ role: 'assistant', content: [{ type: 'text', text: '  compact summary  ' }] }] as ChatHistory
    })

    const out = await runCompactFlow(
      baseArgs({
        engine: { runTurn } as any,
        onStreamEvent,
        onLifecycle,
      }),
    )

    expect(out.summary).toBe('compact summary')
    expect(out.compactedHistory.length).toBeGreaterThan(0)
    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary).toMatchObject({
      schemaVersion: 1,
      trigger: 'manual',
      summaryKind: 'model_summary',
      keepStrategy: {
        kind: 'keep_last_turns',
        keepLastTurns: 0,
      },
      rehydrationPlan: {
        schemaVersion: 1,
        items: [{ kind: 'recent_files', priority: 'high', status: 'planned' }],
      },
    })
    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary?.preTokens).toBeGreaterThan(0)
    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary?.preservedSegment).toEqual({
      schemaVersion: 1,
      continuationMessageCount: 1,
      preservedTailMessageCount: 0,
      summaryFingerprint: expect.any(String),
      headFingerprint: null,
      tailFingerprint: null,
    })
    expect(onLifecycle).toHaveBeenNthCalledWith(1, { type: 'compact_started', source: 'manual' })
    expect(onLifecycle).toHaveBeenNthCalledWith(2, { type: 'compact_succeeded', source: 'manual' })
    expect(onStreamEvent.mock.calls.map((call) => call[0].type)).toEqual(['thinking_delta', 'thinking_stop', 'usage'])
  })

  it('emits compact_failed lifecycle when summary is empty', async () => {
    const onLifecycle = vi.fn()

    await expect(
      runCompactFlow(
        baseArgs({
          engine: {
            runTurn: vi.fn(async () => [{ role: 'assistant', content: [{ type: 'text', text: '   ' }] }] as ChatHistory),
          } as any,
          onLifecycle,
        }),
      ),
    ).rejects.toThrow('Compact failed: empty summary')

    expect(onLifecycle).toHaveBeenNthCalledWith(1, { type: 'compact_started', source: 'manual' })
    expect(onLifecycle).toHaveBeenNthCalledWith(2, {
      type: 'compact_failed',
      source: 'manual',
      error: 'Compact failed: empty summary',
    })
  })

  it('uses generic failure message for non-Error throws and tolerates missing stream sink', async () => {
    const onLifecycle = vi.fn()
    await expect(
      runCompactFlow(
        baseArgs({
          engine: {
            runTurn: vi.fn(async (args: any) => {
              args.onEvent({ type: 'usage', usage: { input_tokens: 1, output_tokens: 1 } })
              throw 'non-error'
            }),
          } as any,
          onStreamEvent: undefined,
          onLifecycle,
        }),
      ),
    ).rejects.toBe('non-error')

    expect(onLifecycle).toHaveBeenNthCalledWith(1, { type: 'compact_started', source: 'manual' })
    expect(onLifecycle).toHaveBeenNthCalledWith(2, {
      type: 'compact_failed',
      source: 'manual',
      error: 'Compact failed',
    })
  })

  it('rehydrates recent Read files into the compact summary and marks them applied', async () => {
    const out = await runCompactFlow(
      baseArgs({
        mode: 'plan',
        getReplMode: () => 'plan',
        getPlanPath: () => '/repo/.formax/plan.md',
        previousHistory: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/auth.ts' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'auth file contents' }],
          },
        ] as ChatHistory,
        engine: {
          runTurn: vi.fn(async () => [{ role: 'assistant', content: [{ type: 'text', text: 'compact summary' }] }] as ChatHistory),
        } as any,
      }),
    )

    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary?.rehydrationPlan).toEqual({
      schemaVersion: 1,
      items: [
        { kind: 'recent_files', priority: 'high', status: 'applied' },
        { kind: 'plan_state', priority: 'high', status: 'applied' },
        { kind: 'mode_state', priority: 'medium', status: 'applied' },
      ],
    })
    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary?.rehydrationCost).toEqual({
      sectionCount: 3,
      estimatedTokens: expect.any(Number),
    })
    expect(((out.compactedHistory[1] as any)?.content?.[0]?.text as string) || '').toContain(
      'Recent files to keep in working memory:',
    )
    expect(((out.compactedHistory[1] as any)?.content?.[0]?.text as string) || '').toContain('/repo/src/auth.ts')
    expect(((out.compactedHistory[1] as any)?.content?.[0]?.text as string) || '').toContain(
      'Mode state to keep in working memory:',
    )
    expect(((out.compactedHistory[1] as any)?.content?.[0]?.text as string) || '').toContain(
      'Plan state to keep in working memory:',
    )
  })

  it('uses keep_combo metadata for auto compact while preserving manual keep_last_turns behavior', async () => {
    const out = await runCompactFlow(
      baseArgs({
        source: 'auto',
        keepLastTurns: 2,
        previousHistory: [
          { role: 'user', content: [{ type: 'text', text: 'u1' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'a'.repeat(2400) }] },
          { role: 'user', content: [{ type: 'text', text: 'u2' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(5200) }] },
          { role: 'user', content: [{ type: 'text', text: 'u3' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'c'.repeat(900) }] },
        ] as ChatHistory,
        engine: {
          runTurn: vi.fn(async () => [{ role: 'assistant', content: [{ type: 'text', text: 'compact summary' }] }] as ChatHistory),
        } as any,
      }),
    )

    expect((out.compactedHistory[0] as any)?.meta?.compactBoundary?.keepStrategy).toEqual({
      kind: 'keep_combo',
      keepLastTurns: 2,
      keepMinTokens: 1200,
      keepMinUserTurns: 1,
    })
    expect((out.compactedHistory[2] as any)?.content?.[0]?.text).toBe('u2')
  })

  it('uses only the latest continuation segment for auto partial compact when a boundary already exists', async () => {
    const runTurn = vi.fn(async () => [{ role: 'assistant', content: [{ type: 'text', text: 'partial summary' }] }] as ChatHistory)
    const existingBoundary = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      meta: {
        compactBoundary: {
          schemaVersion: 1,
          trigger: 'auto',
          preTokens: 600,
          summaryKind: 'model_summary',
          keepStrategy: {
            kind: 'keep_combo',
            keepLastTurns: 2,
            keepMinTokens: 1200,
            keepMinUserTurns: 1,
          },
        },
      },
    } as any

    const out = await runCompactFlow(
      baseArgs({
        source: 'auto',
        keepLastTurns: 1,
        previousHistory: [
          { role: 'user', content: [{ type: 'text', text: 'very old turn' }] },
          existingBoundary,
          { role: 'user', content: [{ type: 'text', text: 'old compact summary' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'carry working set' }] },
          { role: 'user', content: [{ type: 'text', text: 'latest user' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'latest assistant' }] },
        ] as ChatHistory,
        engine: { runTurn } as any,
      }),
    )

    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: 'user', content: [{ type: 'text', text: 'old compact summary' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'carry working set' }] },
          { role: 'user', content: [{ type: 'text', text: 'latest user' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'latest assistant' }] },
        ],
      }),
    )
    expect((out.compactedHistory[1] as any)?.content?.[0]?.text).toContain('partial summary')
    expect((out.compactedHistory[2] as any)?.content?.[0]?.text).toBe('latest user')
    expect((out.compactedHistory[3] as any)?.content?.[0]?.text).toBe('latest assistant')
    expect(JSON.stringify(out.compactedHistory)).not.toContain('very old turn')
    expect(JSON.stringify(out.compactedHistory)).not.toContain('old compact summary')
  })
})
