import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { registerSessionWriterProcessHandlers } from './sessionProcessHandlers'

class FakeProcess extends EventEmitter {
  pid = 4242
  exitCode: number | undefined = undefined
  kill = vi.fn(() => true)
  exit = vi.fn(() => undefined as never)
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessionProcessHandlers', () => {
  it('does not register handlers when disabled or vitest mode is on', () => {
    const proc = new FakeProcess()

    const cleanupDisabled = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: false,
      isVitest: false,
      getWriter: () => null,
      processRef: proc as any,
    })
    const cleanupVitest = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: true,
      getWriter: () => null,
      processRef: proc as any,
    })

    expect(proc.listenerCount('SIGINT')).toBe(0)
    expect(proc.listenerCount('SIGTERM')).toBe(0)
    expect(proc.listenerCount('beforeExit')).toBe(0)
    expect(proc.listenerCount('uncaughtException')).toBe(0)
    expect(proc.listenerCount('unhandledRejection')).toBe(0)

    cleanupDisabled()
    cleanupVitest()
  })

  it('flushes writer then forwards signal to self', async () => {
    const proc = new FakeProcess()
    const flush = vi.fn(async () => {})

    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => ({ flush }),
      processRef: proc as any,
    })

    expect(proc.listenerCount('SIGINT')).toBe(1)
    proc.emit('SIGINT')
    await tick(0)

    expect(flush).toHaveBeenCalledTimes(1)
    expect(proc.kill).toHaveBeenCalledWith(4242, 'SIGINT')
    expect(proc.listenerCount('SIGINT')).toBe(0)

    cleanup()
  })

  it('removes all registered handlers on cleanup', () => {
    const proc = new FakeProcess()
    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => null,
      processRef: proc as any,
    })

    expect(proc.listenerCount('SIGINT')).toBe(1)
    expect(proc.listenerCount('SIGTERM')).toBe(1)
    expect(proc.listenerCount('beforeExit')).toBe(1)
    expect(proc.listenerCount('uncaughtException')).toBe(1)
    expect(proc.listenerCount('unhandledRejection')).toBe(1)

    cleanup()

    expect(proc.listenerCount('SIGINT')).toBe(0)
    expect(proc.listenerCount('SIGTERM')).toBe(0)
    expect(proc.listenerCount('beforeExit')).toBe(0)
    expect(proc.listenerCount('uncaughtException')).toBe(0)
    expect(proc.listenerCount('unhandledRejection')).toBe(0)
  })
})
