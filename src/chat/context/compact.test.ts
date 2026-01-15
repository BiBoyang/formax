import { describe, it, expect } from 'vitest'
import type { PromptMessage } from '../../prompts'
import { rebuildHistoryAfterCompaction, selectTailForCompaction } from './compact'

function txt(role: PromptMessage['role'], text: string): PromptMessage {
  return { role, content: [{ type: 'text', text }] as any }
}

function toolUse(id: string): PromptMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/a' } }] as any,
  }
}

function toolResult(id: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] as any,
  }
}

describe('selectTailForCompaction', () => {
  it('selects the last N user turns and keeps tool pairs within the tail', () => {
    const history: PromptMessage[] = [
      txt('user', 'u1'),
      toolUse('t1'),
      toolResult('t1'),
      txt('assistant', 'a1'),
      txt('user', 'u2'),
      txt('assistant', 'a2'),
    ]

    const tail = selectTailForCompaction(history, 1)
    expect(tail.map((m) => (m.content as any[])[0]?.text ?? (m.content as any[])[0]?.type)).toEqual([
      'u2',
      'a2',
    ])
  })

  it('returns empty for keepLastTurns <= 0', () => {
    const history: PromptMessage[] = [txt('user', 'u1'), txt('assistant', 'a1')]
    expect(selectTailForCompaction(history, 0)).toEqual([])
    expect(selectTailForCompaction(history, -1)).toEqual([])
  })
})

describe('rebuildHistoryAfterCompaction', () => {
  it('prepends summary and keeps the selected tail', () => {
    const previous: PromptMessage[] = [txt('user', 'u1'), txt('assistant', 'a1'), txt('user', 'u2'), txt('assistant', 'a2')]
    const next = rebuildHistoryAfterCompaction({ summary: 'S', previousHistory: previous, keepLastTurns: 1 })
    expect(next.length).toBe(3)
    expect((next[0]!.content as any[])[0]!.text).toBe('S')
    expect((next[1]!.content as any[])[0]!.text).toBe('u2')
    expect((next[2]!.content as any[])[0]!.text).toBe('a2')
  })
})

