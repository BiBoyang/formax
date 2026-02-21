import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppAction } from '../../store'
import { useDevRuntimeApi } from './useDevRuntimeApi'

type DevApiWindow = Window & {
  __formaxDevAskUserQuestion?: (overrides?: {
    inputId?: string
    threadId?: string
    turnId?: string
    toolUseId?: string
  }) => string
  __formaxDevClearPendingInputs?: () => void
}

function clearDevWindowApis(): void {
  const devWindow = window as DevApiWindow
  delete devWindow.__formaxDevAskUserQuestion
  delete devWindow.__formaxDevClearPendingInputs
}

describe('useDevRuntimeApi', () => {
  afterEach(() => {
    clearDevWindowApis()
  })

  it('registers dev helpers and dispatches ask-user-question actions', () => {
    const dispatch = vi.fn<(action: AppAction) => void>()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)

    const { unmount } = renderHook(() =>
      useDevRuntimeApi({
        dispatch,
        activeThreadId: 'thread-1',
        activeTurnId: 'turn-1',
        enabled: true,
      }),
    )

    try {
      const devWindow = window as DevApiWindow
      expect(typeof devWindow.__formaxDevAskUserQuestion).toBe('function')
      expect(typeof devWindow.__formaxDevClearPendingInputs).toBe('function')

      const inputId = devWindow.__formaxDevAskUserQuestion?.()
      expect(inputId).toBe('dev-ask-1700000000000')
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(dispatch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          type: 'input_requested',
          input: expect.objectContaining({
            inputId: 'dev-ask-1700000000000',
            threadId: 'thread-1',
            turnId: 'turn-1',
            kind: 'ask_user_question',
            status: 'pending',
          }),
        }),
      )
      expect(dispatch).toHaveBeenNthCalledWith(2, {
        type: 'set_selected_input',
        inputId: 'dev-ask-1700000000000',
      })

      devWindow.__formaxDevClearPendingInputs?.()
      expect(dispatch).toHaveBeenNthCalledWith(3, { type: 'clear_pending_inputs' })
    } finally {
      unmount()
      nowSpy.mockRestore()
    }

    const devWindow = window as DevApiWindow
    expect(devWindow.__formaxDevAskUserQuestion).toBeUndefined()
    expect(devWindow.__formaxDevClearPendingInputs).toBeUndefined()
  })

  it('does not register dev helpers when disabled', () => {
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
    expect(devWindow.__formaxDevClearPendingInputs).toBeUndefined()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
