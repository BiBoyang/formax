import { describe, expect, it } from 'vitest'
import { dialogReducer, initialDialogState } from './reducer.js'
import type { HookEventName, HookSource } from '../../hooks/types.js'

describe('hooks dialogReducer', () => {
  const event = 'PreToolUse' as HookEventName
  const source = 'project' as HookSource

  it('initializes to event list view', () => {
    expect(initialDialogState()).toEqual({ view: { kind: 'eventList', cursor: 0, banner: null }, stack: [] })
  })

  it('supports SET_VIEW and PUSH_VIEW/POP_VIEW navigation', () => {
    const state = initialDialogState()
    const nextView = { kind: 'matcherList' as const, event, cursor: 2, banner: 'b' }

    const set = dialogReducer(state, { type: 'SET_VIEW', view: nextView })
    expect(set.view).toEqual(nextView)
    expect(set.stack).toEqual([])

    const pushed = dialogReducer(set, {
      type: 'PUSH_VIEW',
      view: { kind: 'addMatcher' as const, event, matcherInput: '' },
    })
    expect(pushed.stack).toEqual([nextView])
    expect(pushed.view.kind).toBe('addMatcher')

    const popped = dialogReducer(pushed, { type: 'POP_VIEW' })
    expect(popped.view).toEqual(nextView)
    expect(popped.stack).toEqual([])

    const noPop = dialogReducer(state, { type: 'POP_VIEW' })
    expect(noPop).toBe(state)
  })

  it('supports RESET_NAV', () => {
    const state = initialDialogState()
    const view = { kind: 'hookList' as const, event, source, matcher: '*', cursor: 0, banner: null }
    const stack = [{ kind: 'eventList' as const, cursor: 1, banner: null }]

    expect(dialogReducer(state, { type: 'RESET_NAV', view })).toEqual({ view, stack: [] })
    expect(dialogReducer(state, { type: 'RESET_NAV', view, stack })).toEqual({ view, stack })
  })

  it('updates cursor only for cursor-bearing views', () => {
    const state = { view: { kind: 'eventList' as const, cursor: 0, banner: null }, stack: [] }
    expect(dialogReducer(state, { type: 'MOVE_CURSOR', cursor: 3 }).view).toEqual({
      kind: 'eventList',
      cursor: 3,
      banner: null,
    })

    const addMatcher = { view: { kind: 'addMatcher' as const, event, matcherInput: '' }, stack: [] }
    expect(dialogReducer(addMatcher, { type: 'MOVE_CURSOR', cursor: 3 })).toStrictEqual(addMatcher)

    const confirmDelete = {
      view: {
        kind: 'confirmDeleteHook' as const,
        event,
        matcher: '*',
        command: 'python a.py',
        source,
        cursor: 0 as const,
      },
      stack: [],
    }
    expect(dialogReducer(confirmDelete, { type: 'MOVE_CURSOR', cursor: 0 }).view).toEqual(confirmDelete.view)
    expect(dialogReducer(confirmDelete, { type: 'MOVE_CURSOR', cursor: 123 }).view).toEqual({
      ...confirmDelete.view,
      cursor: 1,
    })
  })

  it('updates matcher input only in addMatcher view', () => {
    const state = initialDialogState()
    expect(dialogReducer(state, { type: 'SET_MATCHER_INPUT', value: 'x' })).toBe(state)

    const addMatcher = { view: { kind: 'addMatcher' as const, event, matcherInput: '' }, stack: [] }
    expect(dialogReducer(addMatcher, { type: 'SET_MATCHER_INPUT', value: '*' }).view).toEqual({
      kind: 'addMatcher',
      event,
      matcherInput: '*',
    })
  })

  it('updates command input only in addHook view', () => {
    const state = initialDialogState()
    expect(dialogReducer(state, { type: 'SET_COMMAND_INPUT', value: 'x' })).toBe(state)

    const addHook = { view: { kind: 'addHook' as const, event, matcher: '*', commandInput: '' }, stack: [] }
    expect(dialogReducer(addHook, { type: 'SET_COMMAND_INPUT', value: 'python a.py' }).view).toEqual({
      kind: 'addHook',
      event,
      matcher: '*',
      commandInput: 'python a.py',
    })
  })

  it('updates banner only for banner-bearing views', () => {
    const state = { view: { kind: 'eventList' as const, cursor: 0, banner: null }, stack: [] }
    expect(dialogReducer(state, { type: 'SET_BANNER', banner: 'Created' }).view).toEqual({
      kind: 'eventList',
      cursor: 0,
      banner: 'Created',
    })

    const saveHook = { view: { kind: 'saveHook' as const, event, matcher: '*', command: 'x', cursor: 0 }, stack: [] }
    expect(dialogReducer(saveHook, { type: 'SET_BANNER', banner: 'nope' })).toStrictEqual(saveHook)
  })

  it('ignores unknown actions', () => {
    const state = initialDialogState()
    expect(dialogReducer(state, { type: 'UNKNOWN' } as any)).toBe(state)
  })
})
