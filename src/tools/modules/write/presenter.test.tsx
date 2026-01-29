import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { WriteToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import { PlanProvider } from '../../../features/repl/planContext'

describe('WriteToolPresenter', () => {
  it('renders a write approval prompt while a write call is pending user input', () => {
    const userInput = createUserInputManager()
    void userInput.requestAnswers({ toolUseId: 't-write', questions: [] })

    const message: Msg = {
      id: 'tool-write',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-write',
        name: 'Write',
        status: 'running',
        input: {
          file_path: '/tmp/new.txt',
          content: 'line1\n\nline3',
        },
      },
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <WriteToolPresenter message={message} />
      </UserInputProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Write')
    expect(frame).toContain('new.txt')
    expect(frame).toContain('Create file')
    expect(frame).toContain('Do you want to create new.txt?')
    expect(frame).toContain('line1')
    expect(frame).toContain('line3')

    // Only one "standalone" separator line (the approval header). Preview box borders should not count.
    const ansi = /\u001B\[[0-9;]*m/g
    const standaloneSeparators = frame
      .split('\n')
      .map((l) => l.replace(ansi, '').trim())
      .filter((l) => /^─{20,}$/.test(l))
    expect(standaloneSeparators).toHaveLength(1)
  })

  it('renders an Updated plan message when writing the active plan file', () => {
    const planPath = '/tmp/plan.md'
    const planSession = {
      getPlanPath: () => planPath,
      startNewPlan: () => planPath,
    }

    const message: Msg = {
      id: 'tool-plan',
      role: 'tool',
      content: 'wrote plan',
      timestamp: new Date(),
      toolInfo: {
        name: 'Write',
        status: 'completed',
        input: { file_path: planPath, content: '# plan' },
      },
    }

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <WriteToolPresenter message={message} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
    expect(frame).not.toContain('Write(')
  })
})
