import { describe, expect, it } from 'vitest'
import type { TranscriptItem } from '../../types'
import { buildToolUiBlocks } from './toolBlocksRegistry'
import { formatToolInputAsParamsText } from '../../../../../src/features/tools/presentation/paramsText'

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

  it('renders write tool as diff block when content exists', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/index.html',
      paramsText: 'file_path="snake-game/index.html", content="line1\\nline2"',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.path).toBe('snake-game/index.html')
    expect(diff?.files[0]?.additions).toBe(2)
    expect(diff?.files[0]?.deletions).toBe(0)
  })

  it('renders empty write content with zero added lines', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/empty.txt',
      paramsText: 'file_path="snake-game/empty.txt", content=""',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.additions).toBe(0)
    expect(diff?.files[0]?.deletions).toBe(0)
    const patch = diff?.files[0]?.patch ?? ''
    const addedLines = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    expect(addedLines).toEqual([])
  })

  it('omits write diff when params text is truncated', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/index.html',
      paramsText:
        'file_path="snake-game/index.html", content="line1\\nline2\\nline3\\nline4\\nline5\\nline6...',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    const info = blocks.find((block) => block.kind === 'info')
    expect(diff).toBeUndefined()
    expect(info?.kind).toBe('info')
    expect(info?.text).toBe('Diff preview unavailable (tool input was truncated).')
  })

  it('omits write diff when content value is clipped by params formatter', () => {
    const paramsText = formatToolInputAsParamsText({
      file_path: 'snake-game/index.html',
      content: 'x'.repeat(300),
    })
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/index.html',
      paramsText: paramsText ?? undefined,
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    const info = blocks.find((block) => block.kind === 'info')
    expect(diff).toBeUndefined()
    expect(info?.kind).toBe('info')
    expect(info?.text).toBe('Diff preview unavailable (tool input was truncated).')
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
