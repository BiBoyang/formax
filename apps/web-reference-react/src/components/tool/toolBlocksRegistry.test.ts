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

  it('uses shared bash params presentation model for title and non-command params', () => {
    const item = makeToolItem({
      toolName: 'Bash',
      status: 'completed',
      summary: 'done',
      detailLines: [],
      paramsText: 'cwd="/repo", command="ls -la", timeout=1000',
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const io = blocks.find((block) => block.kind === 'io')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Bash')
    expect(header?.paramsText).toBeUndefined()
    expect(io?.kind).toBe('io')
    expect(io?.inputText).toBe('ls -la')
  })

  it('keeps bash command-only params hidden from header params', () => {
    const item = makeToolItem({
      toolName: 'Bash',
      status: 'completed',
      summary: 'done',
      detailLines: [],
      paramsText: 'command="pwd"',
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const io = blocks.find((block) => block.kind === 'io')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Bash')
    expect(header?.paramsText).toBeUndefined()
    expect(io?.kind).toBe('io')
    expect(io?.inputText).toBe('pwd')
  })

  it('keeps empty bash command-only params hidden from header params', () => {
    const item = makeToolItem({
      toolName: 'Bash',
      status: 'completed',
      summary: 'done',
      detailLines: [],
      paramsText: 'command=""',
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Bash')
    expect(header?.paramsText).toBeUndefined()
  })

  it('omits OUT rows for running bash tools', () => {
    const item = makeToolItem({
      toolName: 'Bash',
      status: 'running',
      summary: 'Bash running',
      paramsText: 'command="npm install"',
      detailLines: ['partial output line'],
    })
    const blocks = buildToolUiBlocks(item)
    const io = blocks.find((block) => block.kind === 'io')
    expect(io?.kind).toBe('io')
    expect(io?.inputText).toBe('npm install')
    expect(io?.outputLines).toBeUndefined()
  })

  it('keeps bash OUT content as raw output text instead of collapsing cwd path', () => {
    const item = makeToolItem({
      toolName: 'Bash',
      status: 'completed',
      summary: '/Users/david/Documents/github/formax',
      paramsText: 'command="pwd"',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item, { cwd: '/Users/david/Documents/github/formax' })
    const io = blocks.find((block) => block.kind === 'io')
    expect(io?.kind).toBe('io')
    expect(io?.outputLines).toEqual(['/Users/david/Documents/github/formax'])
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
    const preview = blocks.find((block) => block.kind === 'code_preview')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Write')
    expect(preview).toBeUndefined()
  })

  it('renders write tool as code preview block when content exists', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/index.html',
      paramsText: 'file_path="snake-game/index.html", content="line1\\nline2"',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const preview = blocks.find((block) => block.kind === 'code_preview')
    expect(preview?.kind).toBe('code_preview')
    expect(preview?.lineCount).toBe(2)
    expect(preview?.lines).toEqual(['line1', 'line2'])
  })

  it('does not render preview for empty write content', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote snake-game/empty.txt',
      paramsText: 'file_path="snake-game/empty.txt", content=""',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const preview = blocks.find((block) => block.kind === 'code_preview')
    expect(preview).toBeUndefined()
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
    expect(info?.text).toBe('Preview unavailable (tool input was truncated).')
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
    expect(info?.text).toBe('Preview unavailable (tool input was truncated).')
  })

  it('preserves write error details for debugging', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'error',
      summary: 'Failed to write file',
      paramsText: 'file_path="snake-game/index.html", content="line1\\nline2"',
      detailLines: ['EACCES: permission denied'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const details = blocks.find((block) => block.kind === 'details')
    expect(header?.kind).toBe('header')
    expect(header?.expandable).toBe(true)
    expect(details?.kind).toBe('details')
    expect(details?.lines).toEqual(['Failed to write file', 'EACCES: permission denied'])
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

  it('keeps read renderer as header-only even when error details exist', () => {
    const item = makeToolItem({
      toolName: 'Read',
      status: 'error',
      paramsText: 'file_path="aaa.js"',
      summary: 'Error reading file',
      detailLines: ['ENOENT: no such file or directory'],
    })
    const blocks = buildToolUiBlocks(item)
    expect(blocks.find((block) => block.kind === 'header')).toBeDefined()
    expect(blocks.find((block) => block.kind === 'details')).toBeUndefined()
    expect(blocks.find((block) => block.kind === 'io')).toBeUndefined()
  })

  it('uses subtitle for read-like file context and keeps extra params separate', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Updated 1 occurrence'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    expect(header?.kind).toBe('header')
    expect(header?.subtitle).toBe('src/demo.js')
    expect(header?.paramsText).toContain('old_string')
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
