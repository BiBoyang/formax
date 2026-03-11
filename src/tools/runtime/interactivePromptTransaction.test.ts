import { describe, expect, it, vi } from 'vitest'
import type { UserInputManager } from './userInputManager.js'
import { runInteractivePromptTransaction } from './interactivePromptTransaction.js'

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

describe('runInteractivePromptTransaction', () => {
  it('returns unavailable result when userInput is missing', async () => {
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0 },
      userInput: null,
      questions: [],
      unavailableContent: 'Error: input unavailable',
      abortedContent: 'Error: Request aborted',
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Error: input unavailable')
    expect(res.result.is_error).toBe(true)
  })

  it('returns unavailable result when interactive mode is disabled and required', async () => {
    const userInput = createUserInput()
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'Skill', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, interactive: false },
      userInput,
      questions: [],
      requireInteractive: true,
      unavailableContent: 'Error: approval required',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Error: approval required')
  })

  it('returns aborted result when signal is already aborted', async () => {
    const userInput = createUserInput()
    const controller = new AbortController()
    controller.abort()
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, signal: controller.signal },
      userInput,
      questions: [],
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Request aborted')
  })

  it('emits request event and keepalive tool_update by default', async () => {
    const onEvent = vi.fn()
    const userInput = createUserInput({
      requestAnswers: async () => ({ choice: 'A' }),
    })
    const beforeRequest = vi.fn()
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      userInput,
      questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
      requestEvent: {
        type: 'ask_user_question',
        toolUseId: 't1',
        questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
      },
      beforeRequest,
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('Expected success')
    expect(res.answers).toEqual({ choice: 'A' })
    expect(beforeRequest).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ask_user_question', toolUseId: 't1' }))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_update', id: 't1' }))
  })

  it('skips tool_update event when emitToolUpdate is false', async () => {
    const onEvent = vi.fn()
    const userInput = createUserInput({
      requestAnswers: async () => ({ choice: 'A' }),
    })
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      userInput,
      questions: [{ question: 'Q', header: 'H', options: [], multiSelect: false }],
      emitToolUpdate: false,
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('Expected success')
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_update', id: 't1' }))
  })

  it('converts thrown non-Error values into Error-prefixed result content', async () => {
    const userInput = createUserInput({
      requestAnswers: async () => {
        throw 'boom'
      },
    })
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0 },
      userInput,
      questions: [],
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(false)
    if (res.ok !== false) throw new Error('Expected failure')
    expect(res.result.content).toBe('Error: boom')
  })
})
