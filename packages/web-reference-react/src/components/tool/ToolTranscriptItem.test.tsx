import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptItem } from '../../types'
import { ToolTranscriptItem } from './ToolTranscriptItem'
import { TOOL_PREVIEW_MAX_HEIGHT_PX } from './toolUiConstants'

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
  it('keeps running bash details collapsed until the tool item is expanded', () => {
    const item = makeToolItem({
      paramsText: 'command="pwd"',
    })
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(document.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('pwd')).toBeInTheDocument()
    expect(screen.queryByText('IN')).not.toBeInTheDocument()
    expect(screen.queryByText('OUT')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
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

  it('renders bash command from params and defers completed output until expanded', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command=\"ls -la\", cwd=\"/repo\"',
      summary: 'completed',
      detailLines: [],
    })
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.queryByText('OUT')).not.toBeInTheDocument()
    expect(screen.getByTestId('tool-status-dot')).not.toHaveClass('animate-pulse')

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByText('OUT')).toBeInTheDocument()
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
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('Exit code 127')).not.toBeInTheDocument()
    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
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
    const { container } = render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)

    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).not.toBeNull()
    expect(scrollRegion).toHaveStyle({ maxHeight: `${TOOL_PREVIEW_MAX_HEIGHT_PX}px` })
  })

  it('caps rendered preview rows for very large outputs', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command="tree -L 4 src"',
      summary: 'src',
      detailLines: Array.from({ length: 350 }, (_, index) => `line-${index + 1}`),
    })
    render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)

    expect(screen.getByText('line-1')).toBeInTheDocument()
    expect(screen.queryByText('line-350')).not.toBeInTheDocument()
    expect(screen.getByText(/more lines not shown/)).toBeInTheDocument()
  })

  it('renders glob as a single header row with pattern subtitle', () => {
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
    expect(screen.queryByText('Found 10 files')).not.toBeInTheDocument()
  })

  it('keeps glob to one row when pattern is missing', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'cwd="/repo"',
      summary: 'No files found',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Glob')).toBeInTheDocument()
    expect(screen.queryByText('Found 0 files')).not.toBeInTheDocument()
  })

  it('does not render glob raw output or derived count in collapsed row', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern="**/*.test.ts"',
      summary: 'src/a.test.ts\nsrc/b.test.ts',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('Found 2 files')).not.toBeInTheDocument()
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

  it('keeps skill tools plain without expandable details', () => {
    const item = makeToolItem({
      toolName: 'Skill',
      status: 'completed',
      summary: 'Read React Best Practices skill',
      detailLines: ['large skill body should not render here'],
    })
    render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)

    expect(screen.getByText('Skill')).toBeInTheDocument()
    expect(screen.queryByText('large skill body should not render here')).not.toBeInTheDocument()
  })

  it('keeps edit target file visible when collapsed and defers diff content until expanded', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'completed',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: 'Applied edit',
      detailLines: ['Updated 1 occurrence'],
    })
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getAllByText('src/demo.js')).toHaveLength(1)
    expect(screen.queryByText('foo')).not.toBeInTheDocument()
    expect(screen.queryByText('bar')).not.toBeInTheDocument()
    expect(screen.queryByText('Updated 1 occurrence')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByTestId('diff-preview-loading')).toBeInTheDocument()
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

    expect(screen.getAllByText('src/demo.js')).toHaveLength(1)
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
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('line1')).not.toBeInTheDocument()
    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByTestId('diff-preview-loading')).toBeInTheDocument()
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
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.queryByText('foo')).not.toBeInTheDocument()
    expect(screen.queryByText('bar')).not.toBeInTheDocument()
    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByTestId('diff-preview-loading')).toBeInTheDocument()
  })

  it('shows only edit header when edit fails', () => {
    const item = makeToolItem({
      toolName: 'Edit',
      status: 'error',
      paramsText: 'file_path="src/demo.js", old_string="foo", new_string="bar"',
      summary: '<tool_use_error>No exact match found</tool_use_error>',
      detailLines: ['No exact match found for old_string in src/demo.js'],
    })
    render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)

    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('src/demo.js')).toBeInTheDocument()
    expect(screen.queryByText('foo')).not.toBeInTheDocument()
    expect(screen.queryByText('bar')).not.toBeInTheDocument()
    expect(screen.queryByText(/No exact match found/)).not.toBeInTheDocument()
  })

  it('renders websearch with query in same header row', () => {
    const item = makeToolItem({
      toolName: 'WebSearch',
      paramsText: 'query="react hooks", recency=30',
      summary: 'Found 5 results',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('WebSearch')).toBeInTheDocument()
    expect(screen.getByText('react hooks')).toBeInTheDocument()
  })

  it('renders webfetch with url in same header row', () => {
    const item = makeToolItem({
      toolName: 'WebFetch',
      paramsText: 'url="https://example.com", timeout=30000',
      summary: 'Fetched content',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('WebFetch')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
  })

  it('renders task subtitle in same header row', () => {
    const item = makeToolItem({
      toolName: 'Task',
      paramsText: 'subagent_type="planner", description="analyze docs", priority="high"',
      summary: 'Delegated task',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('planner(analyze docs)')).toBeInTheDocument()
  })

  it('defers task nested progress until expanded', () => {
    const item = makeToolItem({
      toolName: 'Task',
      paramsText: 'subagent_type="planner", description="analyze docs", priority="high"',
      summary: 'Task running',
      detailLines: ['Read 10 lines', 'Found 3 files'],
    })
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('planner(analyze docs)')).toBeInTheDocument()
    expect(screen.queryByText('Read 10 lines')).not.toBeInTheDocument()
    expect(screen.queryByText('Found 3 files')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
    expect(screen.getByText('Read 10 lines')).toBeInTheDocument()
    expect(screen.getByText('Found 3 files')).toBeInTheDocument()
  })

  it('keeps webfetch tool label visible with very long url params', () => {
    const tailMarker = 'URLTAILMARKER'
    const veryLongSuffix = `${'x'.repeat(180)}${tailMarker}`
    const item = makeToolItem({
      toolName: 'WebFetch',
      paramsText: `url="https://example.com/${veryLongSuffix}", timeout=30000`,
      summary: 'Fetched content',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('WebFetch')).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/example\.com\//)).toBeInTheDocument()
    expect(screen.queryByText(tailMarker)).not.toBeInTheDocument()
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

  it('renders TodoWrite checklist with completed/in_progress/pending states', () => {
    const item = makeToolItem({
      toolName: 'TodoWrite',
      status: 'completed',
      summary: 'Todos have been modified successfully.',
      input: {
        todos: [
          { content: 'Task1', status: 'completed' },
          { content: 'Task2', status: 'in_progress' },
          { content: 'Task3', status: 'pending' },
        ],
      },
      paramsText: 'todos=[{"content":"Task1","status":"completed"}], op="replace"',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Update Todos')).toBeInTheDocument()
    expect(screen.getByText('Task1')).toHaveClass('line-through')
    expect(screen.getByText('Task2')).toBeInTheDocument()
    expect(screen.getByText('Task3')).toBeInTheDocument()
    expect(screen.getByTestId('todo-item-status-0')).toHaveAttribute('data-status', 'completed')
    expect(screen.getByTestId('todo-item-status-1')).toHaveAttribute('data-status', 'in_progress')
    expect(screen.getByTestId('todo-item-status-2')).toHaveAttribute('data-status', 'pending')
  })

  it('renders grep/search pattern in subtitle while keeping short titles', () => {
    const grep = makeToolItem({
      toolName: 'Grep',
      status: 'completed',
      paramsText: 'pattern="TODO", path="src", output_mode="files_with_matches"',
      summary: 'Found matches',
      detailLines: [],
    })
    const search = makeToolItem({
      toolName: 'Search',
      paramsText: 'pattern="useEffect", path="packages/web-reference-react/src"',
      summary: 'Found references',
      detailLines: [],
    })

    const { rerender } = render(<ToolTranscriptItem item={grep} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText('"TODO" (in src)')).toBeInTheDocument()
    expect(screen.getByText('1 line of output')).toBeInTheDocument()

    rerender(<ToolTranscriptItem item={search} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('useEffect')).toBeInTheDocument()
  })

  it('clips very long grep params to protect header title visibility', () => {
    const tailMarker = 'TAILMARKER'
    const longOutputMode = `${'x'.repeat(140)}${tailMarker}`
    const item = makeToolItem({
      toolName: 'Grep',
      status: 'completed',
      paramsText: `pattern="resolveArchiveSelection", path="packages/web-reference-react/src/app/useAppRuntime.ts", output_mode="${longOutputMode}"`,
      summary: 'Found matches',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('Grep')).toBeInTheDocument()
    expect(screen.getByText(/output_mode=/)).toBeInTheDocument()
    expect(screen.queryByText(tailMarker)).not.toBeInTheDocument()
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

  it('renders expanded tool details without a left rail or left indent wrapper', () => {
    const item = makeToolItem({
      toolName: 'UnknownTool',
      paramsText: '--raw --flag',
      detailLines: ['line'],
    })
    const { container } = render(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)

    expect(screen.getByText('line')).toBeInTheDocument()
    expect(container.querySelector('.border-l')).toBeNull()
    expect(container.querySelector('.ml-3')).toBeNull()
    expect(container.querySelector('.pl-4')).toBeNull()
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

  it('defers write preview until the tool item is expanded', () => {
    const item = makeToolItem({
      toolName: 'Write',
      status: 'completed',
      paramsText: 'file_path="snake-game/index.html", content="line1\\nline2"',
      summary: 'Wrote snake-game/index.html',
      detailLines: [],
    })

    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('snake-game/index.html')).toBeInTheDocument()
    expect(screen.queryByText('2 lines')).not.toBeInTheDocument()
    expect(screen.queryByText('line1')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
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

    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)
    expect(screen.queryByText('Preview unavailable (tool input was truncated).')).not.toBeInTheDocument()

    rerender(<ToolTranscriptItem item={item} open onToggle={vi.fn()} />)
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
