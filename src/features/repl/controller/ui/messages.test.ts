import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { isTransientMessage, partitionMessages } from './messages'

function makeMsg(args: Partial<Msg> & Pick<Msg, 'id' | 'role' | 'content'>): Msg {
  return {
    timestamp: new Date('2025-01-01T00:00:00.000Z'),
    ...args,
  } as Msg
}

describe('isTransientMessage', () => {
  it('honors explicit transient/static surface ownership first', () => {
    expect(
      isTransientMessage(makeMsg({ id: 't', role: 'assistant', content: 'x', surfaceOwner: 'transient' })),
    ).toBe(true)
    expect(isTransientMessage(makeMsg({ id: 's', role: 'assistant', content: 'x', surfaceOwner: 'static' }))).toBe(
      false,
    )
  })

  it('treats running tool rows as transient when no owner is set', () => {
    expect(
      isTransientMessage(
        makeMsg({
          id: 'tool-1',
          role: 'tool',
          content: 'running',
          toolInfo: { name: 'Bash', input: {}, status: 'running' },
        }),
      ),
    ).toBe(true)
  })

  it('treats streaming rows as transient and normal rows as static by default', () => {
    expect(isTransientMessage(makeMsg({ id: 'a', role: 'assistant', content: 'x', isStreaming: true }))).toBe(true)
    expect(isTransientMessage(makeMsg({ id: 'b', role: 'assistant', content: 'x' }))).toBe(false)
  })
})

describe('partitionMessages', () => {
  it('splits static and transient rows using the transient classifier', () => {
    const messages = [
      makeMsg({ id: 's1', role: 'assistant', content: 'stable' }),
      makeMsg({ id: 't1', role: 'assistant', content: 'stream', isStreaming: true }),
      makeMsg({
        id: 't2',
        role: 'tool',
        content: 'run',
        toolInfo: { name: 'Bash', input: {}, status: 'running' },
      }),
      makeMsg({ id: 's2', role: 'assistant', content: 'fixed', surfaceOwner: 'static' }),
    ]

    const result = partitionMessages(messages)
    expect(result.staticMessages.map((m) => m.id)).toEqual(['s1', 's2'])
    expect(result.transientMessages.map((m) => m.id)).toEqual(['t1', 't2'])
  })
})
