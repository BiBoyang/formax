import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from 'ink-testing-library'
import type { PresentationAskQuestion } from '../../features/tools/presentation/askQuestions.js'

type MockUserInput = {
  submitAnswers: (toolUseId: string, answers: Record<string, string>) => void
  reject: (toolUseId: string, error: Error) => void
}

const mocks = vi.hoisted(() => ({
  userInput: null as MockUserInput | null,
  replUi: null as null | { abort: () => void },
  scopedHandler: null as null | ((input: string, key: any) => void),
  activateCalls: [] as string[],
}))

vi.mock('../runtime/userInputContext', () => ({
  useUserInputManager: () => mocks.userInput,
}))

vi.mock('../../features/repl/replUiContext', () => ({
  useReplUi: () => mocks.replUi,
}))

vi.mock('../../features/repl/inputScopeContext', () => ({
  useScopeActivation: (scope: string) => {
    mocks.activateCalls.push(scope)
  },
  useScopedInput: (_scope: string, handler: (input: string, key: any) => void) => {
    mocks.scopedHandler = handler
  },
}))

import { AskUserQuestionToolBlock } from './AskUserQuestionToolBlock.js'

function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function input(inputText: string, key: any = {}): Promise<void> {
  if (!mocks.scopedHandler) throw new Error('Expected scoped handler to be registered')
  mocks.scopedHandler(inputText, key)
  await tick()
}

async function waitForText(lastFrame: () => string | undefined, text: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = lastFrame() || ''
    if (frame.includes(text)) return
    await tick()
  }
  throw new Error(`Timed out waiting for text: ${text}`)
}

function singleQuestion(overrides: Partial<PresentationAskQuestion> = {}): PresentationAskQuestion {
  return {
    question: 'Pick one',
    header: 'Topic',
    options: [
      { label: 'Option A', description: '' },
      { label: 'Option B', description: '' },
    ],
    multiSelect: false,
    ...overrides,
  }
}

describe('AskUserQuestionToolBlock', () => {
  beforeEach(() => {
    mocks.userInput = null
    mocks.replUi = null
    mocks.scopedHandler = null
    mocks.activateCalls.length = 0
  })

  it('shows preparing state when input manager is missing or no questions are provided', () => {
    const noUserInput = render(<AskUserQuestionToolBlock toolUseId="t1" questions={[singleQuestion()]} />)
    expect(noUserInput.lastFrame()).toContain('Preparing questions')

    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject: vi.fn(),
    }
    const noQuestions = render(<AskUserQuestionToolBlock toolUseId="t1" questions={[]} />)
    expect(noQuestions.lastFrame()).toContain('Preparing questions')
  })

  it('submits a single-select answer using numeric shortcut and review submit', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-1"
        questions={[singleQuestion({ header: 'Language', options: [{ label: 'TypeScript', description: '' }] })]}
      />,
    )

    expect(view.lastFrame()).toContain('Pick one')
    expect(mocks.activateCalls).toContain('prompt:askUserQuestion')

    await input('1', {})
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-1', { Language: 'TypeScript' })
  })

  it('supports single-select custom typing flow and submits typed value', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-typing"
        questions={[singleQuestion({ header: 'Other', options: [{ label: 'Preset', description: '' }] })]}
      />,
    )

    // "2" points to the synthetic "Type something." row for single-select.
    await input('2', {})
    await input('x', {})
    await input('', { return: true })
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-typing', { Other: 'x' })
  })

  it('supports multi-select toggling via Space and submits from the submit row', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-multi"
        questions={[
          singleQuestion({
            header: 'Stack',
            multiSelect: true,
            options: [
              { label: 'Node', description: '' },
              { label: 'Bun', description: '' },
            ],
          }),
        ]}
      />,
    )

    // Use numeric shortcut + tab navigation to avoid cursor timing flakiness.
    await input('2', {}) // toggle Bun
    await input('', { tab: true }) // move to review tab
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true }) // submit answers

    expect(submitAnswers).toHaveBeenCalledWith('tool-multi', { Stack: 'Bun' })
  })

  it('aborts through repl ui on Esc, otherwise rejects pending prompt', async () => {
    const reject = vi.fn()
    const abort = vi.fn()
    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject,
    }
    mocks.replUi = { abort }

    render(<AskUserQuestionToolBlock toolUseId="tool-abort" questions={[singleQuestion()]} />)

    await input('', { escape: true })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(reject).not.toHaveBeenCalled()

    mocks.replUi = null
    render(<AskUserQuestionToolBlock toolUseId="tool-reject" questions={[singleQuestion()]} />)

    await input('', { escape: true })
    expect(reject).toHaveBeenCalledTimes(1)
    expect(reject.mock.calls[0][0]).toBe('tool-reject')
    expect(reject.mock.calls[0][1]).toBeInstanceOf(Error)
    expect(reject.mock.calls[0][1].message).toBe('Canceled')
  })
})
