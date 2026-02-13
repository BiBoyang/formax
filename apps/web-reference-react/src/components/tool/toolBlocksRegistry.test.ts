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

  it('normalizes raw-json ask summary when detail lines are missing', () => {
    const item = makeToolItem({
      summary: '{"answers":{"platform":"Mac","theme":"dark"}}',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const details = blocks.find((block) => block.kind === 'details')
    expect(header?.kind).toBe('header')
    expect(header?.summary).toBe('Answered 2 questions')
    expect(details?.kind).toBe('details')
    expect(details?.lines).toEqual(['platform: Mac', 'theme: dark'])
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

  it('normalizes exit plan mode approval summary', () => {
    const item = makeToolItem({
      toolName: 'ExitPlanMode',
      status: 'completed',
      summary: 'User has approved your plan. You can now start coding.',
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.summary).toBe('Plan approved. You can start coding.')
  })

  it('keeps AskUserQuestion title unchanged when questions param is missing', () => {
    const item = makeToolItem({
      toolName: 'AskUserQuestion',
      status: 'running',
      summary: 'Waiting for answers',
      paramsText: 'description="no questions field"',
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('AskUserQuestion')
  })

  it('counts AskUserQuestion questions from raw params even when display params truncate', () => {
    const longQuestion = 'x'.repeat(180)
    const item = makeToolItem({
      toolName: 'AskUserQuestion',
      status: 'running',
      summary: 'Waiting for answers',
      paramsText: `questions=[{"question":"${longQuestion}","options":[{"label":"A"}]}]`,
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('AskUserQuestion 1 question')
  })
})
