import { describe, expect, it, vi } from 'vitest'
import type { RpcNotification } from '../../types'
import { processNotification, type ProcessNotificationContext } from './processNotification'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
} from '../../../../../src/features/semantics/runtime/threadRuntimeState'
import { createReplayTurnEventEnvelope } from './testFixtures/replayFixtures'

function createContext(): ProcessNotificationContext {
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
  }
}

describe('processNotification', () => {
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
    const notification: RpcNotification = {
      jsonrpc: '2.0',
      method: 'turn/event',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        event: { type: 'assistant_delta', text: 'hello' },
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
})
