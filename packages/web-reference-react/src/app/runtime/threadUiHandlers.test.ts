import { describe, expect, it, vi } from 'vitest'
import { createThreadUiHandlers } from './threadUiHandlers'

describe('threadUiHandlers', () => {
  it('forwards selection handlers directly', () => {
    const selectCwd = vi.fn()
    const selectThread = vi.fn()
    const handlers = createThreadUiHandlers({
      selectCwd,
      selectThread,
      renameThread: vi.fn(async () => undefined),
      archiveThread: vi.fn(async () => undefined),
      enterNewThreadDraft: vi.fn(),
      enterNewThreadDraftInCwd: vi.fn(),
      hideThreadGroup: vi.fn(async () => undefined),
      runAsyncSafely: vi.fn(),
    })

    handlers.onSelectCwd('/repo-a')
    handlers.onSelectThread('thread-1')

    expect(selectCwd).toHaveBeenCalledWith('/repo-a')
    expect(selectThread).toHaveBeenCalledWith('thread-1')
  })

  it('routes async thread actions through runAsyncSafely', () => {
    const renamePromise = Promise.resolve()
    const archivePromise = Promise.resolve()
    const enterDraft = vi.fn()
    const enterDraftInCwd = vi.fn()
    const hidePromise = Promise.resolve()
    const renameThread = vi.fn(() => renamePromise)
    const archiveThread = vi.fn(() => archivePromise)
    const hideThreadGroup = vi.fn(() => hidePromise)
    const runAsyncSafely = vi.fn()
    const handlers = createThreadUiHandlers({
      selectCwd: vi.fn(),
      selectThread: vi.fn(),
      renameThread,
      archiveThread,
      enterNewThreadDraft: enterDraft,
      enterNewThreadDraftInCwd: enterDraftInCwd,
      hideThreadGroup,
      runAsyncSafely,
    })

    handlers.onRenameThread('thread-1', 'renamed')
    handlers.onArchiveThread('thread-1')
    handlers.onEnterNewThreadDraft()
    handlers.onEnterNewThreadDraftInCwd('/repo-a')
    handlers.onHideThreadGroup('/repo-a')

    expect(renameThread).toHaveBeenCalledWith('thread-1', 'renamed')
    expect(archiveThread).toHaveBeenCalledWith('thread-1')
    expect(enterDraft).toHaveBeenCalledWith()
    expect(enterDraftInCwd).toHaveBeenCalledWith('/repo-a')
    expect(hideThreadGroup).toHaveBeenCalledWith('/repo-a')
    expect(runAsyncSafely).toHaveBeenNthCalledWith(1, renamePromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(2, archivePromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(3, hidePromise)
  })
})
