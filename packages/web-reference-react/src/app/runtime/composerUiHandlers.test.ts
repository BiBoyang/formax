import { describe, expect, it, vi } from 'vitest'
import { createComposerUiHandlers } from './composerUiHandlers'

describe('composerUiHandlers', () => {
  it('updates mode and caches mode for active thread', () => {
    const setMode = vi.fn()
    const cacheThreadMode = vi.fn()
    const handlers = createComposerUiHandlers({
      setMode,
      cacheThreadMode,
      activeThreadIdRef: { current: 'thread-1' },
      onSend: vi.fn(),
      interruptTurn: vi.fn(async () => undefined),
      loadEarlierHistory: vi.fn(async () => undefined),
      submitInputById: vi.fn(async () => undefined),
      requestDevLoadAll: vi.fn(),
      runAsyncSafely: vi.fn(),
    })

    handlers.onModeChange('plan')

    expect(setMode).toHaveBeenCalledWith('plan')
    expect(cacheThreadMode).toHaveBeenCalledWith('thread-1', 'plan')
  })

  it('routes async actions through runAsyncSafely and forwards send/dev handlers', () => {
    const onSend = vi.fn()
    const interruptPromise = Promise.resolve()
    const loadEarlierPromise = Promise.resolve()
    const submitPromise = Promise.resolve()
    const interruptTurn = vi.fn(() => interruptPromise)
    const loadEarlierHistory = vi.fn(() => loadEarlierPromise)
    const submitInputById = vi.fn(() => submitPromise)
    const requestDevLoadAll = vi.fn()
    const runAsyncSafely = vi.fn()
    const handlers = createComposerUiHandlers({
      setMode: vi.fn(),
      cacheThreadMode: vi.fn(),
      activeThreadIdRef: { current: null },
      onSend,
      interruptTurn,
      loadEarlierHistory,
      submitInputById,
      requestDevLoadAll,
      runAsyncSafely,
    })

    const submitEvent = { preventDefault: vi.fn() } as any
    handlers.onSend(submitEvent)
    handlers.onInterrupt()
    handlers.onLoadEarlier()
    handlers.onSubmitInput('input-1', { approve: 'yes' })
    handlers.onDevLoadAllEarlier()

    expect(onSend).toHaveBeenCalledWith(submitEvent)
    expect(interruptTurn).toHaveBeenCalledWith()
    expect(loadEarlierHistory).toHaveBeenCalledWith()
    expect(submitInputById).toHaveBeenCalledWith('input-1', { approve: 'yes' })
    expect(runAsyncSafely).toHaveBeenNthCalledWith(1, interruptPromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(2, loadEarlierPromise)
    expect(runAsyncSafely).toHaveBeenNthCalledWith(3, submitPromise)
    expect(requestDevLoadAll).toHaveBeenCalledWith()
  })
})
