import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { BashToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'

type MockUserInput = {
  isPending: (toolUseId: string) => boolean
  submitAnswers: (toolUseId: string, answers: unknown) => void
}

let userInput: null | MockUserInput = null
let lastBlockProps: null | { title: string; command: string; cwd: string; toolUseId: string } = null

vi.mock('../../runtime/userInputContext', () => ({
  useUserInputManager: () => userInput,
}))

vi.mock('../../presenters/BashApprovalToolBlock', () => ({
  BashApprovalToolBlock: (props: { title: string; command: string; cwd: string; toolUseId: string }) => {
    lastBlockProps = props
    return React.createElement(Text, null, props.title)
  },
}))

function stripAnsi(text: string): string {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '')
}

describe('BashToolPresenter', () => {
  beforeEach(() => {
    userInput = null
    lastBlockProps = null
  })

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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders an approval prompt while a bash call is pending user input', () => {
    userInput = { isPending: () => true, submitAnswers: vi.fn() }

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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)

    const frame = lastFrame()
    expect(frame).toContain('Approve running this command?')
    expect(lastBlockProps).not.toBe(null)
    if (!lastBlockProps) throw new Error('Expected BashApprovalToolBlock to render')

    expect(lastBlockProps.command).toBe('ls')
    expect(lastBlockProps.cwd).toBe('/tmp')
    expect(lastBlockProps.toolUseId).toBe('t-approve')
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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
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

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
    const frame = lastFrame()
    expect(frame).toContain('hello')
    expect(frame).toContain('Files: a.txt, b.txt')
  })

  it('completed header is not "Unknown tool" and shows at least one output line', () => {
    const message: Msg = {
      id: 'tool-6',
      role: 'tool',
      content: 'Output line here',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'echo hello' },
        result: 'Output line here',
        middleLines: ['Middle line 1'],
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('Bash(')
    expect(frame).not.toContain('Unknown tool')
    expect(frame).toContain('Output line here')
  })

  it('falls back to message id/cwd/empty command for running state when fields are invalid', () => {
    const message: Msg = {
      id: 'plain-id',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'running',
        input: {},
      },
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />)
    expect(lastFrame()).toContain('Approve running this command?')
    expect(lastBlockProps).not.toBeNull()
    if (!lastBlockProps) throw new Error('Expected BashApprovalToolBlock to render')
    expect(lastBlockProps.toolUseId).toBe('plain-id')
    expect(lastBlockProps.cwd).toBe(process.cwd())
    expect(lastBlockProps.command).toBe('')
  })

  it('renders expanded lines and handles runtime-missing summary safely', () => {
    const message = {
      id: 'tool-expand',
      role: 'tool',
      content: undefined,
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'echo hi' },
        result: 'ok',
        middleLines: ['m1'],
        expandInfo: 'more details',
      },
    } as Msg

    const frame = stripAnsi(render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />).lastFrame() ?? '')
    expect(frame).toContain('m1')
    expect(frame).toContain('more details')
    expect(frame).toContain('Bash(')
  })

  it('treats invalid background payloads as normal output', () => {
    const invalidTaskId: Msg = {
      id: 'tool-bg-invalid-task',
      role: 'tool',
      content: 'normal output',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'echo x' },
        result: JSON.stringify({ status: 'running', task_id: 123 }),
      },
    }
    const notRunningStatus: Msg = {
      id: 'tool-bg-not-running',
      role: 'tool',
      content: 'normal output 2',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'echo y' },
        result: JSON.stringify({ status: 'completed', task_id: 'task-1' }),
      },
    }

    const frame1 = stripAnsi(render(<ToolUiBlocks blocks={BashToolPresenter({ message: invalidTaskId }).blocks} />).lastFrame() ?? '')
    const frame2 = stripAnsi(render(<ToolUiBlocks blocks={BashToolPresenter({ message: notRunningStatus }).blocks} />).lastFrame() ?? '')

    expect(frame1).toContain('normal output')
    expect(frame1).not.toContain('Started background task')
    expect(frame2).toContain('normal output 2')
    expect(frame2).not.toContain('Started background task')
  })

  it('shows file summary suffix when more than three files are detected', () => {
    const message: Msg = {
      id: 'tool-file-suffix',
      role: 'tool',
      content: 'ok',
      timestamp: new Date(),
      toolInfo: {
        name: 'Bash',
        status: 'completed',
        input: { command: 'cat a.txt b.txt c.txt d.txt' },
        result: 'ok',
      },
    }

    const frame = stripAnsi(render(<ToolUiBlocks blocks={BashToolPresenter({ message }).blocks} />).lastFrame() ?? '')
    expect(frame).toContain('Files: a.txt, b.txt, c.txt (+1 more)')
  })
})
