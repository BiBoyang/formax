import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { BashToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'

describe('BashToolPresenter', () => {
  it('keeps bash errors compact', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Error: Bash command denied (sudo): privileged command',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'error',
        input: {
          command: 'sudo ls',
        },
        middleLines: ['ErrorCode: POLICY_DENIED', 'Hint: Use a non-privileged command'],
        expandInfo: 'See docs: /permissions',
      },
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Bash(')
    expect(frame).toContain('Error: Bash command denied')
    expect(frame).not.toContain('ErrorCode:')
    expect(frame).not.toContain('Hint:')
    expect(frame).not.toContain('See docs:')
  })

  it('shows a compact detail line for bash errors', () => {
    const message: Msg = {
      id: 'tool-2',
      role: 'tool',
      content: 'Error: Exit code 1',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'error',
        input: { command: 'cat missing.txt' },
        middleLines: [
          'ErrorCode: BASH_EXIT',
          'cat: missing.txt: No such file or directory',
          'Hint: check the path',
        ],
        expandInfo: 'See docs: /permissions',
      },
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Error: Exit code 1')
    expect(frame).toContain('cat: missing.txt: No such file or directory')
    expect(frame).not.toContain('ErrorCode:')
    expect(frame).not.toContain('Hint:')
    expect(frame).not.toContain('See docs:')
  })

  it('renders a fallback when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-3',
      role: 'tool',
      content: 'unknown',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders an approval prompt while a bash call is pending user input', () => {
    const userInput = createUserInputManager()
    void userInput.requestAnswers({ toolUseId: 't-approve', questions: [] })

    const message: Msg = {
      id: 'tool-approve',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-approve',
        name: 'Bash',
        status: 'running',
        input: { command: 'ls', cwd: '/tmp' },
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <BashToolPresenter message={message} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Approve running this command?')
    expect(frame).toContain('Command:')
    expect(frame).toContain('ls')
    expect(frame).toContain('Cwd:')
    expect(frame).toContain('/tmp')
  })

  it('renders a background task summary when the result indicates running', () => {
    const message: Msg = {
      id: 'tool-4',
      role: 'tool',
      content: 'should not be shown',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'long-running' },
        result: JSON.stringify({ status: 'running', task_id: 'task-123' }),
      },
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Started background task')
    expect(frame).toContain('task-123')
    expect(frame).not.toContain('should not be shown')
  })

  it('renders a file summary when command displays file contents', () => {
    const message: Msg = {
      id: 'tool-5',
      role: 'tool',
      content: 'hello',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'cat a.txt b.txt' },
        result: 'hello',
      },
    }

    const { lastFrame } = render(<BashToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('hello')
    expect(frame).toContain('Files: a.txt, b.txt')
  })
})
