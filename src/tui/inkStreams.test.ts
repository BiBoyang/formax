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

    const sized = makeStdout({ columns: 120, rows: 42 })
    const sizedProxy = createSafeInkStdout(sized)
    expect((sizedProxy as any).columns).toBe(120)
    expect((sizedProxy as any).rows).toBe(42)
    expect(typeof (sizedProxy as any).write).toBe('function')
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

  it('swallows unexpected errors during reset', async () => {
    const { resetInkStaticOutputForStdout } = await import('./inkStreams.js')
    const badStdout: any = {}
    Object.defineProperty(badStdout, 'isTTY', {
      get() {
        throw new Error('boom')
      },
    })
    await expect(resetInkStaticOutputForStdout(badStdout)).resolves.toBeUndefined()
  })

  it('returns early when resolved instance is missing or non-object', async () => {
    const dir = path.join(os.tmpdir(), `ink-instances-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'index.js'), 'export {}', 'utf8')
    await fs.writeFile(path.join(dir, 'instances.js'), 'export default globalThis.__inkInstancesMapTest', 'utf8')

    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => path.join(dir, 'index.js'),
      }),
    }))

    const { createSafeInkStdout, resetInkStaticOutputForStdout } = await import('./inkStreams.js')
    const stdout = makeStdout({ columns: 90, rows: 30 })
    const safe = createSafeInkStdout(stdout)
    const instances = new WeakMap<any, any>()
    instances.set(safe, 'not-object')
    ;(globalThis as any).__inkInstancesMapTest = instances

    await expect(resetInkStaticOutputForStdout(stdout)).resolves.toBeUndefined()
  })

  it('returns null when module has no default export and uses cached ink instances promise', async () => {
    const dir = path.join(os.tmpdir(), `ink-instances-nodefault-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'index.js'), 'export {}', 'utf8')
    await fs.writeFile(path.join(dir, 'instances.js'), 'export const nope = 1', 'utf8')

    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => path.join(dir, 'index.js'),
      }),
    }))

    const { resetInkStaticOutputForStdout } = await import('./inkStreams.js')
    const stdout = makeStdout()
    await expect(resetInkStaticOutputForStdout(stdout)).resolves.toBeUndefined()
    await expect(resetInkStaticOutputForStdout(stdout)).resolves.toBeUndefined()
  })

  it('skips resetting missing static-output fields on existing instance', async () => {
    const dir = path.join(os.tmpdir(), `ink-instances-partial-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'index.js'), 'export {}', 'utf8')
    await fs.writeFile(path.join(dir, 'instances.js'), 'export default globalThis.__inkInstancesMapTest', 'utf8')

    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => path.join(dir, 'index.js'),
      }),
    }))

    const { createSafeInkStdout, resetInkStaticOutputForStdout } = await import('./inkStreams.js')
    const stdout = makeStdout({ columns: 100, rows: 20 })
    const safe = createSafeInkStdout(stdout)
    const instance = { untouched: 'yes' }
    const instances = new WeakMap<any, any>()
    instances.set(safe, instance)
    ;(globalThis as any).__inkInstancesMapTest = instances

    await expect(resetInkStaticOutputForStdout(stdout)).resolves.toBeUndefined()
    expect(instance.untouched).toBe('yes')
  })
})
