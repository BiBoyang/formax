import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { SearchToolPresenter } from './presenter'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

describe('SearchToolPresenter', () => {
  it('falls back when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Found 1 files',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={SearchToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders the header and hides output while running', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Found 1 files',
      timestamp: new Date(),
      toolInfo: {
        name: 'Search',
        status: 'running',
        input: { pattern: 'foo', path: 'src' },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={SearchToolPresenter({ message }).blocks} />)
    const frame = lastFrame()

    expect(frame).toContain('Search')
    expect(frame).not.toContain('⎿')
  })

  it('renders a summary line when completed', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Found 12 files',
      timestamp: new Date(),
      toolInfo: {
        name: 'Search',
        status: 'completed',
        input: { pattern: 'foo', path: 'src' },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={SearchToolPresenter({ message }).blocks} />)
    const frame = lastFrame()

    expect(frame).toContain('Search')
    expect(frame).toContain('⎿')
    expect(frame).toContain('Found')
    expect(frame).toContain('12')
    expect(frame).toContain('files')
  })

  it('renders an error summary when failed', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: failed to search',
      timestamp: new Date(),
      toolInfo: {
        name: 'Search',
        status: 'error',
        input: { pattern: 'foo', path: 'src' },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={SearchToolPresenter({ message }).blocks} />)
    const frame = lastFrame()

    expect(frame).toContain('Search')
    expect(frame).toContain('⎿')
    expect(frame).toContain('Error: failed to search')
  })

  it('renders non-pattern summary text and handles empty summary safely', () => {
    const plainSummaryMessage: Msg = {
      id: 'tool-plain',
      role: 'tool',
      content: 'Search completed with warnings',
      timestamp: new Date(),
      toolInfo: {
        name: 'Search',
        status: 'completed',
        input: { pattern: 'foo', path: 'src' },
      },
    }
    const emptySummaryMessage: Msg = {
      id: 'tool-empty',
      role: 'tool',
      content: undefined as any,
      timestamp: new Date(),
      toolInfo: {
        name: 'Search',
        status: 'completed',
        input: { pattern: 'foo', path: 'src' },
      },
    }

    const plainFrame = render(<ToolUiBlocks blocks={SearchToolPresenter({ message: plainSummaryMessage }).blocks} />).lastFrame()
    expect(plainFrame).toContain('Search completed with warnings')

    const emptyFrame = render(<ToolUiBlocks blocks={SearchToolPresenter({ message: emptySummaryMessage }).blocks} />).lastFrame()
    expect(emptyFrame).toContain('Search')
  })
})
