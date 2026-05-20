import { describe, expect, it, vi } from 'vitest'
import type { RpcNotification } from '../../types'
import { processNotification, type ProcessNotificationContext } from './processNotification'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
} from '../../semantics'
import { createReplayTurnEventEnvelope } from './testFixtures/replayFixtures'

function createContext(overrides: Partial<ProcessNotificationContext> = {}): ProcessNotificationContext {
  return {
    runtimeStateByThreadRef: { current: {} },
    replayCursorByThreadRef: { current: {} },
    activeThreadIdRef: { current: 'thread-1' },
    commandByTurnRef: { current: new Map<string, string>() },
    createInitialThreadRuntimeState,
    shouldProcessSequencedNotification: () => true,
    dispatch: vi.fn(),
    setMode: vi.fn(),
    cacheThreadMode: vi.fn(),
    isReplMode: (value): value is 'normal' | 'acceptEdits' | 'plan' =>
      value === 'normal' || value === 'acceptEdits' || value === 'plan',
    refreshThreads: vi.fn(async () => {}),
    refreshWorkspaceDiff: vi.fn(async () => {}),
    log: vi.fn(),
    setAskDockOpenByInputId: vi.fn(),
    setAskPageIndexByInputId: vi.fn(),
    setAskDraftByInputId: vi.fn(),
    setSubmitStatusByInputId: vi.fn(),
    reduceThreadRuntimeState,
    ...overrides,
  }
}

