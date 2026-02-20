import { describe, expect, it, vi } from 'vitest'
import { createTurnEventCursorState } from '../../../turnEventCursor'
import { initializeRuntime } from '../initializeRuntime'
import { createConnectionInitOrchestrator } from './connectionInitOrchestrator'
import { createThreadTransactions } from './threadTransactions'

describe('runtime orchestrator regressions', () => {
  it('reconnects without leaking stale initialization side effects', async () => {
    const eventCursorRef = { current: createTurnEventCursorState(20) }
    const activeThreadIdRef = { current: 'thread-1' as string | null }

    let releaseFirstHandshake: () => void = () => undefined
    const firstHandshake = new Promise<void>((resolve) => {
      releaseFirstHandshake = resolve
    })
    const initializeHandshake = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => {
        await firstHandshake
      })
      .mockImplementation(async () => {})
    const refreshThreads = vi.fn(async () => {})
    const refreshWorkspaceDiff = vi.fn(async () => {})
    const resumeThreadInputs = vi.fn(async () => {})
    const replayThreadEvents = vi.fn(async () => true)

    const orchestrator = createConnectionInitOrchestrator({
      seenEventCap: 20,
      eventCursorRef,
      runInitialize: ({ shouldContinue }) =>
        initializeRuntime({
          initializeHandshake,
          refreshThreads,
          refreshWorkspaceDiff,
          activeThreadIdRef,
          resumeThreadInputs,
          replayThreadEvents,
          shouldContinue,
        }),
      captureError: vi.fn(),
      isCurrentClient: () => true,
    })

    orchestrator.onStatus('connected')
    await vi.waitFor(() => {
      expect(initializeHandshake).toHaveBeenCalledTimes(1)
    })

    orchestrator.onStatus('disconnected')
    orchestrator.onStatus('connected')
    releaseFirstHandshake()

    await vi.waitFor(() => {
      expect(initializeHandshake).toHaveBeenCalledTimes(2)
      expect(refreshThreads).toHaveBeenCalledTimes(1)
      expect(refreshWorkspaceDiff).toHaveBeenCalledTimes(1)
      expect(resumeThreadInputs).toHaveBeenCalledTimes(1)
      expect(replayThreadEvents).toHaveBeenCalledTimes(1)
    })
  })

  it('rolls back archive transaction and ignores late fallback replay refresh', async () => {
    const replayResolver: { current: ((value: boolean) => void) | null } = { current: null }
    const replayThreadEvents = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          replayResolver.current = resolve
        }),
    )

    const ctx = {
      selectedCwd: '/repo-a',
      setSelectedCwd: vi.fn(),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-a',
        selectedInputId: null,
        pendingInputs: {},
        logs: [{ id: 'log-a', kind: 'message', role: 'assistant', text: 'active' } as const],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
      logsByThreadId: {},
      request: vi.fn().mockRejectedValue(new Error('archive failed')),
      dispatch: vi.fn(),
      log: vi.fn(),
      setMode: vi.fn(),
      runtimeStateByThreadRef: { current: {} },
      replayCursorByThreadRef: { current: {} },
      activeThreadIdRef: { current: 'active-thread' as string | null },
      replayThreadEvents,
      resumeThreadInputs: vi.fn(async () => {}),
      refreshWorkspaceDiff: vi.fn(async () => {}),
      trackArchiveOp: vi.fn(),
      clearArchiveOp: vi.fn().mockReturnValue(true),
    }

    const transactions = createThreadTransactions(ctx)
    await transactions.archiveThread('active-thread')

    if (typeof replayResolver.current === 'function') {
      replayResolver.current(false)
    }

    await vi.waitFor(() => {
      expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-a')
    })
    expect(ctx.refreshWorkspaceDiff).not.toHaveBeenCalledWith('/repo-b')
    expect(ctx.log).toHaveBeenCalledWith('Archive failed: archive failed', 'error')
  })
})
