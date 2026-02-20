import { describe, expect, it, vi } from 'vitest'
import type { PendingInput } from '../../types'
import { createComposerActions, type ComposerActionsContext } from './composerActions'

function createPendingInput(overrides: Partial<PendingInput> = {}): PendingInput {
  return {
    inputId: 'input-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    toolUseId: 'tool-1',
    kind: 'approval',
    status: 'pending',
    createdAt: '2026-02-20T00:00:00.000Z',
    expiresAt: '2026-02-20T00:10:00.000Z',
    payload: {},
    ...overrides,
  }
}

function createBaseContext(overrides: Partial<ComposerActionsContext> = {}): ComposerActionsContext {
  return {
    inputText: 'hello',
    setInputText: vi.fn(),
    isSendingTurn: false,
    isInterruptingTurn: false,
    isSubmittingInput: false,
    mode: 'normal',
    activeThreadId: 'thread-1',
    activeTurnId: null,
    resolveRequestCwd: vi.fn(() => '/repo'),
    getPendingInputById: vi.fn(() => undefined),
    request: vi.fn(),
    dispatch: vi.fn(),
    log: vi.fn(),
    commandByTurnRef: { current: new Map<string, string>() },
    setIsSendingTurn: vi.fn(),
    setIsInterruptingTurn: vi.fn(),
    setIsSubmittingInput: vi.fn(),
    setSubmitStatusByInputId: vi.fn(),
    toRpcError: vi.fn(() => ({ message: 'boom' })),
    nowMs: vi.fn(() => 123),
    startThread: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('composerActions', () => {
  it('warns and does not send turn when no active thread exists', async () => {
    const ctx = createBaseContext({
      activeThreadId: null,
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.log).toHaveBeenCalledWith('Please select or create a thread first', 'warn')
    expect(ctx.request).not.toHaveBeenCalled()
    expect(ctx.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'push_message', role: 'user' }))
  })

  it('starts a turn using resolved cwd and binds returned turn id', async () => {
    const ctx = createBaseContext({
      request: vi.fn(async () => ({ turn: { id: 'turn-2' } })),
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.resolveRequestCwd).toHaveBeenCalledWith('thread-1')
    expect(ctx.request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: { text: 'hello' },
      mode: 'normal',
      cwd: '/repo',
    })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'push_message', role: 'user', text: 'hello' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: 'turn-2' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'bind_last_user_message_turn', turnId: 'turn-2' })
    expect(ctx.setInputText).toHaveBeenCalledWith('')
    expect(ctx.setIsSendingTurn).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsSendingTurn).toHaveBeenLastCalledWith(false)
  })

  it('submits pending input by id via getter lookup', async () => {
    const input = createPendingInput()
    const ctx = createBaseContext({
      getPendingInputById: vi.fn(() => input),
      request: vi.fn(async () => ({ status: 'submitted' })),
    })

    const actions = createComposerActions(ctx)
    await actions.submitInputById(input.inputId, { approval: 'yes' })

    expect(ctx.getPendingInputById).toHaveBeenCalledWith(input.inputId)
    expect(ctx.request).toHaveBeenCalledWith('turn/input/submit', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      inputId: 'input-1',
      toolUseId: 'tool-1',
      answers: { approval: 'yes' },
      submissionId: 'web-123',
    })
    expect(ctx.setIsSubmittingInput).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsSubmittingInput).toHaveBeenLastCalledWith(false)
  })
})
