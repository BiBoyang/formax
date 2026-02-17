import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import {
  buildPersistedMsgRefMap,
  buildPersistedSigMap,
  persistStableMessagesFromSnapshot,
  shouldPersistUiMsg,
} from './sessionLifecycle'

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

  it('builds stable message ref map only for stable messages', () => {
    const stable = createMsg({ id: 'a1', content: 'first' })
    const map = buildPersistedMsgRefMap([
      stable,
      createMsg({ id: 's1', isStreaming: true }),
      createMsg({
        id: 't1',
        role: 'tool',
        toolInfo: { name: 'Write', status: 'running', input: {} },
      }),
    ])

    expect(Array.from(map.keys())).toEqual(['a1'])
    expect(map.get('a1')).toBe(stable)
  })

  it('skips stringify and append for unchanged message references', () => {
    const appendStableMsg = vi.fn(async () => {})
    const writer = { appendStableMsg }
    const sigRef = { current: new Map<string, string>() }
    const msgRef = { current: new Map<string, Msg>() }
    const stable = createMsg({ id: 'a1', content: 'first' })

    persistStableMessagesFromSnapshot({
      writer,
      messages: [stable],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [stable],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).toHaveBeenCalledTimes(1)
  })

  it('appends changed stable messages and prunes removed ids', () => {
    const appendStableMsg = vi.fn(async () => {})
    const writer = { appendStableMsg }
    const sigRef = { current: new Map<string, string>() }
    const msgRef = { current: new Map<string, Msg>() }
    const first = createMsg({ id: 'a1', content: 'first' })
    const updated = createMsg({ id: 'a1', content: 'second' })

    persistStableMessagesFromSnapshot({
      writer,
      messages: [first],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [updated],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })
    persistStableMessagesFromSnapshot({
      writer,
      messages: [],
      lastPersistedSigByMsgIdRef: sigRef,
      lastPersistedMsgByIdRef: msgRef,
    })

    expect(appendStableMsg).toHaveBeenCalledTimes(2)
    expect(sigRef.current.size).toBe(0)
    expect(msgRef.current.size).toBe(0)
  })
})
