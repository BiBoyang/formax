import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import { ToolUiBlocks } from './ToolUiBlocks'
import type { Msg } from './ToolMessage'
import { LocalBashPresenter } from './LocalBashPresenter'

function renderMessage(message: Msg): string {
  const out = LocalBashPresenter({ message })
  const view = render(<ToolUiBlocks blocks={out.blocks} />)
  return view.lastFrame() ?? ''
}

describe('LocalBashPresenter', () => {
  it('returns no blocks when toolInfo is missing', () => {
    const out = LocalBashPresenter({
      message: {
        id: 'tool-0',
        role: 'tool',
        content: '',
        timestamp: new Date(),
      },
    } as any)

    expect(out.blocks).toEqual([])
  })

  it('truncates to 3 lines in primary view and shows expand hint', () => {
    const frame = renderMessage({
      id: 'tool-1',
      role: 'tool',
      content: '$ ls',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'ls' },
        status: 'completed',
        result: '1\n2\n3\n4',
      },
    })

    expect(frame).toContain('! ls')
    expect(frame).toContain('⎿')
    expect(frame).toContain('1')
    expect(frame).toContain('2')
    expect(frame).toContain('3')
    expect(frame).not.toContain('\n4')
    expect(frame).toContain('… +1 lines (ctrl+o to expand)')
  })

  it('shows full output in expanded view', () => {
    const frame = renderMessage({
      id: 'tool-2',
      role: 'tool',
      content: '$ ls',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'ls' },
        status: 'completed',
        result: '1\n2\n3\n4',
        expanded: true,
      },
    })

    expect(frame).toContain('! ls')
    expect(frame).toContain('4')
    expect(frame).not.toContain('… +')
  })

  it('renders running state without subline output', () => {
    const frame = renderMessage({
      id: 'tool-running',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'sleep 1' },
        status: 'running',
        result: 'still running',
      },
    })

    expect(frame).toContain('! sleep 1')
    expect(frame).not.toContain('⎿')
  })

  it('handles missing command and non-string result by showing no output placeholder', () => {
    const frame = renderMessage({
      id: 'tool-empty',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: null as any,
        status: 'completed',
        result: { ok: true } as any,
      },
    })

    expect(frame).toContain('!')
    expect(frame).toContain('(no output)')
  })

  it('marks no-output placeholder as an error when status is error', () => {
    const frame = renderMessage({
      id: 'tool-empty-error',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: {},
        status: 'error',
        result: null as any,
      },
    })

    expect(frame).toContain('(no output)')
  })

  it('renders error status output lines', () => {
    const frame = renderMessage({
      id: 'tool-error',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'LocalBash',
        input: { command: 'bad' },
        status: 'error',
        result: 'Error line 1\nError line 2',
      },
    })

    expect(frame).toContain('Error line 1')
    expect(frame).toContain('Error line 2')
  })
})
