import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Msg } from '../../../components/tool/ToolMessage'
import { UserInputProvider } from '../../runtime/userInputContext'
import type { UserInputManager } from '../../runtime/userInputManager'
import { ReplUiProvider } from '../../../features/repl/replUiContext'
import { AskUserQuestionToolPresenter } from './presenter'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createRunningAskMessage(): Msg {
  return {
    id: 'tool-1',
    role: 'tool',
    content: '',
    timestamp: new Date(),
    toolInfo: {
      name: 'AskUserQuestion',
      status: 'running',
      input: {
        questions: [
          {
            question: 'Pick one',
            header: 'Tech',
            multiSelect: false,
            options: [
              { label: 'Option A', description: '' },
              { label: 'Option B', description: '' },
            ],
          },
        ],
      },
    },
  }
}

describe('AskUserQuestionToolPresenter', () => {
  it('commits typing value when switching tabs', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)

    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
    }

    const message = createRunningAskMessage()
    const { stdin } = render(
      <UserInputProvider userInput={userInput}>
        <ReplUiProvider abort={() => {}}>
          <AskUserQuestionToolPresenter message={message} />
        </ReplUiProvider>
      </UserInputProvider>,
    )

    // Let Ink/React effects attach input listeners.
    await tick()

    // Select option A (auto-advances to Review tab)
    stdin.write('1')
    await tick()

    // Go back to the question tab, enter typing mode, type custom value
    stdin.write('\u001B[D')
    await tick()
    stdin.write('t')
    await tick()
    stdin.write('Custom')
    await tick()

    // Switch tabs while typing — should auto-commit typingValue -> other
    stdin.write('\t')
    await tick()

    // Submit answers
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
    expect(submitAnswers).toHaveBeenCalledWith('1', { Tech: 'Custom' })
  })

  it('prevents double submit while tool is still running', async () => {
    const submitAnswers = vi.fn<UserInputManager['submitAnswers']>(() => true)

    const userInput: UserInputManager = {
      requestAnswers: async () => ({}),
      submitAnswers,
      reject: () => true,
    }

    const message = createRunningAskMessage()
    const { stdin } = render(
      <UserInputProvider userInput={userInput}>
        <ReplUiProvider abort={() => {}}>
          <AskUserQuestionToolPresenter message={message} />
        </ReplUiProvider>
      </UserInputProvider>,
    )

    // Let Ink/React effects attach input listeners.
    await tick()

    // Navigate to Review tab and press Enter twice quickly.
    stdin.write('\t')
    await tick()
    stdin.write('\r')
    stdin.write('\r')
    await tick()

    expect(submitAnswers).toHaveBeenCalledTimes(1)
  })
})
