import { describe, expect, it } from 'vitest'
import {
  DeferredToolExposureStore,
  resolveToolExposureSessionKey,
} from './deferredToolExposure'

describe('DeferredToolExposureStore', () => {
  it('starts with ToolSearch only and injects deferred-tool list block', () => {
    const store = new DeferredToolExposureStore()
    const sessionKey = 'session-a'

    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Run shell', input_schema: {} },
        { name: 'Read', description: 'Read files', input_schema: {} },
      ],
    })

    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual(['ToolSearch'])
    expect(store.buildAvailableDeferredToolsBlock(sessionKey)).toBe(
      '<available-deferred-tools>\nBash\nRead\n</available-deferred-tools>',
    )
  })

  it('loads tools via select query', () => {
    const store = new DeferredToolExposureStore()
    const sessionKey = 'session-select'

    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Run shell', input_schema: {} },
        { name: 'Read', description: 'Read files', input_schema: {} },
      ],
    })

    const result = store.searchAndLoad({
      sessionKey,
      query: 'select:Read,Bash',
    })

    expect(result.isError).toBe(false)
    expect(result.matchedNames).toEqual(['Read', 'Bash'])
    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual([
      'ToolSearch',
      'Bash',
      'Read',
    ])
  })

  it('supports keyword search and returns errors for empty matches', () => {
    const store = new DeferredToolExposureStore()
    const sessionKey = 'session-keyword'

    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Execute shell command', input_schema: {} },
        { name: 'Read', description: 'Read file from disk', input_schema: {} },
      ],
    })

    const keyword = store.searchAndLoad({
      sessionKey,
      query: 'shell',
    })
    expect(keyword.isError).toBe(false)
    expect(keyword.matchedNames).toEqual(['Bash'])

    const miss = store.searchAndLoad({
      sessionKey,
      query: 'no-such-tool',
    })
    expect(miss.isError).toBe(true)
    expect(miss.matchedNames).toEqual([])
  })
})

describe('resolveToolExposureSessionKey', () => {
  it('prefers explicit session key and falls back to cwd', () => {
    expect(resolveToolExposureSessionKey({ explicitSessionKey: 'x', cwd: '/repo' })).toBe('x')
    expect(resolveToolExposureSessionKey({ explicitSessionKey: '  ', cwd: '/repo' })).toBe('cwd:/repo')
    expect(resolveToolExposureSessionKey({ explicitSessionKey: '', cwd: '' })).toBe('default')
  })
})
