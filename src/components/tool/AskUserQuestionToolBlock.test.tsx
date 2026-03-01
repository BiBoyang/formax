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

vi.mock('../../tools/runtime/userInputContext', () => ({
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
    await waitForText(view.lastFrame, 'x')
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

  it('supports review-tab cancel path and truncated long headers', async () => {
    const reject = vi.fn()
    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject,
    }

    const longHeader = 'VeryLongHeaderName'
    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-cancel-review"
        questions={[singleQuestion({ header: longHeader, options: [{ label: 'Only', description: '' }] })]}
      />,
    )

    await input('1', {})
    await waitForText(view.lastFrame, 'Review your answers')
    // Move review cursor to "Cancel", then Enter.
    await input('', { downArrow: true })
    await input('', { return: true })

    expect(reject).toHaveBeenCalledTimes(1)
    // Header chip uses truncate(..., 12) => 11 chars + "..."
    expect(view.lastFrame()).toContain('VeryLongHea...')
  })

  it('uses Q-index fallback when question header is empty', async () => {
    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject: vi.fn(),
    }
    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-header-fallback"
        questions={[singleQuestion({ header: '', options: [{ label: 'A', description: '' }] })]}
      />,
    )
    await tick()
    expect(view.lastFrame()).toContain('Q1')
  })

  it('handles single-select typing edit keys and tab navigation across submit tab', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-typing-keys"
        questions={[singleQuestion({ header: 'H', options: [{ label: 'Preset', description: '' }] })]}
      />,
    )

    // Enter typing row then type and edit.
    await input('2', {})
    await input('h', {})
    await input('i', {})
    await input('', { backspace: true })
    await input('!', {})
    await input('', { return: true }) // commit typing and move to submit tab
    await waitForText(view.lastFrame, 'Review your answers')

    // navigate with left/right (go back and forward), then submit
    await input('', { leftArrow: true })
    await waitForText(view.lastFrame, 'Pick one')
    await input('', { rightArrow: true })
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-typing-keys', { H: 'h!' })
  })

  it('ignores events without key metadata and ignores escape after submission starts', async () => {
    const submitAnswers = vi.fn()
    const reject = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject,
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-missing-key"
        questions={[singleQuestion({ header: 'Only', options: [{ label: 'A', description: '' }] })]}
      />,
    )

    // missing key should be ignored
    await input('1', undefined as any)
    expect(submitAnswers).toHaveBeenCalledTimes(0)

    await input('1', {}) // answer question
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true }) // start submit (isSubmitting = true)
    expect(submitAnswers).toHaveBeenCalledTimes(1)

    await input('', { escape: true }) // should be ignored while submitting
    expect(reject).toHaveBeenCalledTimes(0)
  })

  it('handles raw scoped handler edge inputs (!key and isSubmitting non-escape)', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-handler-edges"
        questions={[singleQuestion({ header: 'H1', options: [{ label: 'A', description: '' }] })]}
      />,
    )

    if (!mocks.scopedHandler) throw new Error('scoped handler missing')
    mocks.scopedHandler('1', undefined as any) // line 115 path
    await tick()
    expect(submitAnswers).toHaveBeenCalledTimes(0)

    await input('1', {})
    await waitForText(view.lastFrame, 'Review your answers')
    // fire two returns in the same tick so submitAll runs twice and hits submittedRef early-return branch
    if (!mocks.scopedHandler) throw new Error('scoped handler missing')
    mocks.scopedHandler('', { return: true } as any)
    mocks.scopedHandler('', { return: true } as any)
    await tick()
    expect(submitAnswers).toHaveBeenCalledTimes(1)

    // isSubmitting early-return non-escape branch
    await input('', { tab: true })
    expect(submitAnswers).toHaveBeenCalledTimes(1)
  })

  it('supports single-select typing-mode arrow/backspace/return handling', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-single-typing-branches"
        questions={[singleQuestion({ header: 'S', options: [{ label: 'Preset', description: '' }] })]}
      />,
    )

    await input('2', {}) // enter typing row
    await input('a', {})
    await input('b', {})
    await input('', { upArrow: true }) // leave typing, move to option row
    await input('', { downArrow: true }) // back to typing row
    await input('c', {}) // re-enter typing with text path
    await input('', { backspace: true }) // backspace in typing mode
    await input('d', { ctrl: true }) // ignored in typing due ctrl
    await input('', { return: true }) // commit and advance
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-single-typing-branches', { S: 'ab' })
  })

  it('covers quick custom shortcuts 0/t/T and single-select Enter branches', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const questions: PresentationAskQuestion[] = [
      singleQuestion({ header: 'Q1', options: [{ label: 'A', description: '' }] }),
      singleQuestion({ header: 'Q2', options: [{ label: 'B', description: '' }] }),
      singleQuestion({ header: 'Q3', options: [{ label: 'C', description: '' }] }),
    ]
    const view = render(<AskUserQuestionToolBlock toolUseId="tool-shortcuts" questions={questions} />)

    await input('0', {}) // Q1 quick jump to typing
    await input('x', {})
    await input('', { return: true }) // commit Q1

    await input('t', {}) // Q2 quick jump with text
    await input('', { return: true }) // commit Q2

    await input('T', {}) // Q3 quick jump with uppercase
    await input('', { return: true }) // commit Q3

    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })
    expect(submitAnswers).toHaveBeenCalledWith('tool-shortcuts', {
      Q1: 'x',
      Q2: 't',
      Q3: 'T',
    })
  })

  it('ignores out-of-range numeric shortcuts and non-return fallthrough inputs', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-out-of-range"
        questions={[
          singleQuestion({
            header: 'R',
            options: [
              { label: 'A', description: '' },
              { label: 'B', description: '' },
            ],
          }),
        ]}
      />,
    )

    await input('9', {}) // numeric shortcut but out of range
    await input('x', { ctrl: true }) // reaches key.return false path
    expect(submitAnswers).toHaveBeenCalledTimes(0)

    await input('1', {})
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })
    expect(submitAnswers).toHaveBeenCalledWith('tool-out-of-range', { R: 'A' })
  })

  it('covers multi-select space/enter behavior on option and submit rows', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-multi-branches"
        questions={[
          singleQuestion({
            header: 'M',
            multiSelect: true,
            options: [
              { label: 'One', description: '' },
              { label: 'Two', description: '' },
            ],
          }),
        ]}
      />,
    )

    await input(' ', {}) // toggle cursor=0 via space
    await input('', { downArrow: true }) // move to option 2
    await input('', { return: true }) // toggle via Enter
    await input('', { downArrow: true }) // move to submit row
    await input(' ', {}) // space on submit row: no toggle branch
    await input('', { return: true }) // submit row enter => next tab
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-multi-branches', { M: 'One, Two' })
  })

  it('supports numeric shortcut toggling in multi-select', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-multi-numeric"
        questions={[
          singleQuestion({
            header: 'MN',
            multiSelect: true,
            options: [
              { label: 'One', description: '' },
              { label: 'Two', description: '' },
            ],
          }),
        ]}
      />,
    )

    await input('2', {}) // numeric toggle for second option
    await input('9', {}) // out of range numeric on multi-select (line 227 false branch)
    await input('', { tab: true }) // to review
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-multi-numeric', { MN: 'Two' })
  })

  it('handles up-arrow cursor movement on question page', async () => {
    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject: vi.fn(),
    }

    render(
      <AskUserQuestionToolBlock
        toolUseId="tool-up-arrow"
        questions={[singleQuestion({ header: 'U', options: [{ label: 'Only', description: '' }] })]}
      />,
    )

    await input('', { upArrow: true })
  })

  it('confirms single-select option via Enter without numeric shortcut', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-enter-single"
        questions={[singleQuestion({ header: 'E', options: [{ label: 'Only', description: '' }] })]}
      />,
    )

    await input('', { return: true }) // select cursor=0 option and advance
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-enter-single', { E: 'Only' })
  })

  it('enters typing on single-select custom row via Enter', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-enter-custom"
        questions={[singleQuestion({ header: 'C', options: [{ label: 'Only', description: '' }] })]}
      />,
    )

    await input('', { downArrow: true }) // move to custom row
    await input('', { return: true }) // enter typing mode via Enter (line 278 path)
    await input('z', {})
    await input('', { return: true }) // commit and advance
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-enter-custom', { C: 'z' })
  })

  it('moves cursor with up/down on second question (multi-question map branches)', async () => {
    mocks.userInput = {
      submitAnswers: vi.fn(),
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-multi-question-cursor"
        questions={[
          singleQuestion({ header: 'Q1', options: [{ label: 'A', description: '' }] }),
          singleQuestion({ header: 'Q2', options: [{ label: 'B', description: '' }] }),
        ]}
      />,
    )

    await input('', { tab: true }) // move to Q2
    await waitForText(view.lastFrame, 'Pick one')
    await input('', { downArrow: true })
    await input('', { upArrow: true })
  })

  it('supports typing-mode map updates with non-active questions preserved', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-typing-map-preserve"
        questions={[
          singleQuestion({ header: 'Q1', options: [{ label: 'A', description: '' }] }),
          singleQuestion({ header: 'Q2', options: [{ label: 'B', description: '' }] }),
        ]}
      />,
    )

    await input('', { tab: true }) // Q2
    await input('2', {}) // typing row
    await input('z', {})
    await input('', { backspace: true }) // line 150 map branch with i!==activeTab
    await input('', { upArrow: true }) // line 132 map branch with i!==activeTab
    await input('', { downArrow: true })
    await input('y', {})
    await input('', { return: true }) // commit
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { upArrow: true }) // submit-tab up-arrow branch (line 177)
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-typing-map-preserve', { Q1: '', Q2: 'y' })
  })

  it('keeps typing mode when pressing ArrowDown on custom row', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-typing-down"
        questions={[singleQuestion({ header: 'TD', options: [{ label: 'Only', description: '' }] })]}
      />,
    )

    await input('2', {}) // enter typing row
    await input('a', {})
    await input('', { downArrow: true }) // stays on custom row, typing remains true
    await input('b', {})
    await input('', { return: true })
    await waitForText(view.lastFrame, 'Review your answers')
    await input('', { return: true })

    expect(submitAnswers).toHaveBeenCalledWith('tool-typing-down', { TD: 'ab' })
  })

  it('resizes internal state when question list grows and shrinks', async () => {
    const submitAnswers = vi.fn()
    mocks.userInput = {
      submitAnswers,
      reject: vi.fn(),
    }

    const view = render(
      <AskUserQuestionToolBlock
        toolUseId="tool-resize"
        questions={[singleQuestion({ header: 'R1', options: [{ label: 'A', description: '' }] })]}
      />,
    )
    await tick()

    view.rerender(
      <AskUserQuestionToolBlock
        toolUseId="tool-resize"
        questions={[
          singleQuestion({ header: 'R1', options: [{ label: 'A', description: '' }] }),
          singleQuestion({ header: 'R2', options: [{ label: 'B', description: '' }] }),
        ]}
      />,
    )
    await tick()

    view.rerender(
      <AskUserQuestionToolBlock
        toolUseId="tool-resize"
        questions={[singleQuestion({ header: 'R1', options: [{ label: 'A', description: '' }] })]}
      />,
    )
    await tick()
  })
})
