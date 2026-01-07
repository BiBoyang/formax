import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { TaskToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('TaskToolPresenter', () => {
  it('renders summary and artifacts when result is JSON', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'completed',
        input: { subagent_type: 'code-reviewer', description: 'Review REPL.tsx' },
        result: JSON.stringify({ summary: 'Looks good', artifacts: ['src/screens/REPL.tsx'] }),
      },
    }

    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Task')
    expect(frame).toContain('code-reviewer')
    expect(frame).toContain('Review REPL.tsx')
    expect(frame).toContain('Looks good')
    expect(frame).toContain('Artifacts')
    expect(frame).toContain('src/screens/REPL.tsx')
  })

  it('strips Error: prefix for error results', () => {
    const message: Msg = {
      id: 'tool-2',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'error',
        input: { subagent_type: 'code-reviewer' },
        result: 'Error: Sub-agent failed',
      },
    }

    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Sub-agent failed')
    expect(frame).not.toContain('Error:')
  })
})

