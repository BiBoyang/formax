import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../types'
import type { TranscriptRow } from './useRenderWindow'
import { buildTranscriptRenderBlocks } from './transcriptTurnBlocks'

function row(item: TranscriptItem, overrides: Partial<TranscriptRow> = {}): TranscriptRow {
  return {
    item,
    turnGroupStart: Boolean(item.turnId),
    showTurnGap: false,
    ...overrides,
  }
}

function tool(id: string, toolName: string, overrides: Partial<Extract<TranscriptItem, { kind: 'tool_call' }>> = {}): Extract<TranscriptItem, { kind: 'tool_call' }> {
  return {
    id,
    kind: 'tool_call',
    turnId: 'turn-1',
    toolUseId: id,
    toolName,
    status: 'completed',
    summary: `${toolName} done`,
    detailLines: [],
    ...overrides,
  }
}

describe('buildTranscriptRenderBlocks', () => {
  it('projects a turn into user, tool group, answer, and status blocks', () => {
    const blocks = buildTranscriptRenderBlocks([
      row({ id: 'u1', kind: 'message', role: 'user', text: 'Question', turnId: 'turn-1' }),
      row(tool('read-1', 'Read')),
      row(tool('grep-1', 'Grep')),
      row({ id: 'a1', kind: 'message', role: 'assistant', text: 'Answer', turnId: 'turn-1' }),
      row({ id: 'f1', kind: 'turn_footer', turnId: 'turn-1', status: 'completed', createdAt: 'now' }),
    ])

    expect(blocks).toHaveLength(1)
    const turn = blocks[0]
    expect(turn?.kind).toBe('turn')
    if (!turn || turn.kind !== 'turn') throw new Error('missing turn block')
    expect(turn.segments.map((segment) => segment.kind)).toEqual(['user_message', 'tool_group', 'assistant_answer', 'status'])
    expect(turn.segments[0]).toMatchObject({ kind: 'user_message', item: { text: 'Question' } })
    expect(turn.segments[2]).toMatchObject({ kind: 'assistant_answer', item: { text: 'Answer' } })
    expect(turn.segments[3]).toMatchObject({ kind: 'status', item: { status: 'completed' } })
    const toolGroupSegment = turn.segments[1]
    if (!toolGroupSegment || toolGroupSegment.kind !== 'tool_group') throw new Error('missing tool group segment')
    expect(toolGroupSegment.group).toMatchObject({
      kind: 'tool_group',
      collapsedSummary: 'Read 1 file and searched code',
    })
  })

  it('breaks tool groups on thinking items', () => {
    const blocks = buildTranscriptRenderBlocks([
      row(tool('read-1', 'Read')),
      row({ id: 'thinking-1', kind: 'thinking', status: 'running', text: 'Thinking', turnId: 'turn-1' }),
      row(tool('bash-1', 'Bash')),
      row({ id: 'a1', kind: 'message', role: 'assistant', text: 'Answer', turnId: 'turn-1' }),
    ])

    const turn = blocks[0]
    if (!turn || turn.kind !== 'turn') throw new Error('missing turn block')
    expect(turn.segments.map((segment) => segment.kind)).toEqual(['tool_group', 'thinking', 'tool_group', 'assistant_answer'])
    expect(turn.segments[2]).toMatchObject({
      kind: 'tool_group',
      group: { collapsedSummary: 'ran 1 command' },
    })
  })

  it('preserves assistant and tool group segment order within a turn', () => {
    const blocks = buildTranscriptRenderBlocks([
      row({ id: 'a1', kind: 'message', role: 'assistant', text: 'before', turnId: 'turn-1' }),
      row(tool('write-1', 'Write')),
      row({ id: 'a2', kind: 'message', role: 'assistant', text: 'after', turnId: 'turn-1' }),
    ])

    const turn = blocks[0]
    if (!turn || turn.kind !== 'turn') throw new Error('missing turn block')
    expect(turn.segments.map((segment) => segment.kind)).toEqual(['assistant_answer', 'tool_group', 'assistant_answer'])
  })

  it('represents a single tool as a one-item tool group', () => {
    const blocks = buildTranscriptRenderBlocks([
      row(tool('read-1', 'Read')),
    ])

    const turn = blocks[0]
    if (!turn || turn.kind !== 'turn') throw new Error('missing turn block')
    expect(turn.segments).toHaveLength(1)
    expect(turn.segments[0]).toMatchObject({
      kind: 'tool_group',
      group: {
        collapsedSummary: 'Read 1 file',
        tools: [{ id: 'read-1' }],
      },
    })
  })

  it('keeps a tool group id stable when more tools append to the same group', () => {
    const firstBlocks = buildTranscriptRenderBlocks([
      row(tool('read-1', 'Read')),
    ])
    const nextBlocks = buildTranscriptRenderBlocks([
      row(tool('read-1', 'Read')),
      row(tool('grep-1', 'Grep')),
    ])

    const firstTurn = firstBlocks[0]
    const nextTurn = nextBlocks[0]
    if (!firstTurn || firstTurn.kind !== 'turn') throw new Error('missing first turn block')
    if (!nextTurn || nextTurn.kind !== 'turn') throw new Error('missing next turn block')
    const firstGroup = firstTurn.segments[0]
    const nextGroup = nextTurn.segments[0]
    if (!firstGroup || firstGroup.kind !== 'tool_group') throw new Error('missing first tool group')
    if (!nextGroup || nextGroup.kind !== 'tool_group') throw new Error('missing next tool group')

    expect(nextGroup.group.tools).toHaveLength(2)
    expect(nextGroup.group.id).toBe(firstGroup.group.id)
  })

  it('preserves standalone rows between turn fragments without inventing boundaries', () => {
    const blocks = buildTranscriptRenderBlocks([
      row({ id: 'a1', kind: 'message', role: 'assistant', text: 'turn one', turnId: 'turn-1' }, { turnGroupStart: true }),
      row({ id: 'log-1', kind: 'log', level: 'warn', text: 'standalone' }, { turnGroupStart: false }),
      row(tool('bash-1', 'Bash'), { turnGroupStart: false }),
      row({ id: 'a2', kind: 'message', role: 'assistant', text: 'turn two', turnId: 'turn-2' }, { turnGroupStart: true, showTurnGap: true }),
    ])

    expect(blocks.map((block) => block.kind)).toEqual(['turn', 'standalone', 'turn', 'turn'])
    expect(blocks.filter((block) => block.kind === 'turn' && block.turnGroupStart)).toHaveLength(2)
  })
})
