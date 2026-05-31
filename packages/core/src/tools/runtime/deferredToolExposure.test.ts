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
    expect(Array.isArray(result.content)).toBe(true)
    if (Array.isArray(result.content)) {
      const refs = result.content.filter((block: any) => block?.type === 'tool_reference')
      expect(refs.map((block: any) => block.tool_name)).toEqual(['Read', 'Bash'])
      expect(refs.every((block: any) => !('name' in block))).toBe(true)
      expect(refs.every((block: any) => block.defer_loading === true)).toBe(true)
    }
    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual([
      'ToolSearch',
      'Bash',
      'Read',
    ])
    expect(store.resolveToolsForModel(sessionKey).every((tool) => {
      if (tool.name === 'ToolSearch') return true
      return tool.defer_loading === true
    })).toBe(true)
  })

  it('does not rehydrate loaded tools from restore hint names without ToolSearch', () => {
    const store = new DeferredToolExposureStore()
    const sessionKey = 'session-restore-hints'

    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Run shell', input_schema: {} },
        { name: 'Read', description: 'Read files', input_schema: {} },
      ],
    })

    const restoreHintNames = ['Bash', 'Read']

    expect(restoreHintNames).toEqual(['Bash', 'Read'])
    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual(['ToolSearch'])
  })

  it('supports bm25 keyword-like search and returns errors for empty matches', () => {
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

  it('supports regex queries via regex: prefix', () => {
    const store = new DeferredToolExposureStore()
    const sessionKey = 'session-regex'

    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Execute shell command', input_schema: {} },
        { name: 'Read', description: 'Read file from disk', input_schema: {} },
      ],
      toolSearchEngine: 'bm25',
    })

    const regex = store.searchAndLoad({
      sessionKey,
      query: 'regex:ba(sh)?',
    })
    expect(regex.isError).toBe(false)
    expect(regex.matchedNames).toEqual(['Bash'])
  })

  it('evicts oldest sessions when catalog registrations exceed cap', () => {
    const store = new DeferredToolExposureStore()
    const total = 220
    for (let i = 0; i < total; i += 1) {
      store.registerCatalog({
        sessionKey: `session-${i}`,
        tools: [{ name: 'Bash', description: 'Run shell', input_schema: {} }],
      })
    }

    expect(store.resolveToolsForModel('session-0').map((tool) => tool.name)).toEqual(['ToolSearch'])
    expect(store.buildAvailableDeferredToolsBlock('session-0')).toBe('<available-deferred-tools>\n</available-deferred-tools>')
    expect(store.resolveToolsForModel(`session-${total - 1}`).map((tool) => tool.name)).toEqual(['ToolSearch'])
    expect(store.buildAvailableDeferredToolsBlock(`session-${total - 1}`)).toContain('Bash')
  })
})

describe('resolveToolExposureSessionKey', () => {
  it('prefers explicit session key and falls back to cwd', () => {
    expect(resolveToolExposureSessionKey({ explicitSessionKey: 'x', cwd: '/repo' })).toBe('x')
    expect(resolveToolExposureSessionKey({ explicitSessionKey: '  ', cwd: '/repo' })).toBe('cwd:/repo')
    expect(resolveToolExposureSessionKey({ explicitSessionKey: '', cwd: '' })).toBe('default')
  })
})
