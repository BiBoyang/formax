import { describe, expect, it } from 'vitest'
import type { Msg } from '../../shared/toolMessageTypes'
import {
  deriveMessageItemDescriptors,
  exploreGroupId,
  findContiguousExploreTaskGroupFrom,
  findLastContiguousExploreTaskGroup,
} from './messageItems'

function message(overrides: Partial<Msg>): Msg {
  return {
    id: 'm',
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    ...overrides,
  }
}

function exploreTask(id: string, status: 'running' | 'completed' | 'error' = 'completed'): Msg {
  return message({
    id,
    role: 'tool',
    toolInfo: {
      name: 'Task',
      status,
      input: { subagent_type: 'Explore' },
    } as any,
  })
}

describe('message item projection', () => {
  it('maps messages directly when grouping is disabled', () => {
    const a = message({ id: 'a', role: 'user', content: 'hello' })
    const b = message({ id: 'b', role: 'assistant', content: 'world' })
    expect(deriveMessageItemDescriptors([a, b], { groupExploreTasks: false })).toEqual([
      { kind: 'message', key: 'a', message: a },
      { kind: 'message', key: 'b', message: b },
    ])
  })

  it('groups contiguous explore tasks only when there are at least two', () => {
    const x1 = exploreTask('x1')
    const x2 = exploreTask('x2')
    const a = message({ id: 'a', role: 'assistant', content: 'after' })
    const single = exploreTask('single')

    const grouped = deriveMessageItemDescriptors([x1, x2, a], { groupExploreTasks: true })
    expect(grouped).toEqual([
      { kind: 'explore-group', key: exploreGroupId('x1'), tasks: [x1, x2] },
      { kind: 'message', key: 'a', message: a },
    ])

    const notGrouped = deriveMessageItemDescriptors([single], { groupExploreTasks: true })
    expect(notGrouped).toEqual([{ kind: 'message', key: 'single', message: single }])
  })

  it('finds contiguous groups from a start index', () => {
    const a = exploreTask('a')
    const b = exploreTask('b')
    const c = message({ id: 'c', role: 'assistant', content: 'stop' })
    const d = exploreTask('d', 'running')
    const e = message({ id: 'e', role: 'tool', toolInfo: { name: 'Task', status: 'completed', input: { subagent_type: 'Other' } } as any })
    const f = message({ id: 'f', role: 'tool', toolInfo: { name: 'Other', status: 'completed', input: { subagent_type: 'Explore' } } as any })
    const g = message({ id: 'g', role: 'user', content: '/task' })
    const h = message({ id: 'h', role: 'tool', toolInfo: { name: 'Task', status: 'completed', input: {} } as any })

    const all = [a, b, c, d, e, f, g, h]
    expect(findContiguousExploreTaskGroupFrom(all, 0)).toEqual({ tasks: [a, b], start: 0, end: 1 })
    expect(findContiguousExploreTaskGroupFrom(all, 2)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 3)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 4)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 5)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 6)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 7)).toBeNull()
    expect(findContiguousExploreTaskGroupFrom(all, 999)).toBeNull()
  })

  it('finds the last contiguous explore task group', () => {
    const a1 = exploreTask('a1')
    const a2 = exploreTask('a2')
    const sep = message({ id: 'sep', role: 'assistant', content: 'x' })
    const b1 = exploreTask('b1')
    const b2 = exploreTask('b2')

    expect(findLastContiguousExploreTaskGroup([a1, a2, sep, b1, b2])).toEqual({
      tasks: [b1, b2],
      start: 3,
      end: 4,
    })
    expect(findLastContiguousExploreTaskGroup([sep])).toBeNull()
  })
})
