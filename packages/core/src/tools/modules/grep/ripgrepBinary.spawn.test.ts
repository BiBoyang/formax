import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('ripgrepBinary spawn branches', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('node:child_process')
  })

  it('falls back to collected stderr when error message is empty', async () => {
    const spawn = vi.fn(() => {
      const child = createMockChild()
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('stderr-fallback'))
        child.emit('error', new Error(''))
        child.emit('close', 0)
      })
      return child as any
    })

    vi.doMock('node:child_process', () => ({ spawn }))
    const mod = await import('./ripgrepBinary')

    await expect(mod.ripgrepBinaryTestExports.runCommandWithSpawn('cmd', [])).resolves.toMatchObject({
      exitCode: -1,
      stderr: 'stderr-fallback',
    })
  })

  it('maps null close code to -1', async () => {
    const spawn = vi.fn(() => {
      const child = createMockChild()
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from('ok'))
        child.emit('close', null)
      })
      return child as any
    })

    vi.doMock('node:child_process', () => ({ spawn }))
    const mod = await import('./ripgrepBinary')

    await expect(mod.ripgrepBinaryTestExports.runCommandWithSpawn('cmd', [])).resolves.toMatchObject({
      exitCode: -1,
      stdout: 'ok',
    })
  })
})
