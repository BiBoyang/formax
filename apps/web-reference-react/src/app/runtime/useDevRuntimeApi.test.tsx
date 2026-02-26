import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppAction } from '../../store'
import { useDevRuntimeApi } from './useDevRuntimeApi'

type DevInputBaseOverrides = {
  inputId?: string
  threadId?: string
  turnId?: string
  toolUseId?: string
}

type DevApprovalOverrides = DevInputBaseOverrides & {
  toolName?: string
  action?: unknown
  effectiveDecision?: unknown
  suggestions?: string[]
  workspaceRequest?: { dir: string } | null
}

type DevApiWindow = Window & {
  __formaxDevAskUserQuestion?: (overrides?: DevInputBaseOverrides) => string
  __formaxDevApprovalInput?: (overrides?: DevApprovalOverrides) => string
  __formaxDevClearPendingInputs?: () => void
}

function clearDevWindowApis(): void {
  const devWindow = window as DevApiWindow
  delete devWindow.__formaxDevAskUserQuestion
  delete devWindow.__formaxDevApprovalInput
  delete devWindow.__formaxDevClearPendingInputs
}

describe('useDevRuntimeApi', () => {
  afterEach(() => {
    clearDevWindowApis()
    vi.restoreAllMocks()
  })

  it('registers ask, approval, and clear helpers when enabled', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    expect(typeof devWindow.__formaxDevAskUserQuestion).toBe('function')
    expect(typeof devWindow.__formaxDevApprovalInput).toBe('function')
    expect(typeof devWindow.__formaxDevClearPendingInputs).toBe('function')
  })

  it('does not register any helper when disabled', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: false,
      }),
    )

    const devWindow = window as DevApiWindow
    expect(devWindow.__formaxDevAskUserQuestion).toBeUndefined()
    expect(devWindow.__formaxDevApprovalInput).toBeUndefined()
    expect(devWindow.__formaxDevClearPendingInputs).toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches ask helper default payload with active thread/turn', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    const inputId = devWindow.__formaxDevAskUserQuestion?.()

    expect(inputId).toBe('dev-ask-1700000000000')
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({
          inputId: 'dev-ask-1700000000000',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'dev-tool-ask-1700000000000',
          kind: 'ask_user_question',
          status: 'pending',
          createdAt: '2023-11-14T22:13:20.000Z',
          expiresAt: '2023-11-14T22:23:20.000Z',
        }),
      }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'set_selected_input',
      inputId: 'dev-ask-1700000000000',
    })
  })

  it('dispatches ask helper override payload', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    const inputId = devWindow.__formaxDevAskUserQuestion?.({
      inputId: 'ask-override-1',
      threadId: 'thread-override',
      turnId: 'turn-override',
      toolUseId: 'tool-override',
    })

    expect(inputId).toBe('ask-override-1')
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({
          inputId: 'ask-override-1',
          threadId: 'thread-override',
          turnId: 'turn-override',
          toolUseId: 'tool-override',
          kind: 'ask_user_question',
        }),
      }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: 'set_selected_input', inputId: 'ask-override-1' })
  })

  it('uses fallback thread/turn for ask helper when active context is null', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()
    vi.spyOn(Date, 'now').mockReturnValue(1700000000100)

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: null,
        activeTurnId: null,
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    devWindow.__formaxDevAskUserQuestion?.()

    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({
          threadId: 'dev-thread',
          turnId: 'dev-turn-1700000000100',
        }),
      }),
    )
  })

  it('dispatches approval helper default payload with active thread/turn', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()
    vi.spyOn(Date, 'now').mockReturnValue(1700000000200)

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    const inputId = devWindow.__formaxDevApprovalInput?.()

    expect(inputId).toBe('dev-approval-1700000000200')
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({
          inputId: 'dev-approval-1700000000200',
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'dev-tool-approval-1700000000200',
          kind: 'approval',
          status: 'pending',
          createdAt: '2023-11-14T22:13:20.200Z',
          expiresAt: '2023-11-14T22:23:20.200Z',
          payload: expect.objectContaining({
            toolName: 'Bash',
            action: { kind: 'bash.exec', command: 'npm run test' },
            effectiveDecision: { decision: 'ask' },
          }),
        }),
      }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'set_selected_input',
      inputId: 'dev-approval-1700000000200',
    })
  })

  it('dispatches approval helper override payload', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    const inputId = devWindow.__formaxDevApprovalInput?.({
      inputId: 'approval-override-1',
      threadId: 'thread-override',
      turnId: 'turn-override',
      toolUseId: 'tool-override',
      toolName: 'Read',
      action: { kind: 'fs.read', path: '/tmp/outside.txt' },
      effectiveDecision: { decision: 'ask' },
      suggestions: ['line-1'],
      workspaceRequest: { dir: '/repo' },
    })

    expect(inputId).toBe('approval-override-1')
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({
          inputId: 'approval-override-1',
          threadId: 'thread-override',
          turnId: 'turn-override',
          toolUseId: 'tool-override',
          kind: 'approval',
          payload: expect.objectContaining({
            toolName: 'Read',
            action: { kind: 'fs.read', path: '/tmp/outside.txt' },
            effectiveDecision: { decision: 'ask' },
            suggestions: ['line-1'],
            workspaceRequest: { dir: '/repo' },
          }),
        }),
      }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'set_selected_input',
      inputId: 'approval-override-1',
    })
  })

  it('dispatches clear_pending_inputs through clear helper', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    const devWindow = window as DevApiWindow
    devWindow.__formaxDevClearPendingInputs?.()

    expect(dispatch).toHaveBeenCalledWith({ type: 'clear_pending_inputs' })
  })

  it('rerender updates helper closures to latest active thread and turn', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    const { rerender } = renderHook(
      (props: { activeThreadId: string | null; activeTurnId: string | null; enabled: boolean }) =>
        useDevRuntimeApi({
          dispatch,
          activeThreadId: props.activeThreadId,
          activeTurnId: props.activeTurnId,
          enabled: props.enabled,
        }),
      {
        initialProps: {
          activeThreadId: 'thread-a',
          activeTurnId: 'turn-a',
          enabled: true,
        },
      },
    )

    const devWindow = window as DevApiWindow
    devWindow.__formaxDevAskUserQuestion?.({ inputId: 'ask-a' })

    rerender({ activeThreadId: 'thread-b', activeTurnId: 'turn-b', enabled: true })

    devWindow.__formaxDevApprovalInput?.({ inputId: 'approval-b' })

    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({ inputId: 'ask-a', threadId: 'thread-a', turnId: 'turn-a' }),
      }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({ inputId: 'approval-b', threadId: 'thread-b', turnId: 'turn-b' }),
      }),
    )
  })

  it('cleans all helpers on unmount', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    const { unmount } = renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    unmount()

    const devWindow = window as DevApiWindow
    expect(devWindow.__formaxDevAskUserQuestion).toBeUndefined()
    expect(devWindow.__formaxDevApprovalInput).toBeUndefined()
    expect(devWindow.__formaxDevClearPendingInputs).toBeUndefined()
  })

  it('unregisters and re-registers helpers when enabled toggles true -> false -> true', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()

    const { rerender } = renderHook(
      (props: { activeThreadId: string | null; activeTurnId: string | null; enabled: boolean }) =>
        useDevRuntimeApi({
          dispatch,
          activeThreadId: props.activeThreadId,
          activeTurnId: props.activeTurnId,
          enabled: props.enabled,
        }),
      {
        initialProps: {
          activeThreadId: 'thread-a',
          activeTurnId: 'turn-a',
          enabled: true,
        },
      },
    )

    const devWindow = window as DevApiWindow
    expect(typeof devWindow.__formaxDevAskUserQuestion).toBe('function')
    expect(typeof devWindow.__formaxDevApprovalInput).toBe('function')
    expect(typeof devWindow.__formaxDevClearPendingInputs).toBe('function')

    rerender({ activeThreadId: 'thread-a', activeTurnId: 'turn-a', enabled: false })

    expect(devWindow.__formaxDevAskUserQuestion).toBeUndefined()
    expect(devWindow.__formaxDevApprovalInput).toBeUndefined()
    expect(devWindow.__formaxDevClearPendingInputs).toBeUndefined()

    rerender({ activeThreadId: 'thread-c', activeTurnId: 'turn-c', enabled: true })

    expect(typeof devWindow.__formaxDevAskUserQuestion).toBe('function')
    expect(typeof devWindow.__formaxDevApprovalInput).toBe('function')
    expect(typeof devWindow.__formaxDevClearPendingInputs).toBe('function')

    devWindow.__formaxDevAskUserQuestion?.({ inputId: 'ask-c' })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'input_requested',
        input: expect.objectContaining({ inputId: 'ask-c', threadId: 'thread-c', turnId: 'turn-c' }),
      }),
    )
  })
})
