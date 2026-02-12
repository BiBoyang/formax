import { fireEvent, render, screen } from '@testing-library/react'
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
  it('renders running status with pulsing dot and toggles details', () => {
    const onToggle = vi.fn()
    const item = makeToolItem()
    const { rerender } = render(<ToolTranscriptItem item={item} open={false} onToggle={onToggle} />)

    expect(document.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText('/repo')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<ToolTranscriptItem item={item} open onToggle={onToggle} />)
    expect(screen.getByText('/repo')).toBeInTheDocument()
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
  })

  it('renders bash command from params and completed status as static dot', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command=\"ls -la\", cwd=\"/repo\"',
      summary: 'completed',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/Bash ls -la/i)).toBeInTheDocument()
    expect(document.querySelector('[class*="bg-emerald-500/80"]')).not.toBeNull()
  })

  it('parses bash params when command contains comma and pairs have no spaces', () => {
    const item = makeToolItem({
      status: 'completed',
      paramsText: 'command="echo \\"a, b\\"",cwd="/repo"',
      summary: 'completed',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/Bash echo "a, b"/i)).toBeInTheDocument()
  })

  it('renders glob renderer summary from pattern param', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'pattern=\"**/*.md\"',
      summary: 'Found 10 files',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('pattern: **/*.md')).toBeInTheDocument()
    expect(screen.getByText('Found 10 files')).toBeInTheDocument()
  })

  it('does not duplicate glob summary when pattern is missing', () => {
    const item = makeToolItem({
      toolName: 'Glob',
      status: 'completed',
      paramsText: 'cwd="/repo"',
      summary: 'No files found',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText('No files found')).toBeInTheDocument()
    expect(screen.getAllByText('No files found')).toHaveLength(1)
  })

  it('renders read-like tools as `<Tool> <file>` in header', () => {
    const item = makeToolItem({
      toolName: 'Read',
      paramsText: 'file_path="package.json", offset=0',
      summary: 'Read 42 lines',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/Read package\.json \(offset=0\)/)).toBeInTheDocument()
  })

  it('renders websearch with query promoted to title', () => {
    const item = makeToolItem({
      toolName: 'WebSearch',
      paramsText: 'query="react hooks", recency=30',
      summary: 'Found 5 results',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/WebSearch react hooks \(recency=30\)/)).toBeInTheDocument()
  })

  it('renders webfetch with url promoted to title', () => {
    const item = makeToolItem({
      toolName: 'WebFetch',
      paramsText: 'url="https://example.com", timeout=30000',
      summary: 'Fetched content',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/WebFetch https:\/\/example\.com \(timeout=30000\)/)).toBeInTheDocument()
  })

  it('renders task with subagent and description promoted to title', () => {
    const item = makeToolItem({
      toolName: 'Task',
      paramsText: 'subagent_type="planner", description="analyze docs", priority="high"',
      summary: 'Delegated task',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/Task planner\(analyze docs\) \(priority="high"\)/)).toBeInTheDocument()
  })

  it('renders ask-user-question count in title', () => {
    const item = makeToolItem({
      toolName: 'AskUserQuestion',
      paramsText: 'questions=[{"id":"q1"},{"id":"q2"}], mode="single"',
      summary: 'Waiting for answers',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/AskUserQuestion 2 questions \(mode="single"\)/)).toBeInTheDocument()
  })

  it('renders todowrite count in title', () => {
    const item = makeToolItem({
      toolName: 'TodoWrite',
      paramsText: 'todos=[{"content":"a"},{"content":"b"},{"content":"c"}], op="replace"',
      summary: 'Updated todos',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/TodoWrite 3 items \(op="replace"\)/)).toBeInTheDocument()
  })

  it('renders grep/search with pattern promoted to title', () => {
    const grep = makeToolItem({
      toolName: 'Grep',
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
    expect(screen.getByText(/Grep TODO \(path="src", output_mode="files_with_matches"\)/)).toBeInTheDocument()

    rerender(<ToolTranscriptItem item={search} open={false} onToggle={vi.fn()} />)
    expect(screen.getByText(/Search useEffect \(path="apps\/web-reference-react\/src"\)/)).toBeInTheDocument()
  })

  it('falls back to raw params text when formatter cannot parse them', () => {
    const item = makeToolItem({
      toolName: 'UnknownTool',
      paramsText: '--raw --flag',
      detailLines: [],
    })
    render(<ToolTranscriptItem item={item} open={false} onToggle={vi.fn()} />)

    expect(screen.getByText(/UnknownTool \(\-\-raw \-\-flag\)/)).toBeInTheDocument()
  })
})
