import { describe, expect, it, vi } from 'vitest'
import type { ThreadSummary } from '../../../types'
import { createThreadArchivedHandler } from './handleThreadArchived'

function buildThread(id: string, updatedAt: string, cwd = '/repo'): ThreadSummary {
  return {
    id,
    cwd,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
    label: null,
    lastUserPrompt: null,
  }
}

describe('createThreadArchivedHandler', () => {
  it('selects fallback thread by updatedAt when active thread is archived', () => {
    const selectThread = vi.fn()
    const pendingArchiveOps = new Map([
      ['op-1', { threadId: 'thread-1', thread: { id: 'thread-1', label: 'Archived Thread' } }],
    ])

    const deps = {
      dispatch: vi.fn(),
      pruneThreadScopedRuntimeRefs: vi.fn(),
      refreshWorkspaceDiff: vi.fn(async () => undefined),
      setNoticeMessage: vi.fn(),
      setSelectedCwd: vi.fn(),
      selectThreadRef: { current: selectThread },
      setMode: vi.fn(),
      threadsRef: {
        current: [
          buildThread('thread-1', '2026-02-01T00:00:00Z'),
          buildThread('thread-2', '2026-02-03T00:00:00Z'),
          buildThread('thread-3', '2026-02-02T00:00:00Z'),
        ],
      },
      activeThreadIdRef: { current: 'thread-1' },
      pendingArchiveOpsRef: { current: pendingArchiveOps },
    }

    const handler = createThreadArchivedHandler(deps)
    handler({ threadId: 'thread-1', opId: 'op-1' })

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: 'set_threads',
      threads: [buildThread('thread-2', '2026-02-03T00:00:00Z'), buildThread('thread-3', '2026-02-02T00:00:00Z')],
    })
    expect(selectThread).toHaveBeenCalledWith('thread-2', { restoreOnReplayFailure: false })
    expect(deps.setNoticeMessage).toHaveBeenCalledWith('Archived "Archived Thread"')
    expect(deps.pruneThreadScopedRuntimeRefs).toHaveBeenCalledWith(deps.threadsRef.current)
    expect(pendingArchiveOps.has('op-1')).toBe(false)
  })

  it('clears active state when archived thread has no fallback', () => {
    const deps = {
      dispatch: vi.fn(),
      pruneThreadScopedRuntimeRefs: vi.fn(),
      refreshWorkspaceDiff: vi.fn(async () => undefined),
      setNoticeMessage: vi.fn(),
      setSelectedCwd: vi.fn(),
      selectThreadRef: { current: vi.fn() },
      setMode: vi.fn(),
      threadsRef: {
        current: [buildThread('thread-1', '2026-02-01T00:00:00Z')],
      },
      activeThreadIdRef: { current: 'thread-1' },
      pendingArchiveOpsRef: { current: new Map() },
    }

    const handler = createThreadArchivedHandler(deps)
    handler({ threadId: 'thread-1', opId: 'op-1' })

    const actions = deps.dispatch.mock.calls.map(([action]) => action)
    expect(actions).toContainEqual({ type: 'set_threads', threads: [] })
    expect(actions).toContainEqual({ type: 'set_active_thread', threadId: null })
    expect(actions).toContainEqual({ type: 'set_active_turn', turnId: null })
    expect(actions).toContainEqual({ type: 'clear_pending_inputs' })
    expect(actions).toContainEqual({ type: 'replace_logs', logs: [] })
    expect(deps.activeThreadIdRef.current).toBe(null)
    expect(deps.setMode).toHaveBeenCalledWith('normal')
    expect(deps.setSelectedCwd).toHaveBeenCalledWith(null)
    expect(deps.refreshWorkspaceDiff).toHaveBeenCalledWith(null)
    expect(deps.selectThreadRef.current).not.toHaveBeenCalled()
  })

  it('ignores archive notifications for unknown threads', () => {
    const deps = {
      dispatch: vi.fn(),
      pruneThreadScopedRuntimeRefs: vi.fn(),
      refreshWorkspaceDiff: vi.fn(async () => undefined),
      setNoticeMessage: vi.fn(),
      setSelectedCwd: vi.fn(),
      selectThreadRef: { current: vi.fn() },
      setMode: vi.fn(),
      threadsRef: {
        current: [buildThread('thread-1', '2026-02-01T00:00:00Z')],
      },
      activeThreadIdRef: { current: 'thread-1' },
      pendingArchiveOpsRef: { current: new Map() },
    }

    const handler = createThreadArchivedHandler(deps)
    handler({ threadId: 'missing-thread', opId: 'op-1' })

    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(deps.selectThreadRef.current).not.toHaveBeenCalled()
    expect(deps.refreshWorkspaceDiff).not.toHaveBeenCalled()
  })
})
