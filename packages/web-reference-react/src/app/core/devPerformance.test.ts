import { describe, expect, it, vi } from 'vitest'
import {
  isDevPerformanceEnabled,
  withDevPerformanceSync,
} from './devPerformance'

function createWindowStub(args?: {
  href?: string
  storageValue?: string | null
  globalFlag?: unknown
}): Window {
  const storage = args?.storageValue
  const localStorage = {
    getItem: vi.fn(() => storage ?? null),
  } as unknown as Storage
  return {
    location: { href: args?.href ?? 'http://localhost:5173/' },
    localStorage,
    __FORMAX_DEV_PERF__: args?.globalFlag,
  } as unknown as Window
}

describe('isDevPerformanceEnabled', () => {
  it('returns false outside dev runtime', () => {
    const enabled = isDevPerformanceEnabled({
      isDevRuntime: false,
      windowObj: createWindowStub({
        href: 'http://localhost:5173/?formaxPerf=1',
      }),
    })

    expect(enabled).toBe(false)
  })

  it('returns true when global dev flag is enabled', () => {
    const enabled = isDevPerformanceEnabled({
      isDevRuntime: true,
      windowObj: createWindowStub({ globalFlag: true }),
    })

    expect(enabled).toBe(true)
  })

  it('returns true when query param is enabled', () => {
    const enabled = isDevPerformanceEnabled({
      isDevRuntime: true,
      windowObj: createWindowStub({
        href: 'http://localhost:5173/?formaxPerf=true',
      }),
    })

    expect(enabled).toBe(true)
  })

  it('returns true when local storage flag is enabled', () => {
    const enabled = isDevPerformanceEnabled({
      isDevRuntime: true,
      windowObj: createWindowStub({
        storageValue: '1',
      }),
    })

    expect(enabled).toBe(true)
  })
})

describe('withDevPerformanceSync', () => {
  it('wraps runtime with console.time/timeEnd when enabled', () => {
    const consoleRef = { time: vi.fn(), timeEnd: vi.fn() }

    const value = withDevPerformanceSync({
      enabled: true,
      label: 'perf:test:sync',
      run: () => 'ok',
      consoleRef,
    })

    expect(value).toBe('ok')
    expect(consoleRef.time).toHaveBeenCalledWith('perf:test:sync')
    expect(consoleRef.timeEnd).toHaveBeenCalledWith('perf:test:sync')
  })

  it('does not call console.time/timeEnd when disabled', () => {
    const consoleRef = { time: vi.fn(), timeEnd: vi.fn() }

    const value = withDevPerformanceSync({
      enabled: false,
      label: 'perf:test:sync',
      run: () => 'ok',
      consoleRef,
    })

    expect(value).toBe('ok')
    expect(consoleRef.time).not.toHaveBeenCalled()
    expect(consoleRef.timeEnd).not.toHaveBeenCalled()
  })
})
