import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptItem } from '../../types'
import { ToolTranscriptItem } from './ToolTranscriptItem'

function makeToolItem(overrides: Partial<Extract<TranscriptItem, { kind: 'tool_call' }>> = {}): Extract<TranscriptItem, { kind: 'tool_call' }> {
  return {
    id: 'tool-1',
    kind: 'tool_call',
    turnId: 'turn-1',
    toolUseId: 'tool-use-1',
    toolName: 'Bash',
    status: 'running',
    summary: 'Bash running',
    detailLines: ['$ pwd', '/repo'],
    ...overrides,
  }
}

describe('ToolTranscriptItem', () => {
  it('renders running bash as header plus IN row only', () => {
    const item = makeToolItem()
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(document.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.queryByText('OUT')).not.toBeInTheDocument()
  })

  it('renders approval input lifecycle label', () => {
    const item = makeToolItem({
      inputState: {
        kind: 'approval',
        status: 'pending',
      },
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('approval:pending')).toBeInTheDocument()
    const dot = screen.getByTestId('tool-status-dot')
    expect(dot).toHaveClass('bg-amber-500')
  })

  it('prioritizes failed input lifecycle as red status dot', () => {
    const item = makeToolItem({
      status: 'running',
      inputState: {
        kind: 'approval',
        status: 'failed',
      },
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    const dot = screen.getByTestId('tool-status-dot')
    expect(dot).toHaveClass('bg-red-500')
  })

  it('renders bash command from params and completed status as static dot', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command=\"ls -la\", cwd=\"/repo\"',
      summary: 'completed',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.getByTestId('tool-status-dot')).not.toHaveClass('animate-pulse')
  })

  it('parses bash params when command contains comma and pairs have no spaces', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command="echo \\"a, b\\"",cwd="/repo"',
      summary: 'completed',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('echo "a, b"')).toBeInTheDocument()
  })

  it('promotes exit code to the first OUT line for bash errors', () => {
    const item = makeToolItem({
      status: 'error',
      paramsText: 'command="forma --version", description="Show forma version"',
      summary: 'process failed with exit code 127',
      detailLines: ['(eval):1: command not found: forma'],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Exit code 127')).toBeInTheDocument()
    expect(screen.getByText('(eval):1: command not found: forma')).toBeInTheDocument()
  })

  it('clamps long OUT previews with internal scrolling', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command="npm install"',
      summary: 'added 129 packages',
      detailLines: ['line-1', 'line-2', 'line-3', 'line-4', 'line-5', 'line-6', 'line-7'],
    })
    const { container } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(container.querySelector('.overflow-y-auto')).not.toBeNull()
  })

  it('caps rendered preview rows for very large outputs', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command="tree -L 4 src"',
      summary: 'src',
      detailLines: Array.from({ length: 350 }, (_, index) => `line-${index + 1}`),
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('line-1')).toBeInTheDocument()
    expect(screen.queryByText('line-350')).not.toBeInTheDocument()
    expect(screen.getByText(/more lines not shown/)).toBeInTheDocument()
  })

  it('renders glob with pattern subtitle and summary info line', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern=\"**/*.md\"',
      summary: 'Found 10 files',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Glob')).toBeInTheDocument()
    expect(screen.getByText('pattern: "**/*.md"')).toBeInTheDocument()
    expect(screen.getByText('Found 10 files')).toBeInTheDocument()
  })

  it('renders glob count summary when pattern is missing', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'cwd="/repo"',
      summary: 'No files found',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Glob')).toBeInTheDocument()
    expect(screen.getByText('Found 0 files')).toBeInTheDocument()
  })

  it('renders glob file count from raw output lines instead of listing files', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern="**/*.test.ts"',
      summary: 'src/a.test.ts\nsrc/b.test.ts',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Found 2 files')).toBeInTheDocument()
    expect(screen.queryByText(/src\/a\.test\.ts/)).not.toBeInTheDocument()
  })

  it('does not fabricate glob count while tool is running', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'running',
      paramsText: 'pattern="**/*.test.ts"',
      summary: 'Glob running',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Glob')).toBeInTheDocument()
    expect(screen.queryByText(/Found \d+ files?/)).not.toBeInTheDocument()
  })

  it('renders read-like tools as `<Tool> <file>` in header', () => {
    const item = makeToolItem({
      toolName: 'Read',
      paramsText: 'file_path="package.json", offset=0',
      summary: 'Read 42 lines',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('package.json')).toBeInTheDocument()
  })

  it('keeps edit target file visible when collapsed', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Updated 1 occurrence'],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getAllByText('src/demo.js').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByText('foo')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
    expect(screen.queryByText('Updated 1 occurrence')).not.toBeInTheDocument()
  })

  it('keeps edit header as title + file even in verbose mode', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Updated 1 occurrence'],
    })
    render(<ToolTranscriptItem item={item} displayDensity="verbose" open={false} onToggle={vi.fn()} />)

    expect(screen.getAllByText('src/demo.js').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/old_string="foo"/)).not.toBeInTheDocument()
  })

  it('hides submitted approval badge on tool header', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      inputState: {
        kind: 'approval',
        status: 'submitted',
      },
      summary: 'Applied edit',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('approval:submitted')).not.toBeInTheDocument()
  })

  it('does not show edit truncation warning copy', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText:
        'file_path="src/demo.js", old_string="line1\\nline2\\nline3\\nline4\\nline5\\nline6...", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Edited src/demo.js'],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('Diff preview unavailable (tool input was truncated).')).not.toBeInTheDocument()
  })

  it('shows edit content preview fallback when only one side is available', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText:
        'file_path="src/demo.js", old_string="line1\\nline2\\nline3\\nline4\\nline5\\nline6..."',
      summary: 'Applied edit',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('line1')).toBeInTheDocument()
  })

  it('shows edit diff from raw input when paramsText is truncated', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      input: {
        file_path: 'src/demo.js',
        old_string: 'foo',
        new_string: 'bar',
      },
      paramsText:
        'file_path="src/demo.js", old_string="line1\\nline2\\nline3\\nline4\\nline5\\nline6...", new_string="bar"',
      summary: 'Applied edit',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('foo')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
  })

  it('renders websearch with query promoted to title', () => {
    const item = makeToolItem({
      toolName: 'WebSearch',
      paramsText: 'query="react hooks", recency=30',
      summary: 'Found 5 results',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/WebSearch react hooks/)).toBeInTheDocument()
  })

  it('renders webfetch with url promoted to title', () => {
    const item = makeToolItem({
      toolName: 'WebFetch',
      paramsText: 'url="https://example.com", timeout=30000',
      summary: 'Fetched content',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/WebFetch https:\/\/example\.com/)).toBeInTheDocument()
  })

  it('renders task with subagent and description promoted to title', () => {
    const item = makeToolItem({
      toolName: 'Task',
      paramsText: 'subagent_type="planner", description="analyze docs", priority="high"',
      summary: 'Delegated task',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/Task planner\(analyze docs\)/)).toBeInTheDocument()
  })

  it('renders ask-user-question count in title', () => {
    const item = makeToolItem({
      toolName: 'AskUserQuestion',
      paramsText: 'questions=[{"id":"q1"},{"id":"q2"}], mode="single"',
      summary: 'Waiting for answers',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/AskUserQuestion 2 questions/)).toBeInTheDocument()
  })

  it('renders todowrite count in title', () => {
    const item = makeToolItem({
      toolName: 'TodoWrite',
      paramsText: 'todos=[{"content":"a"},{"content":"b"},{"content":"c"}], op="replace"',
      summary: 'Updated todos',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/TodoWrite 3 items/)).toBeInTheDocument()
  })

  it('renders grep/search with grep pattern in subtitle', () => {
    const grep = makeToolItem({
      toolName: 'Grep',
      status: 'completed',
      paramsText: 'pattern="TODO", path="src", output_mode="files_with_matches"',
      summary: 'Found matches',
      detailLines: [],
    })
    const search = makeToolItem({
      toolName: 'Search',
      paramsText: 'pattern="useEffect", path="apps/web-reference-react/src"',
      summary: 'Found references',
      detailLines: [],
    })

    const { rerender } = render(<ToolTranscriptItem item={grep} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText('"TODO" (in src)')).toBeInTheDocument()
    expect(screen.getByText('1 line of output')).toBeInTheDocument()

    rerender(<ToolTranscriptItem item={search} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/Search useEffect/)).toBeInTheDocument()
  })

  it('keeps grep output compact without inline raw error details', () => {
    const item = makeToolItem({
      toolName: 'Grep',
      status: 'error',
      paramsText: 'pattern="export const", path="/missing/path"',
      summary: '<tool_use_error>Path does not exist: /missing/path</tool_use_error>',
      detailLines: [],
    })
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('1 line of output')).toBeInTheDocument()
    expect(screen.queryByText(/Path does not exist:/)).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.queryByText(/Path does not exist: \/missing\/path/)).not.toBeInTheDocument()
  })

  it('falls back to raw params text when formatter cannot parse them', () => {
    const item = makeToolItem({
      toolName: 'UnknownTool',
      paramsText: '--raw --flag',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('UnknownTool')).toBeInTheDocument()
    expect(screen.getByText('--raw --flag')).toBeInTheDocument()
  })

  it('shows params on collapsed expandable header in verbose density', () => {
    const item = makeToolItem({
      toolName: 'UnknownTool',
      paramsText: '--raw --flag',
      detailLines: ['line'],
    })
    const onToggle = vi.fn()
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={onToggle} />)

    expect(screen.getByText('UnknownTool')).toBeInTheDocument()
    expect(screen.queryByText('--raw --flag')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} displayDensity="verbose" open={false} onToggle={onToggle} />)
    expect(screen.getByText('--raw --flag')).toBeInTheDocument()
  })

  it('renders workspace-relative paths when cwd is provided', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      paramsText: 'file_path="/Users/david/Documents/github/formax/snake-game/index.html"',
      summary: 'Wrote /Users/david/Documents/github/formax/snake-game/index.html',
      detailLines: [],
    })

    render(
      <ToolTranscriptItem
        item={item}
        cwd="/Users/david/Documents/github/formax"
        open={false}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('snake-game/index.html')).toBeInTheDocument()
    expect(screen.queryByText(/\/Users\/david\/Documents\/github\/formax/)).not.toBeInTheDocument()
  })

  it('shows write diff even when closed and header is non-expandable', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      paramsText: 'file_path="snake-game/index.html", content="line1\\nline2"',
      summary: 'Wrote snake-game/index.html',
      detailLines: [],
    })

    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('2 lines')).toBeInTheDocument()
    expect(screen.getByText('line1')).toBeInTheDocument()
    expect(screen.getByText('line2')).toBeInTheDocument()
  })

  it('shows write diff truncation notice when params text is clipped', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      paramsText:
        'file_path="snake-game/index.html", content="line1\\nline2\\nline3\\nline4\\nline5\\nline6...',
      summary: 'Wrote snake-game/index.html',
      detailLines: [],
    })

    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Preview unavailable (tool input was truncated).')).toBeInTheDocument()
  })

  it('renders Enter/ExitPlanMode with semantic titles', () => {
    const enterItem = makeToolItem({
      toolName: 'EnterPlanMode',
      status: 'running',
      summary: 'EnterPlanMode running',
      detailLines: [],
    })
    const exitItem = makeToolItem({
      toolName: 'ExitPlanMode',
      status: 'completed',
      summary: 'User has approved your plan. You can now start coding.',
      detailLines: [],
    })

    const { rerender } = render(<ToolTranscriptItem item={enterItem} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/Enter plan mode/)).toBeInTheDocument()

    rerender(<ToolTranscriptItem item={exitItem} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/Exit plan mode/)).toBeInTheDocument()
  })

  it('shows semantic AskUserQuestion detail lines instead of raw json brace', () => {
    const item = makeToolItem({
      toolName: 'AskUserQuestion',
      status: 'completed',
      summary: '{',
      detailLines: [
        '{',
        '"answers": {"platform":"Mac","theme":"dark"}',
        '}',
      ],
    })

    render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByText('platform: Mac')).toBeInTheDocument()
    expect(screen.getByText('theme: dark')).toBeInTheDocument()
    expect(screen.queryByText('{')).not.toBeInTheDocument()
  })
})
