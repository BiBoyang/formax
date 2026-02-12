import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../types'
import { buildToolUiBlocks } from './toolBlocksRegistry'

function makeToolItem(
  overrides: Partial<Extract<TranscriptItem, { kind: 'tool_call' }>> = {},
): Extract<TranscriptItem, { kind: 'tool_call' }> {
  return {
    id: 'tool-1',
    kind: 'tool_call',
    turnId: 'turn-1',
    toolUseId: 'tool-use-1',
    toolName: 'AskUserQuestion',
    status: 'completed',
    summary: 'Answered',
    detailLines: [],
    ...overrides,
  }
}

describe('buildToolUiBlocks', () => {
  it('keeps ask summary when completed detail lines are not parseable answers', () => {
    const item = makeToolItem({
      summary: 'Custom completion summary',
      detailLines: ['not-json'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.summary).toBe('Custom completion summary')
  })

  it('uses semantic ask summary when completed detail lines include answers', () => {
    const item = makeToolItem({
      detailLines: ['{"answers":{"q1":"Yes","q2":"No"}}'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.summary).toBe('Answered 2 questions')
  })

  it('does not use completed write summary while write is still running', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'running',
      summary: 'Write running',
      paramsText: 'file_path="snake-game/index.html"',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.summary).toBe('Write running')
  })
})
