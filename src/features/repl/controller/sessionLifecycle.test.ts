import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../components/tool/ToolMessage'
import { buildPersistedSigMap, shouldPersistUiMsg } from './sessionLifecycle'

function createMsg(overrides: Partial<Msg>): Msg {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ok',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('sessionLifecycle', () => {
  it('does not persist streaming or running tool messages', () => {
    const streaming = createMsg({ id: 's1', isStreaming: true })
    const runningTool = createMsg({
      id: 't1',
      role: 'tool',
      toolInfo: { name: 'Read', status: 'running', input: {} },
    })
    const completedTool = createMsg({
      id: 't2',
      role: 'tool',
      toolInfo: { name: 'Read', status: 'completed', result: 'done', input: {} },
    })

    expect(shouldPersistUiMsg(streaming)).toBe(false)
    expect(shouldPersistUiMsg(runningTool)).toBe(false)
    expect(shouldPersistUiMsg(completedTool)).toBe(true)
  })

  it('builds signature map only for stable messages', () => {
    const map = buildPersistedSigMap([
      createMsg({ id: 'a1', content: 'first' }),
      createMsg({ id: 's1', isStreaming: true }),
      createMsg({
        id: 't1',
        role: 'tool',
        toolInfo: { name: 'Write', status: 'running', input: {} },
      }),
      createMsg({ id: 'a2', content: 'second' }),
    ])

    expect(Array.from(map.keys())).toEqual(['a1', 'a2'])
  })
})
