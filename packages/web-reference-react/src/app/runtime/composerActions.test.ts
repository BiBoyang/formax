import { describe, expect, it, vi } from 'vitest'
import type { PendingInput } from '../../types'
import { createComposerActions, type ComposerActionsContext } from './composerActions'
import type { CreatedThreadResult } from './threadActions'

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
  let currentActiveThreadId: string | null =
    Object.prototype.hasOwnProperty.call(overrides, 'activeThreadId') ? (overrides.activeThreadId ?? null) : 'thread-1'
  let currentNewThreadDraft: ComposerActionsContext['newThreadDraft'] =
    Object.prototype.hasOwnProperty.call(overrides, 'newThreadDraft') ? (overrides.newThreadDraft ?? { status: 'inactive' }) : { status: 'inactive' }
  return {
    inputText: 'hello',
    setInputText: vi.fn(),
    isSendingTurn: false,
    isInterruptingTurn: false,
    isSubmittingInput: false,
    mode: 'normal',
    activeThreadId: 'thread-1',
    activeTurnId: null,
    newThreadDraft: { status: 'inactive' },
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
    toRpcError: vi.fn((method: string) => ({ at: '2026-02-20T00:00:00.000Z', method, message: 'boom' })),
    nowMs: vi.fn(() => 123),
    startThread: vi.fn(async () => {}),
    createThreadOnServerInCwd: vi.fn(async (cwd: string): Promise<CreatedThreadResult> => ({
      thread: { id: 'draft-thread', cwd },
      effectiveCwd: cwd,
    })),
    activateCreatedThread: vi.fn(async () => undefined),
    leaveNewThreadDraft: vi.fn(),
    refreshThreads: vi.fn(async () => undefined),
    refreshWorkspaceDiff: vi.fn(async () => undefined),
    getCurrentActiveThreadId: vi.fn(() => currentActiveThreadId),
    getCurrentNewThreadDraft: vi.fn(() => currentNewThreadDraft),
    retirePendingInputLocally: vi.fn(),
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

  it('warns and does not create thread when draft is active without cwd', async () => {
    const ctx = createBaseContext({
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: null },
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.log).toHaveBeenCalledWith('Please choose a project before starting a new thread', 'warn')
    expect(ctx.createThreadOnServerInCwd).not.toHaveBeenCalled()
    expect(ctx.request).not.toHaveBeenCalled()
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
    expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: 'push_message', role: 'user', text: 'hello' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: 'turn-2' })
    expect(ctx.dispatch).not.toHaveBeenCalledWith({ type: 'bind_last_user_message_turn', turnId: 'turn-2' })
    expect(ctx.setInputText).toHaveBeenCalledWith('')
    expect(ctx.setIsSendingTurn).toHaveBeenNthCalledWith(1, true)
    expect(ctx.setIsSendingTurn).toHaveBeenLastCalledWith(false)
  })

  it('waits for pending preference persistence before starting a turn', async () => {
    const calls: string[] = []
    const ctx = createBaseContext({
      awaitPreferencePersistence: vi.fn(async () => {
        calls.push('preferences')
      }),
      request: vi.fn(async () => {
        calls.push('turn')
        return { turn: { id: 'turn-2' } }
      }),
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(calls).toEqual(['preferences', 'turn'])
    expect(ctx.setInputText).toHaveBeenCalledWith('')
  })

  it('does not clear input or send when pending preference persistence fails', async () => {
    const ctx = createBaseContext({
      awaitPreferencePersistence: vi.fn(async () => {
        throw new Error('preference failed')
      }),
      request: vi.fn(async () => ({ turn: { id: 'turn-2' } })),
    })

    const actions = createComposerActions(ctx)
    await expect(actions.startTurn()).rejects.toThrow('preference failed')

    expect(ctx.request).not.toHaveBeenCalled()
    expect(ctx.setInputText).not.toHaveBeenCalledWith('')
    expect(ctx.setInputText).toHaveBeenCalledWith(expect.any(Function))
  })

  it('creates and activates a draft thread before first turn start', async () => {
    const request = vi.fn(async () => ({ turn: { id: 'turn-draft-1' } }))
    const ctx = createBaseContext({
      inputText: 'build it',
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
      request,
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.createThreadOnServerInCwd).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.activateCreatedThread).toHaveBeenCalledWith({
      thread: { id: 'draft-thread', cwd: '/draft-repo' },
      effectiveCwd: '/draft-repo',
    }, { synchronize: false, modeOverride: 'normal' })
    expect(ctx.leaveNewThreadDraft).toHaveBeenCalledTimes(1)
    expect(ctx.request).toHaveBeenCalledWith('turn/start', {
      threadId: 'draft-thread',
      input: { text: 'build it' },
      mode: 'normal',
      cwd: '/draft-repo',
    })
    expect(ctx.refreshThreads).toHaveBeenCalledTimes(1)
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'set_active_turn', turnId: 'turn-draft-1' })
  })

  it('creates and activates a draft thread before supported slash command dispatch', async () => {
    const request = vi.fn(async () => ({ turn: { id: 'turn-command-1' } }))
    const ctx = createBaseContext({
      inputText: '/compact',
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
      request,
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.createThreadOnServerInCwd).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.request).toHaveBeenCalledWith('command/dispatch', {
      threadId: 'draft-thread',
      command: '/compact',
      mode: 'normal',
      cwd: '/draft-repo',
    })
    expect(ctx.refreshThreads).toHaveBeenCalledTimes(1)
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.commandByTurnRef.current.get('turn-command-1')).toBe('/compact')
  })

  it('refreshes threads and diff after a draft-created local command returns stdout', async () => {
    const request = vi.fn(async () => ({ local: { stdout: 'local output' } }))
    const ctx = createBaseContext({
      inputText: '/todos',
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
      request,
    })
    ;(ctx.getCurrentActiveThreadId as ReturnType<typeof vi.fn>).mockReturnValue(null)
    ;(ctx.getCurrentNewThreadDraft as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'active',
      source: 'newThread',
      cwd: '/draft-repo',
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.refreshThreads).toHaveBeenCalledTimes(1)
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'push_message', role: 'user', text: '/todos' })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'push_message', role: 'assistant', text: 'local output' })
  })

  it('does not reactivate a stale draft send after the user navigates away', async () => {
    let currentActiveThreadId: string | null = null
    let currentNewThreadDraft: ComposerActionsContext['newThreadDraft'] = {
      status: 'active',
      source: 'newThread',
      cwd: '/draft-repo',
    }
    const ctx = createBaseContext({
      inputText: 'hello',
      activeThreadId: null,
      newThreadDraft: currentNewThreadDraft,
      createThreadOnServerInCwd: vi.fn(async (cwd: string): Promise<CreatedThreadResult> => {
        currentActiveThreadId = 'thread-existing'
        currentNewThreadDraft = { status: 'inactive' }
        return {
          thread: { id: 'draft-thread', cwd },
          effectiveCwd: cwd,
        }
      }),
      getCurrentActiveThreadId: vi.fn(() => currentActiveThreadId),
      getCurrentNewThreadDraft: vi.fn(() => currentNewThreadDraft),
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.activateCreatedThread).not.toHaveBeenCalled()
    expect(ctx.leaveNewThreadDraft).not.toHaveBeenCalled()
    expect(ctx.refreshThreads).toHaveBeenCalledTimes(1)
    expect(ctx.request).not.toHaveBeenCalled()
  })

  it('restores draft input text when thread creation returns no thread payload', async () => {
    let inputValue = 'hello'
    const setInputText = vi.fn((next: string | ((prev: string) => string)) => {
      inputValue = typeof next === 'function' ? next(inputValue) : next
    })
    const ctx = createBaseContext({
      inputText: 'hello',
      setInputText,
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
      createThreadOnServerInCwd: vi.fn(async () => null),
    })

    const actions = createComposerActions(ctx)
    await expect(actions.startTurn()).rejects.toThrow('thread/start returned no thread payload')

    expect(ctx.log).toHaveBeenCalledWith('Failed to create thread for draft first send', 'error')
    expect(ctx.request).not.toHaveBeenCalled()
    expect(inputValue).toBe('hello')
  })

  it('does not create a thread for /clear while draft is active', async () => {
    const ctx = createBaseContext({
      inputText: '/clear',
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
    })

    const actions = createComposerActions(ctx)
    await actions.startTurn()

    expect(ctx.setInputText).toHaveBeenCalledWith('')
    expect(ctx.startThread).not.toHaveBeenCalled()
    expect(ctx.createThreadOnServerInCwd).not.toHaveBeenCalled()
    expect(ctx.request).not.toHaveBeenCalled()
  })

  it('restores input text when turn request fails', async () => {
    let inputValue = 'hello'
    const setInputText = vi.fn((next: string | ((prev: string) => string)) => {
      inputValue = typeof next === 'function' ? next(inputValue) : next
    })
    const ctx = createBaseContext({
      setInputText,
      request: vi.fn(async () => {
        throw new Error('network down')
      }),
    })

    const actions = createComposerActions(ctx)
    await expect(actions.startTurn()).rejects.toThrow('network down')

    expect(inputValue).toBe('hello')
    expect(setInputText).toHaveBeenCalledWith('')
    const restoreCall = setInputText.mock.calls.find(
      (call) => typeof call[0] === 'function',
    )
    expect(restoreCall).toBeDefined()
  })

  it('restores draft input text when first turn request fails after thread creation', async () => {
    let inputValue = 'hello'
    const setInputText = vi.fn((next: string | ((prev: string) => string)) => {
      inputValue = typeof next === 'function' ? next(inputValue) : next
    })
    const ctx = createBaseContext({
      inputText: 'hello',
      setInputText,
      activeThreadId: null,
      newThreadDraft: { status: 'active', source: 'newThread', cwd: '/draft-repo' },
      request: vi.fn(async () => {
        throw new Error('network down')
      }),
    })

    const actions = createComposerActions(ctx)
    await expect(actions.startTurn()).rejects.toThrow('network down')

    expect(ctx.createThreadOnServerInCwd).toHaveBeenCalledWith('/draft-repo')
    expect(ctx.leaveNewThreadDraft).toHaveBeenCalledTimes(1)
    expect(ctx.refreshThreads).toHaveBeenCalledTimes(1)
    expect(ctx.refreshWorkspaceDiff).toHaveBeenCalledWith('/draft-repo')
    expect(inputValue).toBe('hello')
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

  it('locally resolves stale pending input when submit returns INPUT_EXPIRED', async () => {
    const input = createPendingInput()
    const error = new Error('INPUT_EXPIRED')
    const ctx = createBaseContext({
      getPendingInputById: vi.fn(() => input),
      request: vi.fn(async () => {
        throw error
      }),
      toRpcError: vi.fn((method: string) => ({
        at: '2026-02-20T00:00:00.000Z',
        method,
        code: -32602,
        message: 'INPUT_EXPIRED',
        data: { kind: 'INPUT_EXPIRED' },
      })),
    })

    const actions = createComposerActions(ctx)
    await expect(actions.submitInputById(input.inputId, { decision: 'approve' })).resolves.toBeUndefined()

    expect(ctx.retirePendingInputLocally).toHaveBeenCalledWith({
      input,
      status: 'expired',
      reason: 'input_expired',
    })
    expect(ctx.setSubmitStatusByInputId).toHaveBeenCalled()
    const submitStatusCalls = vi.mocked(ctx.setSubmitStatusByInputId).mock.calls
    const updater = submitStatusCalls[submitStatusCalls.length - 1]?.[0]
    expect(typeof updater).toBe('function')
    expect(
      updater ? updater({}) : null,
    ).toEqual({
      'input-1': {
        status: 'expired',
        kind: 'error',
        message: 'Input expired; trigger the action again',
      },
    })
  })

  it('retires terminal pending input when submit returns not_pending', async () => {
    const input = createPendingInput()
    const ctx = createBaseContext({
      getPendingInputById: vi.fn(() => input),
      request: vi.fn(async () => ({ status: 'not_pending' })),
    })

    const actions = createComposerActions(ctx)
    await actions.submitInputById(input.inputId, { decision: 'approve' })

    expect(ctx.retirePendingInputLocally).toHaveBeenCalledWith({
      input,
      reason: 'input_not_pending',
    })
    const submitStatusCalls = vi.mocked(ctx.setSubmitStatusByInputId).mock.calls
    const updater = submitStatusCalls[submitStatusCalls.length - 1]?.[0]
    expect(typeof updater).toBe('function')
    expect(
      updater ? updater({}) : null,
    ).toEqual({
      'input-1': {
        status: 'not_pending',
        kind: 'error',
        message: 'Input is no longer pending; refresh or re-run the action',
      },
    })
  })
})
