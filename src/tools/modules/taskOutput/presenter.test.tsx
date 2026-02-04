import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import type { Msg } from '../../../components/tool/ToolMessage'
import { TaskOutputToolPresenter } from './presenter'

describe('TaskOutputToolPresenter', () => {
  function renderPresenter(message: Msg) {
    const out = TaskOutputToolPresenter({ message })
    return render(<ToolUiBlocks blocks={out.blocks} />)
  }

  it('falls back when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'OK',
      timestamp: new Date(),
    }

    const { lastFrame } = renderPresenter(message)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders header only while running', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: { name: 'TaskOutput', status: 'running', input: { task_id: 't1' }, result: '' },
    }

    const { lastFrame } = renderPresenter(message)
    const frame = lastFrame()

    expect(frame).toContain('TaskOutput')
    expect(frame).toContain('(t1)')
    expect(frame).not.toContain('⎿')
  })

  it('renders parsed output for completed JSON results', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TaskOutput',
        status: 'completed',
        input: { task_id: 't1' },
        result: JSON.stringify({ status: 'completed', output: 'done' }),
      },
    }

    const { lastFrame } = renderPresenter(message)
    const frame = lastFrame()

    expect(frame).toContain('⎿')
    expect(frame).toContain('done')
  })

  it('renders an error output when status=error', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TaskOutput',
        status: 'completed',
        input: { task_id: 't1' },
        result: JSON.stringify({ status: 'error', output: 'boom' }),
      },
    }

    const { lastFrame } = renderPresenter(message)
    const frame = lastFrame()

    expect(frame).toContain('⎿')
    expect(frame).toContain('boom')
  })

  it('renders "(no output)" when result is empty', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TaskOutput',
        status: 'completed',
        input: { task_id: 't1' },
        result: '',
      },
    }

    const { lastFrame } = renderPresenter(message)
    expect(lastFrame()).toContain('(no output)')
  })

  it('treats invalid JSON as plain text output', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TaskOutput',
        status: 'completed',
        input: { task_id: 't1' },
        result: 'raw text',
      },
    }

    const { lastFrame } = renderPresenter(message)
    expect(lastFrame()).toContain('raw text')
  })

  it('shows "Running (timed out waiting)" and preserves output when parsed status is running', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'TaskOutput',
        status: 'completed',
        input: { task_id: 't1' },
        result: JSON.stringify({ status: 'running', output: 'still working', timed_out: true }),
      },
    }

    const { lastFrame } = renderPresenter(message)
    const frame = lastFrame()

    expect(frame).toContain('Running (timed out waiting)')
    expect(frame).toContain('still working')
  })
})
