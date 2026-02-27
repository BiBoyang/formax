import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function makeStdout(overrides: Record<string, unknown> = {}): NodeJS.WriteStream {
  return {
    isTTY: true,
    columns: 0,
    rows: 0,
    write: () => true,
    ...overrides,
  } as unknown as NodeJS.WriteStream
}

describe('utils/inkStreams', () => {
  afterEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('node:module')
    delete (globalThis as any).__inkInstancesMapTest
  })

  it('returns original stdout for non-tty and caches tty proxy with fallback dimensions', async () => {
    const { createSafeInkStdout } = await import('./inkStreams.js')

    const nonTty = { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream
    expect(createSafeInkStdout(nonTty)).toBe(nonTty)

    const stdout = makeStdout({ columns: 0, rows: undefined })
    const p1 = createSafeInkStdout(stdout)
    const p2 = createSafeInkStdout(stdout)
    expect(p1).toBe(p2)
    expect((p1 as any).columns).toBe(80)
    expect((p1 as any).rows).toBe(24)
  })

  it('gracefully no-ops when ink instances map cannot be loaded', async () => {
    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => {
          throw new Error('resolve failed')
        },
      }),
    }))
    const { resetInkStaticOutputForStdout } = await import('./inkStreams.js')
    await expect(resetInkStaticOutputForStdout(makeStdout())).resolves.toBeUndefined()
  })

  it('resets Ink static output fields when an instance exists for safe stdout', async () => {
    const dir = path.join(os.tmpdir(), `ink-instances-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'index.js'), 'export {}', 'utf8')
    await fs.writeFile(path.join(dir, 'instances.js'), 'export default globalThis.__inkInstancesMapTest', 'utf8')

    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => path.join(dir, 'index.js'),
      }),
    }))

    const mod = await import('./inkStreams.js')
    const { createSafeInkStdout, resetInkStaticOutputForStdout } = mod

    const stdout = makeStdout({ columns: 120, rows: 40 })
    const safe = createSafeInkStdout(stdout)
    const instance = {
      fullStaticOutput: 'abc',
      lastOutput: 'def',
      lastOutputHeight: 9,
    }
    const instances = new WeakMap<any, any>()
    instances.set(safe, instance)
    ;(globalThis as any).__inkInstancesMapTest = instances

    await resetInkStaticOutputForStdout(stdout)

    expect(instance.fullStaticOutput).toBe('')
    expect(instance.lastOutput).toBe('')
    expect(instance.lastOutputHeight).toBe(0)
  })
})
