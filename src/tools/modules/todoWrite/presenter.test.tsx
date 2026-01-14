import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { TodoWriteToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'

describe('TodoWriteToolPresenter', () => {
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

    const { lastFrame } = render(<TodoWriteToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('TodoWrite')
    expect(frame).toContain('2 items')
    expect(frame).toContain('☐')
    expect(frame).toContain('☒')
    expect(frame).toContain('Do thing')
    expect(frame).toContain('Finish')
  })
})
