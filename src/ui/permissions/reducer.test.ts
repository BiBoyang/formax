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
})

