import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { TaskToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'

describe('TaskToolPresenter', () => {
  it('renders subagent label, params, and done summary', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Done (2 tool uses · 1s)',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'completed',
        input: { subagent_type: 'code-reviewer', description: 'Review REPL.tsx' },
        middleLines: ['Read(src/screens/REPL.tsx)', '└ Read 176 lines'],
      },
    }

    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Reviewer')
    expect(frame).toContain('Review REPL.tsx')
    expect(frame).toContain('Read(src/screens/REPL.tsx)')
    expect(frame).toContain('Done (2 tool uses')
  })

  it('strips Error: prefix for error results', () => {
    const message: Msg = {
      id: 'tool-2',
      role: 'tool',
      content: 'Agent failed',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'error',
        input: { subagent_type: 'code-reviewer' },
      },
    }

    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Agent failed')
    expect(frame).not.toContain('Error:')
  })

  it('renders nested approval prompts when a sub-tool is awaiting input', () => {
    const userInput = createUserInputManager()
    userInput.requestAnswers({
      toolUseId: 'nested-1',
      questions: [
        {
          header: 'Edit',
          question: 'Approve this edit?',
          options: [{ label: 'Yes', description: '' }],
          multiSelect: false,
        },
      ],
    })

    const message: Msg = {
      id: 'tool-task-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: { subagent_type: 'Explore', description: 'Analyze repo' },
        nestedTools: [
          {
            id: 'nested-1',
            name: 'Write',
            status: 'running',
            input: { file_path: '/tmp/b.js' },
          },
        ],
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={message} />
      </UserInputProvider>,
    )
    expect(lastFrame()).toContain('Do you want to create b.js?')
  })
})
