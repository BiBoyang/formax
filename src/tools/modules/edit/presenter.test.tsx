import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { EditToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { PlanProvider } from '../../../features/repl/planContext'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'

describe('EditToolPresenter', () => {
  it('falls back to ToolMessage when toolInfo is missing', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'some tool output',
      timestamp: new Date(),
    }

    const { lastFrame } = render(<EditToolPresenter message={message} />)
    expect(lastFrame()).toContain('Unknown tool')
  })

  it('renders a diff preview from old_string/new_string', () => {
    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'Edited a.ts',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: 'const a = 1\nconst b = 2',
          new_string: 'const a = 1\nconst b = 3',
        },
      },
    }

    const { lastFrame } = render(<EditToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('Edit')
    expect(frame).toContain('(a.ts)')
    expect(frame).toContain('- const b = 2')
    expect(frame).toContain('+ const b = 3')
  })

  it('renders the plan file banner when editing the active plan', () => {
    const planPath = '/tmp/plan.md'
    const planSession = { getPlanPath: () => planPath, startNewPlan: () => planPath }

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: planPath,
          old_string: 'a',
          new_string: 'b',
        },
      },
    }

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <EditToolPresenter message={message} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
  })

  it('shows an approval prompt when running and the tool use is pending', () => {
    const userInput = createUserInputManager()

    const toolUseId = 'pending-1'
    userInput.requestAnswers({
      toolUseId,
      questions: [
        {
          header: 'h',
          question: 'q',
          multiSelect: false,
          options: [{ label: 'ok', description: 'ok' }],
        },
      ],
    }).catch(() => {})

    const message: Msg = {
      id: `tool-${toolUseId}`,
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'running',
        input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <EditToolPresenter message={message} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Do you want to edit')
    expect(frame).toContain('a.ts')

    userInput.rejectAllPending(new Error('cleanup'))
  })

  it('truncates diff previews longer than the visible limit', () => {
    const mkLines = (n: number) => Array.from({ length: n }, (_, i) => `line-${i + 1}`).join('\n')

    const message: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        name: 'Edit',
        status: 'completed',
        input: {
          file_path: 'a.ts',
          old_string: mkLines(20),
          new_string: mkLines(20),
        },
      },
    }

    const { lastFrame } = render(<EditToolPresenter message={message} />)
    const frame = lastFrame()
    expect(frame).toContain('… (')
    expect(frame).toContain('more lines')
  })
})
