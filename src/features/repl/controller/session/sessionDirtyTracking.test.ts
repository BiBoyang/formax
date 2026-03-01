import { describe, expect, it } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
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

  it('is a no-op when previous and next are the same array reference', () => {
    const a = createMsg({ id: 'a' })
    const same = [a]
    const messageByIdRef = { current: buildMessageByIdMap([a]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }
    markDirtyMessageIdsFromTransition({
      previous: same,
      next: same,
      messageByIdRef,
      dirtyMessageIdsRef,
    })
    expect(dirtyMessageIdsRef.current.size).toBe(0)
    expect(messageByIdRef.current.get('a')).toBe(a)
  })

  it('is a no-op when arrays are equal by identity at each position and lengths match', () => {
    const a = createMsg({ id: 'a' })
    const b = createMsg({ id: 'b' })
    const messageByIdRef = { current: buildMessageByIdMap([a, b]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }
    markDirtyMessageIdsFromTransition({
      previous: [a, b],
      next: [a, b],
      messageByIdRef,
      dirtyMessageIdsRef,
    })
    expect(dirtyMessageIdsRef.current.size).toBe(0)
  })

  it('tolerates sparse arrays while scanning suffixes', () => {
    const a = createMsg({ id: 'a' })
    const b = createMsg({ id: 'b' })
    const previous = [a, b] as Msg[]
    const next = [a] as Msg[]
    next.length = 2 // keep index 1 empty
    const messageByIdRef = { current: buildMessageByIdMap([a, b]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }
    markDirtyMessageIdsFromTransition({
      previous,
      next,
      messageByIdRef,
      dirtyMessageIdsRef,
    })
    expect(dirtyMessageIdsRef.current.has('b')).toBe(true)
  })

  it('skips empty entries in previous suffix when removing ids', () => {
    const a = createMsg({ id: 'a' })
    const c = createMsg({ id: 'c' })
    const previous = [a] as Msg[]
    previous.length = 3
    previous[2] = c
    const next = [a, createMsg({ id: 'b' })]
    const messageByIdRef = { current: buildMessageByIdMap([a, c]) }
    const dirtyMessageIdsRef = { current: new Set<string>() }
    markDirtyMessageIdsFromTransition({
      previous,
      next,
      messageByIdRef,
      dirtyMessageIdsRef,
    })
    expect(dirtyMessageIdsRef.current.has('c')).toBe(true)
  })
})
