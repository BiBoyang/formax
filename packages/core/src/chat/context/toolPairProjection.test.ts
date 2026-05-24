import { describe, expect, it } from 'vitest'
import { dropOrphanToolBlocks } from './toolPairProjection'

describe('dropOrphanToolBlocks', () => {
  it('drops thinking companions when their assistant tool_use is orphaned', () => {
    const out = dropOrphanToolBlocks([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'orphan reasoning', signature: 'sig-orphan' },
          { type: 'redacted_thinking', data: 'orphan-redacted-thinking' },
          { type: 'text', text: 'visible text survives' },
          { type: 'tool_use', id: 'missing-result', name: 'Read', input: { file_path: '/repo/a.ts' } },
        ],
      },
    ] as any)

    expect(out.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'visible text survives' }],
      },
    ])
    expect(out.droppedOrphanToolBlockCount).toBe(3)
  })

  it('keeps thinking companions when their assistant tool_use remains paired', () => {
    const out = dropOrphanToolBlocks([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'paired reasoning', signature: 'sig-paired' },
          { type: 'redacted_thinking', data: 'paired-redacted-thinking' },
          { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'ok' }],
      },
    ] as any)

    expect(out.messages[0]?.content).toEqual([
      { type: 'thinking', thinking: 'paired reasoning', signature: 'sig-paired' },
      { type: 'redacted_thinking', data: 'paired-redacted-thinking' },
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/a.ts' } },
    ])
    expect(out.droppedOrphanToolBlockCount).toBe(0)
  })

  it('keeps thinking blocks on ordinary assistant turns without tool_use', () => {
    const out = dropOrphanToolBlocks([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'ordinary reasoning', signature: 'sig-ordinary' },
          { type: 'redacted_thinking', data: 'ordinary-redacted-thinking' },
          { type: 'text', text: 'visible answer' },
        ],
      },
    ] as any)

    expect(out.messages[0]?.content).toEqual([
      { type: 'thinking', thinking: 'ordinary reasoning', signature: 'sig-ordinary' },
      { type: 'redacted_thinking', data: 'ordinary-redacted-thinking' },
      { type: 'text', text: 'visible answer' },
    ])
    expect(out.droppedOrphanToolBlockCount).toBe(0)
  })
})
