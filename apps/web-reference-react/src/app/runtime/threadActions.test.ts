import { describe, expect, it, vi } from 'vitest'
import { createThreadActions, type ThreadActionsContext } from './threadActions'

function createBaseContext(overrides: Partial<ThreadActionsContext> = {}): ThreadActionsContext {
  return {
    selectedCwd: '/repo',
    setSelectedCwd: vi.fn(),
    state: {
      activeThreadId: 'prev-thread',
      activeTurnId: 'turn-prev',
      logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
      threads: [{ id: 'prev-thread', cwd: '/repo', updatedAt: '2026-02-13T00:00:00Z' }],
    },
    sortedThreads: [],
    logsByThreadId: {
      'prev-thread': [{ id: 'l-prev-cached', kind: 'message', role: 'assistant', text: 'cached' }],
    },
    historyCursorByThreadId: {},
    request: vi.fn(),
    dispatch: vi.fn(),
    log: vi.fn(),
    setMode: vi.fn(),
    runtimeStateByThreadRef: { current: {} },
    replayCursorByThreadRef: { current: {} },
    activeThreadIdRef: { current: 'prev-thread' },
    setIsThreadActionBusy: vi.fn(),
    replayThreadEvents: vi.fn().mockResolvedValue(true),
    resumeThreadInputs: vi.fn().mockResolvedValue(undefined),
    refreshThreads: vi.fn().mockResolvedValue(undefined),
    refreshWorkspaceDiff: vi.fn().mockResolvedValue(undefined),
    loadEarlierHistoryAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('threadActions', () => {
  it('rolls back to previous thread when new thread replay hydration fails', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ thread: { id: 'new-thread', cwd: '/repo-new' } }),
      replayThreadEvents: vi.fn().mockResolvedValue(false),
    })
    const actions = createThreadActions(ctx)

    await actions.startThread()

    expect(ctx.setIsThreadActionBusy).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsThreadActionBusy).toHaveBeenLastCalledWith(false)
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_thread', threadId: 'new-thread' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_thread', threadId: 'prev-thread' })
    expect(ctx.log).toHaveBeenCalledWith(
      'Failed to hydrate new thread transcript. Restored previous thread.',
      'warn',
    )
    expect(ctx.resumeThreadInputs).not.toHaveBeenCalled()
  })

  it('resets active thread when cwd has no matching thread', () => {
    const ctx = createBaseContext({
      selectedCwd: '/repo',
      sortedThreads: [{ id: 'thread-a', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z' }],
    })
    const actions = createThreadActions(ctx)

    actions.selectCwd('/repo-missing')

    expect(ctx.activeThreadIdRef.current).toBeNull()
    expect(ctx.setMode).toHaveBeenCalledWith('normal')
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_thread', threadId: null })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'replace_logs', logs: [] })
  })
})
