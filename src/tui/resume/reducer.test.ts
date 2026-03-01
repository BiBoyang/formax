import { describe, expect, it } from 'vitest'
import { dialogReducer, initialDialogState } from './reducer.js'

describe('ui/resume/reducer', () => {
  it('initial state defaults to list view', () => {
    expect(initialDialogState()).toEqual({
      view: {
        kind: 'list',
        cursor: 0,
        includeAllProjects: false,
        showBranch: true,
        previewActive: false,
      },
    })
  })

  it('handles list toggles and cursor updates', () => {
    let state = initialDialogState()
    state = dialogReducer(state, { type: 'SET_CURSOR', cursor: 3 })
    expect(state.view.cursor).toBe(3)
    state = dialogReducer(state, { type: 'TOGGLE_ALL_PROJECTS' })
    expect(state.view.includeAllProjects).toBe(true)
    state = dialogReducer(state, { type: 'TOGGLE_BRANCH' })
    expect(state.view.showBranch).toBe(false)
    state = dialogReducer(state, { type: 'TOGGLE_PREVIEW' })
    expect(state.view.previewActive).toBe(true)
  })

  it('enters/exits search and guards query updates by view kind', () => {
    const base = initialDialogState()
    expect(dialogReducer(base, { type: 'SET_SEARCH_QUERY', query: 'x' })).toEqual(base)

    const search = dialogReducer(base, { type: 'ENTER_SEARCH' })
    expect(search.view.kind).toBe('search')
    const withQuery = dialogReducer(search, { type: 'SET_SEARCH_QUERY', query: 'abc' })
    expect(withQuery.view.kind).toBe('search')
    expect((withQuery.view as any).query).toBe('abc')

    const enterAgain = dialogReducer(withQuery, { type: 'ENTER_SEARCH' })
    expect((enterAgain.view as any).query).toBe('')

    const exited = dialogReducer(enterAgain, { type: 'EXIT_SEARCH' })
    expect(exited.view.kind).toBe('list')
    expect(dialogReducer(base, { type: 'EXIT_SEARCH' })).toEqual(base)
  })

  it('enters/exits rename and guards value updates by view kind', () => {
    const base = initialDialogState()
    expect(dialogReducer(base, { type: 'SET_RENAME_VALUE', value: 'x' })).toEqual(base)

    const rename = dialogReducer(base, { type: 'ENTER_RENAME', value: 'first' })
    expect(rename.view.kind).toBe('rename')
    expect((rename.view as any).value).toBe('first')

    const renameAgain = dialogReducer(rename, { type: 'ENTER_RENAME', value: 'next' })
    expect((renameAgain.view as any).value).toBe('next')

    const renamed = dialogReducer(renameAgain, { type: 'SET_RENAME_VALUE', value: 'final' })
    expect((renamed.view as any).value).toBe('final')

    const exited = dialogReducer(renamed, { type: 'EXIT_RENAME' })
    expect(exited.view.kind).toBe('list')
    expect(dialogReducer(base, { type: 'EXIT_RENAME' })).toEqual(base)
  })

  it('returns state for unknown actions', () => {
    const state = initialDialogState()
    // @ts-expect-error unknown action for branch coverage
    expect(dialogReducer(state, { type: 'UNKNOWN' })).toEqual(state)
  })
})
