import { describe, expect, it, vi } from 'vitest'
import type { UserInputManager } from './userInputManager.js'
import {
  createApprovalPromptDescriptor,
  createAskUserQuestionPromptDescriptor,
} from './interactivePromptDescriptor.js'
import {
  getInteractivePromptFailureMessage,
  normalizeApprovalLikeAnswer,
  runInteractivePromptTransaction,
  toInteractivePromptFailureToolResult,
  throwInteractivePromptFailure,
} from './interactivePromptTransaction.js'

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

  it('uses descriptor request payload and emitToolUpdate override', async () => {
    const onEvent = vi.fn()
    const userInput = createUserInput({
      requestAnswers: async () => ({ decision: 'approve' }),
    })
    const descriptor = createApprovalPromptDescriptor({
      call: { id: 't1' },
      toolName: 'Bash',
      action: { kind: 'bash.exec', command: 'echo hi' },
      effectiveDecision: 'prompt',
      emitToolUpdate: false,
    })
    const res = await runInteractivePromptTransaction({
      call: { id: 't1', name: 'Bash', input: { command: 'echo hi' } } as any,
      ctx: { cwd: '/tmp', agentDepth: 0, onEvent },
      userInput,
      descriptor,
      questions: [{ question: 'ignored', header: 'Ignored', options: [], multiSelect: false }],
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('Expected success')
    expect(res.answers).toEqual({ decision: 'approve' })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval_request',
        toolUseId: 't1',
        toolName: 'Bash',
      }),
    )
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_update', id: 't1' }))
  })

  it('uses ask descriptor questions when descriptor is provided', async () => {
    const userInput = createUserInput({
      requestAnswers: async () => ({ Choice: 'A' }),
    })
    const requestAnswersSpy = vi.spyOn(userInput, 'requestAnswers')
    const descriptor = createAskUserQuestionPromptDescriptor({
      call: { id: 'ask-1' },
      questions: [{ question: 'Pick', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      emitToolUpdate: false,
    })
    const res = await runInteractivePromptTransaction({
      call: { id: 'ask-1', name: 'AskUserQuestion', input: {} } as any,
      ctx: { cwd: '/tmp', agentDepth: 0 },
      userInput,
      descriptor,
      questions: [{ question: 'Wrong', header: 'Wrong', options: [], multiSelect: false }],
      unavailableContent: 'Error: unavailable',
      abortedContent: 'Request aborted',
    })

    expect(res.ok).toBe(true)
    if (res.ok !== true) throw new Error('Expected success')
    expect(requestAnswersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolUseId: 'ask-1',
        questions: [{ question: 'Pick', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false }],
      }),
    )
  })
})

describe('getInteractivePromptFailureMessage', () => {
  it('strips Error prefix when present', () => {
    const message = getInteractivePromptFailureMessage({
      result: { content: 'Error: boom' },
    })
    expect(message).toBe('boom')
  })

  it('returns trimmed content when no Error prefix is present', () => {
    const message = getInteractivePromptFailureMessage({
      result: { content: '  Request aborted  ' },
    })
    expect(message).toBe('Request aborted')
  })

  it('falls back when content is empty', () => {
    const message = getInteractivePromptFailureMessage({
      result: { content: '   ' },
      fallbackMessage: 'Fallback error',
    })
    expect(message).toBe('Fallback error')
  })
})

describe('throwInteractivePromptFailure', () => {
  it('throws parsed failure message', () => {
    expect(() =>
      throwInteractivePromptFailure({
        result: { content: 'Error: request rejected' },
      }),
    ).toThrowError('request rejected')
  })
})

describe('toInteractivePromptFailureToolResult', () => {
  it('returns Error-prefixed tool result with parsed message', () => {
    const result = toInteractivePromptFailureToolResult({
      toolUseId: 'tool-1',
      result: { content: 'Error: boom' },
    })
    expect(result).toEqual({
      tool_use_id: 'tool-1',
      content: 'Error: boom',
      is_error: true,
    })
  })

  it('prefixes non-prefixed content to preserve tool-error shape', () => {
    const result = toInteractivePromptFailureToolResult({
      toolUseId: 'tool-2',
      result: { content: 'Request aborted' },
    })
    expect(result).toEqual({
      tool_use_id: 'tool-2',
      content: 'Error: Request aborted',
      is_error: true,
    })
  })
})

describe('normalizeApprovalLikeAnswer', () => {
  it('normalizes decision and feedback fields', () => {
    const normalized = normalizeApprovalLikeAnswer({
      decision: '  APPROVE_REMEMBER ',
      feedback: '  please persist  ',
    })
    expect(normalized).toEqual({
      decision: 'approve_remember',
      feedback: 'please persist',
    })
  })

  it('handles missing decision and feedback as empty strings', () => {
    const normalized = normalizeApprovalLikeAnswer({})
    expect(normalized).toEqual({
      decision: '',
      feedback: '',
    })
  })
})
