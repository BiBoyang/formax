import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { buildMessageByIdMap, markDirtyMessageIdsFromTransition } from './sessionDirtyTracking'

function createMsg(overrides: Partial<Msg>): Msg {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ok',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('sessionDirtyTracking', () => {
  it('builds id->message map for the current snapshot', () => {
    const a = createMsg({ id: 'a' })
    const b = createMsg({ id: 'b' })
    const map = buildMessageByIdMap([a, b])

    expect(map.get('a')).toBe(a)
    expect(map.get('b')).toBe(b)
  })

  it('marks appended messages as dirty and updates message map', () => {
    const a = createMsg({ id: 'a' })
    const b = createMsg({ id: 'b' })
    const messageByIdRef = { current: buildMessageByIdMap([a]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }

    markDirtyMessageIdsFromTransition({
      previous: [a],
      next: [a, b],
      messageByIdRef,
      dirtyMessageIdsRef,
    })

    expect(Array.from(dirtyMessageIdsRef.current)).toEqual(['b'])
    expect(messageByIdRef.current.get('a')).toBe(a)
    expect(messageByIdRef.current.get('b')).toBe(b)
  })

  it('marks removed messages as dirty and drops them from message map', () => {
    const a = createMsg({ id: 'a' })
    const b = createMsg({ id: 'b' })
    const messageByIdRef = { current: buildMessageByIdMap([a, b]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }

    markDirtyMessageIdsFromTransition({
      previous: [a, b],
      next: [a],
      messageByIdRef,
      dirtyMessageIdsRef,
    })

    expect(Array.from(dirtyMessageIdsRef.current)).toEqual(['b'])
    expect(messageByIdRef.current.get('a')).toBe(a)
    expect(messageByIdRef.current.has('b')).toBe(false)
  })

  it('marks changed suffix starting at first differing index', () => {
    const a = createMsg({ id: 'a' })
    const b1 = createMsg({ id: 'b', content: 'one' })
    const b2 = createMsg({ id: 'b', content: 'two' })
    const c = createMsg({ id: 'c' })
    const messageByIdRef = { current: buildMessageByIdMap([a, b1, c]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }

    markDirtyMessageIdsFromTransition({
      previous: [a, b1, c],
      next: [a, b2, c],
      messageByIdRef,
      dirtyMessageIdsRef,
    })

    expect(Array.from(dirtyMessageIdsRef.current).sort()).toEqual(['b', 'c'])
    expect(messageByIdRef.current.get('b')).toBe(b2)
  })
})
