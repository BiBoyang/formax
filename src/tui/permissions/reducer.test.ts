import { describe, expect, it } from 'vitest'
import { dialogReducer, initialDialogState } from './reducer.js'

describe('permissions/reducer', () => {
  it('initialDialogState starts on allow list', () => {
    expect(initialDialogState()).toEqual({
      view: 'list',
      tab: 'allow',
      cursor: 0,
      searching: false,
      searchQuery: '',
    })
  })

  it('SET_TAB resets cursor and search', () => {
    const state = {
      view: 'list' as const,
      tab: 'allow' as const,
      cursor: 3,
      searching: true,
      searchQuery: 'read',
    }
    expect(dialogReducer(state, { type: 'SET_TAB', tab: 'deny' })).toEqual({
      view: 'list',
      tab: 'deny',
      cursor: 0,
      searching: false,
      searchQuery: '',
    })
  })

  it('MOVE_LIST_CURSOR updates cursor on current view', () => {
    const moved = dialogReducer(initialDialogState(), { type: 'MOVE_LIST_CURSOR', next: 4 })
    expect(moved.cursor).toBe(4)
  })

  it('TOGGLE_SEARCH toggles searching and clears query when closing', () => {
    const opened = dialogReducer(initialDialogState(), { type: 'TOGGLE_SEARCH' })
    expect(opened.searching).toBe(true)

    const withQuery = dialogReducer(opened, { type: 'SET_SEARCH_QUERY', query: 'glob' })
    expect(withQuery.searchQuery).toBe('glob')

    const closed = dialogReducer(withQuery, { type: 'TOGGLE_SEARCH' })
    expect(closed.searching).toBe(false)
    expect(closed.searchQuery).toBe('')
  })

  it('OPEN_ADD enters addRule/addDirectory depending on tab', () => {
    const addRule = dialogReducer(initialDialogState(), { type: 'OPEN_ADD' })
    expect(addRule.view).toBe('addRule')
    if (addRule.view === 'addRule') {
      expect(addRule.kind).toBe('allow')
      expect(addRule.ruleInput).toBe('')
    }

    const workspaceState = dialogReducer(initialDialogState(), { type: 'SET_TAB', tab: 'workspace' })
    const addDir = dialogReducer(workspaceState, { type: 'OPEN_ADD' })
    expect(addDir.view).toBe('addDirectory')
    if (addDir.view === 'addDirectory') {
      expect(addDir.dirInput).toBe('')
    }
  })

  it('SUBMIT_RULE transitions to saveRule when input is non-empty', () => {
    const addRule = dialogReducer(initialDialogState(), { type: 'OPEN_ADD' })
    if (addRule.view !== 'addRule') throw new Error('expected addRule view')

    const unchanged = dialogReducer(addRule, { type: 'SUBMIT_RULE' })
    expect(unchanged.view).toBe('addRule')

    const withRule = dialogReducer(addRule, { type: 'SET_RULE_INPUT', value: 'Read:*' })
    const saveRule = dialogReducer(withRule, { type: 'SUBMIT_RULE' })
    expect(saveRule.view).toBe('saveRule')
    if (saveRule.view === 'saveRule') {
      expect(saveRule.rule).toBe('Read:*')
      expect(saveRule.saveScopeCursor).toBe(0)
    }
  })

  it('CANCEL_VIEW returns to list preserving tab/cursor/search flags', () => {
    const state = dialogReducer(initialDialogState(), { type: 'OPEN_ADD' })
    const back = dialogReducer(state, { type: 'CANCEL_VIEW' })
    expect(back.view).toBe('list')
    expect(back.tab).toBe('allow')
  })

  it('handles delete views, confirm cursor moves, and no-op guards', () => {
    const ruleState = dialogReducer(initialDialogState(), {
      type: 'OPEN_DELETE_RULE',
      kind: 'allow',
      entry: { rule: 'Read:*', scope: 'user', filePath: '/tmp/u' },
    })
    expect(ruleState.view).toBe('confirmDeleteRule')
    const movedRule = dialogReducer(ruleState as any, { type: 'MOVE_CONFIRM_CURSOR', next: 1 })
    expect((movedRule as any).confirmCursor).toBe(1)

    const ws = dialogReducer(initialDialogState(), { type: 'SET_TAB', tab: 'workspace' })
    const dirState = dialogReducer(ws, {
      type: 'OPEN_DELETE_DIR',
      entry: { dir: '/tmp/repo', scope: 'project', filePath: '/tmp/p' },
    })
    expect(dirState.view).toBe('confirmDeleteDir')
    const movedDir = dialogReducer(dirState as any, { type: 'MOVE_CONFIRM_CURSOR', next: 1 })
    expect((movedDir as any).confirmCursor).toBe(1)

    const noOp = dialogReducer(initialDialogState(), { type: 'MOVE_CONFIRM_CURSOR', next: 1 })
    expect(noOp).toEqual(initialDialogState())
  })

  it('covers save-scope/directory and invalid-view guards', () => {
    const addRule = dialogReducer(initialDialogState(), { type: 'OPEN_ADD' })
    expect(dialogReducer(initialDialogState(), { type: 'SUBMIT_RULE' })).toEqual(initialDialogState())
    const setRuleNoop = dialogReducer(initialDialogState(), { type: 'SET_RULE_INPUT', value: 'x' })
    expect(setRuleNoop).toEqual(initialDialogState())

    const withRule = dialogReducer(addRule as any, { type: 'SET_RULE_INPUT', value: ' Read:* ' })
    const saveRule = dialogReducer(withRule as any, { type: 'SUBMIT_RULE' })
    expect(saveRule.view).toBe('saveRule')
    expect((saveRule as any).rule).toBe('Read:*')
    expect(dialogReducer(saveRule as any, { type: 'MOVE_SAVE_SCOPE_CURSOR', next: 2 })).toMatchObject({
      view: 'saveRule',
      saveScopeCursor: 2,
    })
    expect(dialogReducer(initialDialogState(), { type: 'MOVE_SAVE_SCOPE_CURSOR', next: 1 })).toEqual(
      initialDialogState(),
    )
    expect(dialogReducer(saveRule as any, { type: 'CONFIRM_SAVE_SCOPE', scope: 'user' })).toEqual(saveRule)

    const ws = dialogReducer(initialDialogState(), { type: 'SET_TAB', tab: 'workspace' })
    const addDir = dialogReducer(ws, { type: 'OPEN_ADD' })
    expect(dialogReducer(initialDialogState(), { type: 'SET_DIR_INPUT', value: '/tmp/a' })).toEqual(
      initialDialogState(),
    )
    const dirWithValue = dialogReducer(addDir as any, { type: 'SET_DIR_INPUT', value: ' /tmp/a ' })
    expect((dirWithValue as any).dirInput).toBe(' /tmp/a ')
    expect(dialogReducer(addDir as any, { type: 'SUBMIT_DIR' }).view).toBe('addDirectory')
    expect(dialogReducer(dirWithValue as any, { type: 'SUBMIT_DIR' }).view).toBe('list')
    expect(dialogReducer(initialDialogState(), { type: 'SUBMIT_DIR' }).view).toBe('list')
  })

  it('OPEN_DELETE_RULE coerces workspace tab fallback to allow', () => {
    const ws = dialogReducer(initialDialogState(), { type: 'SET_TAB', tab: 'workspace' })
    const next = dialogReducer(ws, {
      type: 'OPEN_DELETE_RULE',
      kind: 'deny',
      entry: { rule: 'Bash:*', scope: 'project', filePath: '/tmp/p' },
    })
    expect(next.view).toBe('confirmDeleteRule')
    expect((next as any).tab).toBe('allow')
  })

  it('returns same state on unknown action', () => {
    const state = initialDialogState()
    // @ts-expect-error test unknown branch
    expect(dialogReducer(state, { type: 'UNKNOWN_ACTION' })).toEqual(state)
  })
})
