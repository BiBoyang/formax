import { afterEach, describe, expect, it } from 'vitest'
import { isTranscriptVirtualizationEnabled } from './transcriptVirtualization'

const GLOBAL_FLAG_KEY = '__FORMAX_TRANSCRIPT_VIRTUALIZATION__' as const
const LOCAL_STORAGE_KEY = 'formax.web.transcriptVirtualization'

afterEach(() => {
  const runtimeWindow = window as Window & { [GLOBAL_FLAG_KEY]?: unknown }
  delete runtimeWindow[GLOBAL_FLAG_KEY]
  window.localStorage.removeItem(LOCAL_STORAGE_KEY)
})

describe('isTranscriptVirtualizationEnabled', () => {
  it('defaults to false when flag is missing', () => {
    const runtimeWindow = window as Window & { [GLOBAL_FLAG_KEY]?: unknown }
    delete runtimeWindow[GLOBAL_FLAG_KEY]
    window.localStorage.removeItem(LOCAL_STORAGE_KEY)

    expect(isTranscriptVirtualizationEnabled({ isDevRuntime: true })).toBe(false)
  })

  it('reads explicit runtime flag first', () => {
    const runtimeWindow = window as Window & { [GLOBAL_FLAG_KEY]?: unknown }
    runtimeWindow[GLOBAL_FLAG_KEY] = true
    window.localStorage.setItem(LOCAL_STORAGE_KEY, 'false')

    expect(isTranscriptVirtualizationEnabled({ isDevRuntime: true })).toBe(true)
  })

  it('falls back to localStorage toggle when runtime flag is absent', () => {
    const runtimeWindow = window as Window & { [GLOBAL_FLAG_KEY]?: unknown }
    delete runtimeWindow[GLOBAL_FLAG_KEY]
    window.localStorage.setItem(LOCAL_STORAGE_KEY, 'true')

    expect(isTranscriptVirtualizationEnabled({ isDevRuntime: true })).toBe(true)
  })

  it('stays disabled outside dev runtime', () => {
    const runtimeWindow = window as Window & { [GLOBAL_FLAG_KEY]?: unknown }
    runtimeWindow[GLOBAL_FLAG_KEY] = true
    window.localStorage.setItem(LOCAL_STORAGE_KEY, 'true')

    expect(isTranscriptVirtualizationEnabled({ isDevRuntime: false })).toBe(false)
  })
})
