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
})
