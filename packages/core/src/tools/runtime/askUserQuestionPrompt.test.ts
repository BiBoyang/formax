import { describe, expect, it, vi } from 'vitest'
import type { UserInputManager } from './userInputManager.js'
import {
  requestAskUserQuestionAnswers,
  requestAskUserQuestionAnswersResult,
} from './askUserQuestionPrompt.js'

function createUserInput(overrides: Partial<UserInputManager> = {}): UserInputManager {
  return {
    requestAnswers: async () => ({}),
    submitAnswers: () => true,
    reject: () => true,
    rejectAllPending: () => 0,
    clearBufferedAnswers: () => {},
    isPending: () => false,
    ...overrides,
  }
}

describe('requestAskUserQuestionAnswersResult', () => {
  it('returns collected answers', async () => {
    const onEvent = vi.fn()
    const requestAnswers = vi.fn(async () => ({ header: 'value' }))
    const userInput = createUserInput({
      requestAnswers,
    })
    const res = await requestAskUserQuestionAnswersResult({
      call: { id: 'ask-1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      userInput,
      questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
      promptData: {
        kind: 'exit_plan_mode',
        planPath: '/tmp/plan.md',
        planContentState: { status: 'loaded', text: 'plan body' },
      },
    })

    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('Expected success')
    expect(res.answers).toEqual({ header: 'value' })
    expect(requestAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          promptData: {
            kind: 'exit_plan_mode',
            planPath: '/tmp/plan.md',
            planContentState: { status: 'loaded', text: 'plan body' },
          },
        }),
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ask_user_question', toolUseId: 'ask-1' }))
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_update', id: 'ask-1' }))
  })

  it('returns failed result when prompt request throws', async () => {
    const userInput = createUserInput({
      requestAnswers: async () => {
        throw new Error('boom')
      },
    })
    const res = await requestAskUserQuestionAnswersResult({
      call: { id: 'ask-err', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0 },
      userInput,
      questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Error: boom')
    expect(res.result.is_error).toBe(true)
  })

  it('returns aborted result when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const userInput = createUserInput()
    const res = await requestAskUserQuestionAnswersResult({
      call: { id: 'ask-abort', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, signal: controller.signal },
      userInput,
      questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Request aborted')
  })
})

describe('requestAskUserQuestionAnswers', () => {
  it('throws parsed error message from failed result', async () => {
    const userInput = createUserInput({
      requestAnswers: async () => {
        throw new Error('boom')
      },
    })

    await expect(
      requestAskUserQuestionAnswers({
        call: { id: 'ask-throw', name: 'AskUserQuestion', input: {} } as any,
        ctx: { cwd: '/tmp', agentDepth: 0 },
        userInput,
        questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
      }),
    ).rejects.toThrowError('boom')
  })
})
