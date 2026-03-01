import { describe, expect, it } from 'vitest'
import { dialogReducer, initialDialogState, type DialogState } from './reducer'

describe('ui/config/reducer', () => {
  it('returns default initial state', () => {
    expect(initialDialogState()).toEqual({ view: 'list', tab: 'config', cursor: 0 })
  })

  it('handles tab/move/open/close actions', () => {
    const base = initialDialogState()

    const setTab = dialogReducer(base, { type: 'SET_TAB', tab: 'usage' })
    expect(setTab).toEqual({ view: 'list', tab: 'usage', cursor: 0 })

    const moved = dialogReducer(setTab, { type: 'MOVE_CURSOR', next: 3 })
    expect(moved).toEqual({ view: 'list', tab: 'usage', cursor: 3 })

    const opened = dialogReducer(moved, { type: 'OPEN_OUTPUT_STYLE_SELECT' })
    expect(opened).toEqual({ view: 'outputStyleSelect', tab: 'usage', cursor: 0 })

    const closed = dialogReducer(opened, { type: 'CLOSE_SUB_VIEW' })
    expect(closed).toEqual({ view: 'list', tab: 'usage', cursor: 0 })
  })

  it('returns previous state for unknown actions', () => {
    const state: DialogState = { view: 'list', tab: 'status', cursor: 1 }
    const next = dialogReducer(state, { type: 'UNKNOWN' } as any)
    expect(next).toBe(state)
  })
})
