import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import { WriteToolPresenter } from './presenter'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import { createUserInputManager } from '../../runtime/userInputManager'
import { PlanProvider } from '../../../features/repl/planContext'
import { ToolUiBlocks } from '../../../components/tool/ToolUiBlocks'
import { isToolBlocksPresenter } from '../../presenters/types'

// Helper to render blocks presenter
function renderBlocksPresenter(presenter: typeof WriteToolPresenter, message: Msg) {
  if (isToolBlocksPresenter(presenter)) {
    const out = presenter({ message })
    return render(<ToolUiBlocks blocks={out.blocks} />)
  }
  return render(presenter({ message }))
}

describe('WriteToolPresenter', () => {
  it('renders a stable running header while tool input is still streaming', () => {
    const message: Msg = {
      id: 'tool-write',
      role: 'tool',
      content: '',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 't-write',
        name: 'Write',
        status: 'running',
        input: {},
      },
    }

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(<ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />)
    const frame = lastFrame() || ''
    expect(frame).toContain('Write')
    expect(frame).not.toContain('(…)')
    expect(frame).not.toContain('Create file')
  })

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

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <UserInputProvider userInput={userInput}>
        <ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />
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

    if (!isToolBlocksPresenter(WriteToolPresenter)) {
      throw new Error('WriteToolPresenter expected to be a blocks presenter')
    }

    const { lastFrame } = render(
      <PlanProvider planSession={planSession}>
        <ToolUiBlocks blocks={WriteToolPresenter({ message }).blocks} />
      </PlanProvider>,
    )

    const frame = lastFrame()
    expect(frame).toContain('Updated plan')
    expect(frame).toContain('/plan to preview')
    expect(frame).not.toContain('Write(')
  })
})
