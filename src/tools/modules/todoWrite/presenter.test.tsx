import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { TodoWriteToolPresenter } from './presenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

describe('TodoWriteToolPresenter', () => {
  it('renders fallback when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-missing',
      role: 'tool',
      content: '',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('running status only renders header', () => {
    const message: Msg = {
      id: 'tool-running',
      role: 'tool',
      content: 'working',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'running',
        input: {
          todos: [{ content: 'A', status: 'pending', activeForm: 'Doing A' }],
        },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('TodoWrite')
    expect(frame).not.toContain('working')
    expect(frame).not.toContain('☐')
  })

  it('renders a checklist from input.todos', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content:
        'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'completed',
        input: {
          todos: [
            { content: 'Do thing', status: 'pending', activeForm: 'Doing thing' },
            { content: 'Finish', status: 'completed', activeForm: 'Finishing' },
          ],
        },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('TodoWrite')
    expect(frame).toContain('2 items')
    expect(frame).toContain('☐')
    expect(frame).toContain('☒')
    expect(frame).toContain('Do thing')
    expect(frame).toContain('Finish')
  })

  it('renders in_progress todos with active marker', () => {
    const message: Msg = {
      id: 'tool-progress',
      role: 'tool',
      content: 'updated',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'completed',
        input: {
          todos: [{ content: 'Build feature', status: 'in_progress', activeForm: 'Building feature' }],
        },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('Build feature')
    expect(frame).toContain('☐')
  })

  it('handles non-array todos input', () => {
    const message: Msg = {
      id: 'tool-non-array',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'completed',
        input: { todos: 'invalid' as any },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('TodoWrite')
    expect(frame).toContain('0 items')
  })

  it('renders error summary from message content', () => {
    const message: Msg = {
      id: 'tool-error',
      role: 'tool',
      content: 'Error: write failed',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'error',
        input: { todos: [] },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('Error: write failed')
  })

  it('falls back when todo status/content are missing', () => {
    const message: Msg = {
      id: 'tool-fallback',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'TodoWrite',
        status: 'completed',
        input: { todos: [{} as any] },
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={TodoWriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('☐')
  })
})
