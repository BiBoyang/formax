import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { TaskToolPresenter } from './presenter'
import type { Msg } from '../../../shared/toolMessageTypes'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'

describe('TaskToolPresenter', () => {
  it('falls back when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-missing-info',
      role: 'tool',
      content: 'raw tool output',
      timestamp: new Date(),
    }
    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

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

  it('truncates long params text with ellipsis', () => {
    const message: Msg = {
      id: 'tool-long-params',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'completed',
        input: {
          subagent_type: 'reviewer',
          description:
            'This is a very long description that should be truncated after sixty characters to keep the header compact',
        },
      },
    }

    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    expect(lastFrame()).toContain('…')
  })

  it('falls back to prompt when description is blank', () => {
    const message: Msg = {
      id: 'tool-prompt-fallback',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'completed',
        input: {
          subagent_type: 'reviewer',
          description: '   ',
          prompt: '  investigate flaky test  ',
        },
      },
    }
    const { lastFrame } = render(<TaskToolPresenter message={message} />)
    expect(lastFrame()).toContain('investigate flaky test')
  })

  it('does not render nested prompt when no nested tool is pending', () => {
    const userInput = createUserInputManager()

    const message: Msg = {
      id: 'tool-task-no-pending',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: { subagent_type: 'Explore', description: 'Analyze repo' },
        nestedTools: [
          {
            id: 'nested-no-pending',
            name: 'Write',
            status: 'running',
            input: { file_path: '/tmp/c.js' },
          },
        ],
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={message} />
      </UserInputProvider>,
    )
    expect(lastFrame()).not.toContain('Do you want to create c.js?')
  })

  it('skips malformed/non-running nested items and still renders expanded nested lines', () => {
    const userInput = createUserInputManager()
    const message: Msg = {
      id: 'tool-task-nested-skip',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [
          { id: 0 as any, name: 'Read', status: 'running', input: {} },
          { id: 123 as any, name: 'Read', status: 'running', input: {} },
          { id: '', name: '', status: 'running', input: {} },
          { id: 'not-running', name: 'Read', status: 'completed', input: { file_path: '/tmp/x' } },
          { id: 'has-summary', name: 'Read', status: 'completed', input: {}, summary: '  summary line  ' },
          { id: 'running-no-summary', name: '', status: 'running', input: {} },
        ],
      },
    }
    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={message} />
      </UserInputProvider>,
    )
    const frame = lastFrame()
    expect(frame).toContain('├ summary line')
    expect(frame).toContain('└ Tool()')
  })

  it('does not render nested prompt when status is not running or nested list is empty', () => {
    const userInput = createUserInputManager()
    userInput.requestAnswers({
      toolUseId: 'nested-should-not-show',
      questions: [{ header: 'A', question: 'Q', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })

    const completedMessage: Msg = {
      id: 'tool-task-completed',
      role: 'tool',
      content: 'done',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'completed',
        input: {},
        nestedTools: [{ id: 'nested-should-not-show', name: 'Write', status: 'running', input: { file_path: '/tmp/a' } }],
      },
    }
    const runningEmptyNested: Msg = {
      id: 'tool-task-running-empty',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [],
      },
    }

    const completed = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={completedMessage} />
      </UserInputProvider>,
    ).lastFrame()
    const running = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={runningEmptyNested} />
      </UserInputProvider>,
    ).lastFrame()

    expect(completed).not.toContain('Do you want to create')
    expect(running).not.toContain('Do you want to create')
  })

  it('renders fallback nested prompt for unknown nested tool', () => {
    const userInput = createUserInputManager()
    userInput.requestAnswers({
      toolUseId: 'nested-unknown',
      questions: [{ header: 'A', question: 'Q', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })

    const message: Msg = {
      id: 'tool-task-unknown',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [{ id: 'nested-unknown', name: 'UnknownTool', status: 'running', input: {} }],
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={message} />
      </UserInputProvider>,
    )
    expect(lastFrame()).toContain('Waiting for input: UnknownTool')
  })

  it('renders nested NotebookEdit prompt via component presenter path', () => {
    const userInput = createUserInputManager()
    userInput.requestAnswers({
      toolUseId: 'nested-notebook',
      questions: [{ header: 'A', question: 'Q', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })

    const message: Msg = {
      id: 'tool-task-notebook',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [
          {
            id: 'nested-notebook',
            name: 'NotebookEdit',
            status: 'running',
            input: { notebook_path: '/tmp/n.ipynb' },
          },
        ],
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={message} />
      </UserInputProvider>,
    )
    expect(lastFrame()).toContain('NotebookEdit')
  })

  it('renders nested prompts for Bash, Edit, and AskUserQuestion', () => {
    const userInput = createUserInputManager()
    userInput.requestAnswers({
      toolUseId: 'nested-bash',
      questions: [{ header: 'B', question: 'Run command?', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })
    userInput.requestAnswers({
      toolUseId: 'nested-edit',
      questions: [{ header: 'E', question: 'Apply edit?', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })
    userInput.requestAnswers({
      toolUseId: 'nested-ask',
      questions: [{ header: 'A', question: 'Pick one', options: [{ label: 'Y', description: '' }], multiSelect: false }],
    })

    const bashMsg: Msg = {
      id: 'task-bash',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [{ id: 'nested-bash', name: 'Bash', status: 'running', input: undefined as any }],
      },
    }
    const editMsg: Msg = {
      id: 'task-edit',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [{ id: 'nested-edit', name: 'Edit', status: 'running', input: { file_path: '/tmp/e.ts' } }],
      },
    }
    const askMsg: Msg = {
      id: 'task-ask',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Task',
        status: 'running',
        input: {},
        nestedTools: [
          {
            id: 'nested-ask',
            name: 'AskUserQuestion',
            status: 'running',
            input: {
              question: 'Pick one',
              options: [{ label: 'Y', description: '' }],
            },
          },
        ],
      },
    }

    const bashFrame = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={bashMsg} />
      </UserInputProvider>,
    ).lastFrame()
    const editFrame = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={editMsg} />
      </UserInputProvider>,
    ).lastFrame()
    const askFrame = render(
      <UserInputProvider userInput={userInput}>
        <TaskToolPresenter message={askMsg} />
      </UserInputProvider>,
    ).lastFrame()

    expect(bashFrame).toContain('Approve running this command?')
    expect(editFrame).toContain('Do you want to make this edit to e.ts?')
    expect(askFrame).toContain('Pick one')
  })
})
