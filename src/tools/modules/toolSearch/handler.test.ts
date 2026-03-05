import { describe, expect, it } from 'vitest'
import { createToolSearchToolHandler } from './handler'
import { getDeferredToolExposureStore } from '../../runtime/deferredToolExposure'

describe('createToolSearchToolHandler', () => {
  it('loads selected tools for the current exposure session', async () => {
    const sessionKey = 'tool-search-handler-session'
    const store = getDeferredToolExposureStore()
    store.resetSession(sessionKey)
    store.registerCatalog({
      sessionKey,
      tools: [
        { name: 'Bash', description: 'Run shell command', input_schema: {} },
        { name: 'Read', description: 'Read files', input_schema: {} },
      ],
    })

    const handler = createToolSearchToolHandler()
    const result = await handler.execute(
      {
        id: 'tool-use-1',
        name: 'ToolSearch',
        input: { query: 'select:Bash' },
      },
      {
        cwd: '/repo',
        agentDepth: 0,
        toolExposureSessionKey: sessionKey,
      },
    )

    expect(result.is_error).not.toBe(true)
    expect(result.content).toContain('Matched tools:')
    expect(store.resolveToolsForModel(sessionKey).map((tool) => tool.name)).toEqual([
      'ToolSearch',
      'Bash',
    ])
  })

  it('returns an error when query is missing', async () => {
    const handler = createToolSearchToolHandler()
    const result = await handler.execute(
      {
        id: 'tool-use-2',
        name: 'ToolSearch',
        input: {},
      },
      {
        cwd: '/repo',
        agentDepth: 0,
      },
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('query is required')
  })
})
