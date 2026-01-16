import { describe, expect, it } from 'vitest'
import type { Msg } from '../components/tool/ToolMessage'
import { deriveMessageItemDescriptors } from './REPL'

function mkExploreTask(id: string): Msg {
  return {
    id,
    role: 'tool',
    content: '',
    timestamp: new Date(0),
    toolInfo: {
      name: 'Task',
      input: { subagent_type: 'Explore' },
      status: 'completed',
    },
  }
}

function mkUser(id: string): Msg {
  return {
    id,
    role: 'user',
    content: 'hi',
    timestamp: new Date(0),
  }
}

describe('deriveMessageItemDescriptors', () => {
  it('does not group explore tasks when disabled (Static-safe)', () => {
    const t1 = mkExploreTask('t1')
    const t2 = mkExploreTask('t2')

    expect(deriveMessageItemDescriptors([t1], { groupExploreTasks: false })).toMatchObject([
      { kind: 'message', key: 't1' },
    ])

    expect(deriveMessageItemDescriptors([t1, t2], { groupExploreTasks: false })).toMatchObject([
      { kind: 'message', key: 't1' },
      { kind: 'message', key: 't2' },
    ])
  })

  it('can collapse contiguous explore tasks into a single group item', () => {
    const t1 = mkExploreTask('t1')
    const t2 = mkExploreTask('t2')

    expect(deriveMessageItemDescriptors([t1], { groupExploreTasks: true })).toMatchObject([
      { kind: 'message', key: 't1' },
    ])

    expect(deriveMessageItemDescriptors([t1, t2], { groupExploreTasks: true })).toMatchObject([
      { kind: 'explore-group', key: 'explore-group-t1' },
    ])
  })

  it('only groups contiguous explore tasks', () => {
    const t1 = mkExploreTask('t1')
    const mid = mkUser('u1')
    const t2 = mkExploreTask('t2')

    expect(deriveMessageItemDescriptors([t1, mid, t2], { groupExploreTasks: true })).toMatchObject([
      { kind: 'message', key: 't1' },
      { kind: 'message', key: 'u1' },
      { kind: 'message', key: 't2' },
    ])
  })
})

