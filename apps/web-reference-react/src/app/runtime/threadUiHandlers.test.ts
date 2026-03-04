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
      startThread: vi.fn(async () => undefined),
      startThreadInCwd: vi.fn(async () => undefined),
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
    const startPromise = Promise.resolve()
    const startInCwdPromise = Promise.resolve()
    const hidePromise = Promise.resolve()
    const renameThread = vi.fn(() => renamePromise)
    const archiveThread = vi.fn(() => archivePromise)
    const startThread = vi.fn(() => startPromise)
    const startThreadInCwd = vi.fn(() => startInCwdPromise)
    const hideThreadGroup = vi.fn(() => hidePromise)
    const runAsyncSafely = vi.fn()
    const handlers = createThreadUiHandlers({
      selectCwd: vi.fn(),
      selectThread: vi.fn(),
      renameThread,
      archiveThread,
      startThread,
      startThreadInCwd,
      hideThreadGroup,
      runAsyncSafely,
    })

    handlers.onRenameThread('thread-1', 'renamed')
    handlers.onArchiveThread('thread-1')
    handlers.onStartThread()
    handlers.onStartThreadInCwd('/repo-a')
    handlers.onHideThreadGroup('/repo-a')

    expect(renameThread).toHaveBeenCalledWith('thread-1', 'renamed')
    expect(archiveThread).toHaveBeenCalledWith('thread-1')
    expect(startThread).toHaveBeenCalledWith()
    expect(startThreadInCwd).toHaveBeenCalledWith('/repo-a')
    expect(hideThreadGroup).toHaveBeenCalledWith('/repo-a')
    expect(runAsyncSafely).toHaveBeenNthCalledWith(1, renamePromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(2, archivePromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(3, startPromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(4, startInCwdPromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(5, hidePromise)
  })
})