describe('processNotification', () => {
  it('[invariant:notification-order] skips side effects when sequenced notification is rejected', () => {
    const shouldProcessSequencedNotification = vi.fn(() => false)
    const ctx = createContext({
      shouldProcessSequencedNotification,
    })
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        replaySeq: 18,
        eventId: 'evt-18',
        ts: '2026-02-20T00:00:00.000Z',
        source: 'engine',
        threadId: 'thread-1',
        turn: { id: 'turn-18', threadId: 'thread-1', status: 'completed' },
      },
    }

    processNotification(notification, ctx)

    expect(shouldProcessSequencedNotification).toHaveBeenCalledWith(notification.params)
    expect(ctx.dispatch).not.toHaveBeenCalled()
    expect(ctx.setMode).not.toHaveBeenCalled()
    expect(ctx.refreshThreads).not.toHaveBeenCalled()
    expect(ctx.refreshWorkspaceDiff).not.toHaveBeenCalled()
  })

  it('does not advance runtime semantic state when replaySeq is missing', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/started',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', mode: 'plan', status: 'running' },
      },
    }

    processNotification(notification, ctx)

    expect(ctx.runtimeStateByThreadRef.current['thread-1']).toBeUndefined()
    expect(ctx.setMode).toHaveBeenCalledWith('plan')
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: 'turn-1' })
    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply_canonical_event' }))
  })

  it('applies runtime semantic state when replaySeq exists', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/started',
      params: {
        replaySeq: 7,
        threadId: 'thread-1',
        turn: { id: 'turn-1', threadId: 'thread-1', mode: 'plan', status: 'running' },
      },
    }

    processNotification(notification, ctx)

    const runtimeState = ctx.runtimeStateByThreadRef.current['thread-1']
    expect(runtimeState).toMatchObject({
      threadId: 'thread-1',
      activeTurnId: 'turn-1',
      lastTurnStatus: 'running',
      mode: 'plan',
      lastReplaySeq: 7,
    })
    expect(ctx.replayCursorByThreadRef.current['thread-1']).toBe(7)
  })

  it('skips canonical projection for turn notifications with missing envelope fields', () => {
    const ctx = createContext()
    const baseEnvelope = createReplayTurnEventEnvelope({
      event: { type: 'assistant_delta', text: 'missing envelope fixture case' },
    })
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/event',
      params: {
        threadId: baseEnvelope.threadId,
        turnId: baseEnvelope.turnId,
        event: baseEnvelope.event,
      },
    }

    processNotification(notification, ctx)

    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply_canonical_event' }))
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipped canonical projection for turn/event: missing envelope fields'),
      'warn',
    )
  })

  it('projects canonical events only when turn notification envelope is complete', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/event',
      params: createReplayTurnEventEnvelope({
        event: { type: 'assistant_delta', text: 'hello' },
      }),
    }

    processNotification(notification, ctx)

    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply_canonical_event',
        event: expect.objectContaining({
          kind: 'assistant_delta',
          replaySeq: 11,
          threadId: 'thread-1',
          turnId: 'turn-1',
        }),
      }),
    )
  })

  it('caches latest compact boundary from live turn events', () => {
    const cacheLiveCompactBoundary = vi.fn()
    const ctx = createContext({ cacheLiveCompactBoundary })
    const boundary = {
      schemaVersion: 1,
      trigger: 'auto',
      triggerReason: { kind: 'auto_threshold' },
      preTokens: 2048,
      summaryKind: 'session_memory',
    }
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/event',
      params: createReplayTurnEventEnvelope({
        replaySeq: 13,
        eventId: 'evt-13',
        event: {
          type: 'compact_boundary',
          boundary,
        } as any,
      }),
    }

    processNotification(notification, ctx)

    expect(cacheLiveCompactBoundary).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnId: 'turn-1',
      boundary,
    })
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'apply_canonical_event',
        event: expect.objectContaining({
          kind: 'system_message',
          uiKind: 'compact_boundary',
          compactBoundary: boundary,
        }),
      }),
    )
  })

  it('confirms or clears pending live compact boundaries when the turn ends', () => {
    const commitLiveCompactBoundary = vi.fn()
    const clearLiveCompactBoundary = vi.fn()
    const ctx = createContext({ commitLiveCompactBoundary, clearLiveCompactBoundary })

    processNotification(
      {
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {
          replaySeq: 14,
          eventId: 'evt-14',
          ts: '2026-02-18T00:00:00.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-1', threadId: 'thread-1', status: 'completed' },
        },
      },
      ctx,
    )
    processNotification(
      {
        jsonrpc: '2.0',
        method: 'turn/failed',
        params: {
          replaySeq: 15,
          eventId: 'evt-15',
          ts: '2026-02-18T00:00:01.000Z',
          source: 'engine',
          threadId: 'thread-1',
          turn: { id: 'turn-2', threadId: 'thread-1', status: 'failed' },
          error: 'failed',
        },
      },
      ctx,
    )

    expect(commitLiveCompactBoundary).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
    expect(clearLiveCompactBoundary).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-2' })
  })

  it('skips canonical projection when schemaVersion is invalid and logs invalid fields', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/event',
      params: {
        ...createReplayTurnEventEnvelope({
          replaySeq: 12,
          eventId: 'evt-12',
        }),
        schemaVersion: 99,
      },
    }

    processNotification(notification, ctx)

    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply_canonical_event' }))
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining('invalid envelope fields (schemaVersion)'),
      'warn',
    )
  })

  it('maps turn/completed to canonical finalize events only via adapter when envelope is complete', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        replaySeq: 30,
        eventId: 'evt-30',
        ts: '2026-02-18T00:00:00.000Z',
        source: 'engine',
        threadId: 'thread-1',
        turn: { id: 'turn-30', threadId: 'thread-1', status: 'completed' },
      },
    }

    processNotification(notification, ctx)

    const applyCalls = (ctx.dispatch as any).mock.calls
      .map((call: unknown[]) => call[0])
      .filter((action: { type?: string }) => action?.type === 'apply_canonical_event')
    expect(applyCalls).toHaveLength(2)
    expect(applyCalls[0]).toMatchObject({
      type: 'apply_canonical_event',
      event: expect.objectContaining({
        kind: 'thinking_finalized',
        turnId: 'turn-30',
        replaySeq: 30,
      }),
    })
    expect(applyCalls[1]).toMatchObject({
      type: 'apply_canonical_event',
      event: expect.objectContaining({
        kind: 'turn_footer',
        turnId: 'turn-30',
        replaySeq: 31,
        status: 'completed',
      }),
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: null })
  })

  it('maps turn/failed to canonical finalize events only via adapter when envelope is complete', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/failed',
      params: {
        replaySeq: 40,
        eventId: 'evt-40',
        ts: '2026-02-18T00:00:01.000Z',
        source: 'engine',
        threadId: 'thread-1',
        turn: { id: 'turn-40', threadId: 'thread-1', status: 'failed' },
        error: 'boom',
      },
    }

    processNotification(notification, ctx)

    const applyCalls = (ctx.dispatch as any).mock.calls
      .map((call: unknown[]) => call[0])
      .filter((action: { type?: string }) => action?.type === 'apply_canonical_event')
    expect(applyCalls).toHaveLength(2)
    expect(applyCalls[0]).toMatchObject({
      type: 'apply_canonical_event',
      event: expect.objectContaining({
        kind: 'thinking_finalized',
        turnId: 'turn-40',
        replaySeq: 40,
      }),
    })
    expect(applyCalls[1]).toMatchObject({
      type: 'apply_canonical_event',
      event: expect.objectContaining({
        kind: 'turn_footer',
        turnId: 'turn-40',
        replaySeq: 41,
        status: 'failed',
        message: 'boom',
      }),
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: null })
  })

  it('does not project canonical finalize events for turn/completed when envelope is incomplete', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        replaySeq: 50,
        threadId: 'thread-1',
        turn: { id: 'turn-50', threadId: 'thread-1', status: 'completed' },
      },
    }

    processNotification(notification, ctx)

    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply_canonical_event' }))
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: null })
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipped canonical projection for turn/completed: missing envelope fields'),
      'warn',
    )
  })

  it('does not project canonical finalize events for turn/failed when envelope is incomplete', () => {
    const ctx = createContext()
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/failed',
      params: {
        replaySeq: 51,
        threadId: 'thread-1',
        turn: { id: 'turn-51', threadId: 'thread-1', status: 'failed' },
        error: 'boom',
      },
    }

    processNotification(notification, ctx)

    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply_canonical_event' }))
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: null })
    expect(ctx.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipped canonical projection for turn/failed: missing envelope fields'),
      'warn',
    )
  })
})
