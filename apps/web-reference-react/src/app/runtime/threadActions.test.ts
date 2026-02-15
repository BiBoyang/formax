import { describe, expect, it, vi } from 'vitest'
import { createThreadActions, type ThreadActionsContext } from './threadActions'

type ThreadActionsTestOverrides = Partial<Omit<ThreadActionsContext, 'state'>> & {
  state?: Partial<ThreadActionsContext['state']>
}

function createBaseContext(overrides: ThreadActionsTestOverrides = {}): ThreadActionsContext {
  const { state: stateOverrides, ...restOverrides } = overrides
  const defaultState: ThreadActionsContext['state'] = {
    activeThreadId: 'prev-thread',
    activeTurnId: 'turn-prev',
    selectedInputId: null,
    pendingInputs: {},
    logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
    threads: [{ id: 'prev-thread', cwd: '/repo', updatedAt: '2026-02-13T00:00:00Z' }],
  }

  return {
    selectedCwd: '/repo',
    setSelectedCwd: vi.fn(),
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
    trackArchiveOp: vi.fn(),
    clearArchiveOp: vi.fn().mockReturnValue(true),
    loadEarlierHistoryAction: vi.fn().mockResolvedValue(undefined),
    ...restOverrides,
    state: { ...defaultState, ...(stateOverrides ?? {}) },
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
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-missing')
  })

  it('refreshes workspace diff with selected thread cwd', async () => {
    const ctx = createBaseContext({
      state: {
        activeThreadId: 'prev-thread',
        activeTurnId: 'turn-prev',
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'prev-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z' },
          { id: 'thread-b', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z' },
        ],
      },
    })
    const actions = createThreadActions(ctx)

    actions.selectThread('thread-b')
    await vi.waitFor(() => {
      expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-b')
    })
  })

  it('archives thread optimistically and sends opId', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ thread: { id: 'prev-thread' } }),
      state: {
        activeThreadId: 'other-thread',
        activeTurnId: 'turn-prev',
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'prev-thread', cwd: '/repo', updatedAt: '2026-02-13T00:00:00Z', label: 'My Session' },
          { id: 'other-thread', cwd: '/repo', updatedAt: '2026-02-13T00:00:01Z' },
        ],
      },
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('prev-thread')

    expect(ctx.request).toHaveBeenCalledWith(
      'thread/archive',
      expect.objectContaining({
        threadId: 'prev-thread',
        opId: expect.any(String),
      }),
    )
    expect(ctx.trackArchiveOp).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'prev-thread',
        opId: expect.any(String),
      }),
    )
    expect(ctx.clearArchiveOp).not.toHaveBeenCalled()
  })

  it('archives active thread and switches to next thread via semantic selection', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ thread: { id: 'active-thread' } }),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
      replayThreadEvents: vi.fn().mockResolvedValue(true),
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('active-thread')

    await vi.waitFor(() => {
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_thread', threadId: 'next-thread' })
    })
    await vi.waitFor(() => {
      expect(ctx.replayThreadEvents).toHaveBeenCalledWith('next-thread', { fromStart: true })
    })
  })

  it('keeps fallback selection when fallback replay fails during archive switch', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ thread: { id: 'active-thread' } }),
      replayThreadEvents: vi.fn().mockResolvedValue(false),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        selectedInputId: null,
        pendingInputs: {},
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('active-thread')

    await vi.waitFor(() => {
      expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_thread', threadId: 'next-thread' })
    })
    expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: 'set_active_thread', threadId: 'active-thread' })
    expect(ctx.log).toHaveBeenCalledWith(
      'Failed to hydrate selected thread transcript after archive fallback. Keeping fallback selection.',
      'warn',
    )
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-b')
  })

  it('rolls back optimistic archive when request fails', async () => {
    const pendingInput = {
      inputId: 'input-1',
      threadId: 'active-thread',
      turnId: 'turn-prev',
      toolUseId: 'tool-1',
      kind: 'approval' as const,
      status: 'pending' as const,
      createdAt: '2026-02-13T00:00:00.000Z',
      expiresAt: '2026-02-13T01:00:00.000Z',
      payload: {},
    }
    const ctx = createBaseContext({
      request: vi.fn().mockRejectedValue(new Error('archive failed')),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        selectedInputId: 'input-1',
        pendingInputs: { 'input-1': pendingInput },
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('active-thread')

    expect(ctx.clearArchiveOp).toHaveBeenCalledWith(expect.any(String))
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'set_threads',
      threads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'clear_pending_inputs' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'input_requested', input: pendingInput })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_selected_input', inputId: 'input-1' })
    await vi.waitFor(() => {
      expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-a')
    })
    expect(ctx.log).toHaveBeenCalledWith('Archive failed: archive failed', 'error')
  })

  it('does not rollback when archive op was already confirmed by notification', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockRejectedValue(new Error('transport disconnected')),
      clearArchiveOp: vi.fn().mockReturnValue(false),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('active-thread')

    expect(ctx.clearArchiveOp).toHaveBeenCalledWith(expect.any(String))
    expect(ctx.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set_threads',
        threads: expect.arrayContaining([
          expect.objectContaining({ id: 'active-thread' }),
          expect.objectContaining({ id: 'next-thread' }),
        ]),
      }),
    )
    expect(ctx.log).not.toHaveBeenCalledWith(expect.stringContaining('Archive failed:'), 'error')
  })

  it('does not rollback archive when post-success diff refresh fails', async () => {
    const ctx = createBaseContext({
      request: vi.fn().mockResolvedValue({ thread: { id: 'active-thread' } }),
      refreshWorkspaceDiff: vi.fn().mockRejectedValue(new Error('diff transport failed')),
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        selectedInputId: null,
        pendingInputs: {},
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [{ id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' }],
      },
      sortedThreads: [{ id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' }],
    })
    const actions = createThreadActions(ctx)

    await actions.archiveThread('active-thread')

    expect(ctx.request).toHaveBeenCalledWith(
      'thread/archive',
      expect.objectContaining({
        threadId: 'active-thread',
      }),
    )
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith(null)
    expect(ctx.log).toHaveBeenCalledWith('Diff refresh failed after archive: diff transport failed', 'warn')
    expect(ctx.log).not.toHaveBeenCalledWith(expect.stringContaining('Archive failed:'), 'error')
  })

  it('does not refresh fallback diff after rollback when fallback replay failure resolves late', async () => {
    const replayResolver: { current: ((value: boolean) => void) | null } = { current: null }
    const replayThreadEvents = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          replayResolver.current = resolve
        }),
    )
    const ctx = createBaseContext({
      request: vi.fn().mockRejectedValue(new Error('archive failed')),
      replayThreadEvents,
      state: {
        activeThreadId: 'active-thread',
        activeTurnId: 'turn-prev',
        selectedInputId: null,
        pendingInputs: {},
        logs: [{ id: 'l-prev', kind: 'message', role: 'assistant', text: 'prev' }],
        threads: [
          { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
          { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
        ],
      },
      sortedThreads: [
        { id: 'active-thread', cwd: '/repo-a', updatedAt: '2026-02-13T00:00:00Z', label: 'Active' },
        { id: 'next-thread', cwd: '/repo-b', updatedAt: '2026-02-13T00:00:01Z', label: 'Next' },
      ],
    })
    const actions = createThreadActions(ctx)

    const archivePromise = actions.archiveThread('active-thread')
    await vi.waitFor(() => {
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: 'set_active_thread',
        threadId: 'next-thread',
      })
    })
    await archivePromise
    if (typeof replayResolver.current === 'function') {
      replayResolver.current(false)
    }

    await vi.waitFor(() => {
      expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/repo-a')
    })
    expect(ctx.refreshWorkspaceDiff).not.toHaveBeenCalledWith('/repo-b')
  })
})
