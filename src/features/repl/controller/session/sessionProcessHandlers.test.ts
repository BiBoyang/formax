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

  it('still forwards signal when flush fails', async () => {
    const proc = new FakeProcess()
    const flush = vi.fn(async () => {
      throw new Error('flush failed')
    })

    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => ({ flush }),
      processRef: proc as any,
    })

    proc.emit('SIGTERM')
    await tick(0)

    expect(flush).toHaveBeenCalledTimes(1)
    expect(proc.kill).toHaveBeenCalledWith(4242, 'SIGTERM')

    cleanup()
  })

  it('can register using default process/logError wiring', () => {
    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => null,
    })

    cleanup()
  })

  it('uses default console.error logger when logError is omitted', async () => {
    const proc = new FakeProcess()
    const flush = vi.fn(async () => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => ({ flush }),
      processRef: proc as any,
    })

    proc.emit('uncaughtException', new Error('boom'))
    await tick(0)

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error))
    consoleErrorSpy.mockRestore()
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

  it('flushes on beforeExit', async () => {
    const proc = new FakeProcess()
    const flush = vi.fn(async () => {})
    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => ({ flush }),
      processRef: proc as any,
    })

    proc.emit('beforeExit')
    await tick(0)
    expect(flush).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('flushes, logs and exits on uncaughtException and unhandledRejection', async () => {
    const proc = new FakeProcess()
    const flush = vi.fn(async () => {})
    const logError = vi.fn()
    const cleanup = registerSessionWriterProcessHandlers({
      sessionSaveEnabled: true,
      isVitest: false,
      getWriter: () => ({ flush }),
      processRef: proc as any,
      logError,
    })

    proc.emit('uncaughtException', new Error('boom'))
    await tick(0)

    expect(flush).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(expect.any(Error))
    expect(proc.exitCode).toBe(1)
    expect(proc.exit).toHaveBeenCalledTimes(1)

    proc.emit('unhandledRejection', 'reason')
    await tick(0)

    expect(flush).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledWith('reason')
    expect(proc.exit).toHaveBeenCalledTimes(2)

    cleanup()
  })
})
