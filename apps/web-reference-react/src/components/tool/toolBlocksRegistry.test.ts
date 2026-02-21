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

  it('renders glob with pattern subtitle and summary info', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern="**/*.ts"',
      summary: 'Found 101 files',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const info = blocks.find((block) => block.kind === 'info')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Glob')
    expect(header?.subtitle).toBe('pattern: "**/*.ts"')
    expect(info?.kind).toBe('info')
    expect(info?.text).toBe('Found 101 files')
  })

  it('keeps glob compact even when detail lines exist', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern="**/*.ts"',
      summary: 'Found 2 files',
      detailLines: ['src/a.ts', 'src/b.ts'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const details = blocks.find((block) => block.kind === 'details')
    expect(header?.kind).toBe('header')
    expect(header?.expandable).toBe(false)
    expect(details).toBeUndefined()
  })

  it('normalizes raw glob output into Found N files summary', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern="**/*.ts"',
      summary: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const info = blocks.find((block) => block.kind === 'info')
    expect(info?.kind).toBe('info')
    expect(info?.text).toBe('Found 3 files')
  })

  it('does not count running-status text as glob results', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'running',
      paramsText: 'pattern="**/*.ts"',
      summary: 'Glob running',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const info = blocks.find((block) => block.kind === 'info')
    expect(info).toBeUndefined()
  })

  it('keeps grep compact and summary-only when output exists', () => {
    const item = makeToolItem({
      toolName: 'Grep',
      status: 'completed',
      paramsText: 'pattern="export const", path="src"',
      summary: 'a.ts:1:export const a = 1',
      detailLines: ['b.ts:2:export const b = 2'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const info = blocks.find((block) => block.kind === 'info')
    const details = blocks.find((block) => block.kind === 'details')
    expect(header?.kind).toBe('header')
    expect(header?.title).toBe('Grep')
    expect(header?.subtitle).toBe('"export const" (in src)')
    expect(header?.expandable).toBe(false)
    expect(info?.kind).toBe('info')
    expect(info?.text).toBe('2 lines of output')
    expect(details).toBeUndefined()
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

  it('renders edit as diff block with file subtitle only in header', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Updated 1 occurrence'],
    })
    const blocks = buildToolUiBlocks(item)
    const header = blocks.find((block) => block.kind === 'header')
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(header?.kind).toBe('header')
    expect(header?.subtitle).toBe('src/demo.js')
    expect(header?.paramsText).toBeUndefined()
    expect(header?.expandable).toBe(false)
    expect(diff?.kind).toBe('diff')
    expect(diff?.alwaysVisible).toBe(true)
    expect(diff?.files[0]?.path).toBe('src/demo.js')
    expect(diff?.files[0]?.patch).toContain('@@ @@')
    expect(diff?.files[0]?.patch).toContain('-foo')
    expect(diff?.files[0]?.patch).toContain('+bar')
    expect(blocks.find((block) => block.kind === 'details')).toBeUndefined()
  })

  it('keeps unchanged lines as context in edit diff preview', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="alpha\\nbeta\\ngamma", new_string="alpha\\nBETA\\ngamma"',
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.patch).toContain('alpha')
    expect(diff?.files[0]?.patch).toContain('-beta')
    expect(diff?.files[0]?.patch).toContain('+BETA')
    expect(diff?.files[0]?.patch).toContain('gamma')
    expect(diff?.files[0]?.additions).toBe(1)
    expect(diff?.files[0]?.deletions).toBe(1)
  })

  it('keeps context lines that start with dash as context instead of deletions', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="- keep\\nreplace", new_string="- keep\\nreplaced"',
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.patch).toContain(' - keep')
    expect(diff?.files[0]?.additions).toBe(1)
    expect(diff?.files[0]?.deletions).toBe(1)
  })

  it('shows EOF newline changes in edit diff preview', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo\\n", new_string="foo"',
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.patch).toContain('-[EOF newline]')
    expect(diff?.files[0]?.additions).toBe(0)
    expect(diff?.files[0]?.deletions).toBe(1)
  })

  it('renders one-sided edit diff when only old_string is available', () => {
    const paramsText = formatToolInputAsParamsText({
      file_path: 'src/demo.js',
      old_string: 'x'.repeat(300),
    })
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: paramsText ?? undefined,
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    const preview = blocks.find((block) => block.kind === 'code_preview')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.deletions).toBeGreaterThan(0)
    expect(preview).toBeUndefined()
  })

  it('renders edit diff from raw input even when params text is truncated', () => {
    const paramsText = formatToolInputAsParamsText({
      file_path: 'src/demo.js',
      old_string: 'x'.repeat(300),
      new_string: 'bar',
    })
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      input: {
        file_path: 'src/demo.js',
        old_string: 'foo',
        new_string: 'bar',
      },
      paramsText: paramsText ?? undefined,
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.patch).toContain('-foo')
    expect(diff?.files[0]?.patch).toContain('+bar')
  })

  it('uses patchStartLineNumber as diff hunk line anchor', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      patchStartLineNumber: 22,
      input: {
        file_path: 'src/demo.js',
        old_string: 'foo',
        new_string: 'bar',
      },
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item)
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.patch).toContain('@@ -22,1 +22,1 @@')
  })

  it('normalizes edit subtitle to cwd-relative path', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      input: {
        file_path: '/Users/david/Documents/github/formax/demo.txt',
        old_string: 'foo',
        new_string: 'bar',
      },
      summary: 'Applied edit',
      detailLines: [],
    })
    const blocks = buildToolUiBlocks(item, { cwd: '/Users/david/Documents/github/formax' })
    const header = blocks.find((block) => block.kind === 'header')
    const diff = blocks.find((block) => block.kind === 'diff')
    expect(header?.kind).toBe('header')
    expect(header?.subtitle).toBe('demo.txt')
    expect(diff?.kind).toBe('diff')
    expect(diff?.files[0]?.path).toBe('demo.txt')
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
