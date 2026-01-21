import { describe, expect, it } from 'vitest'
import { dialogReducer, initialDialogState } from './reducer.js'

describe('dialogReducer', () => {
  it('initializes with correct default state', () => {
    const state = initialDialogState()
    expect(state.view.kind).toBe('list')
    expect(state.stack).toEqual([])
    expect(state.draft).toBeNull()
    expect(state.scope).toBe('project')
    expect(state.agentDescriptionInput).toBe('')
    expect(state.manualNameInput).toBe('')
    expect(state.manualDescInput).toBe('')
    expect(state.selectedModel).toBe('Sonnet')
    expect(state.selectedColor).toBe('Blue')
    expect(state.showAdvancedTools).toBe(false)
    expect(state.selectedTools).toEqual([])
  })

  it('handles SET_VIEW action', () => {
    const state = initialDialogState()
    const newView = { kind: 'error' as const, message: 'Test error' }
    const next = dialogReducer(state, { type: 'SET_VIEW', view: newView })
    expect(next.view).toEqual(newView)
  })

  it('handles PUSH_VIEW action', () => {
    const state = initialDialogState()
    const newView = { kind: 'create_scope' as const, cursor: 0 }
    const next = dialogReducer(state, { type: 'PUSH_VIEW', view: newView })
    expect(next.view).toEqual(newView)
    expect(next.stack).toHaveLength(1)
    expect(next.stack[0].kind).toBe('list')
  })

  it('handles POP_VIEW action', () => {
    const state = initialDialogState()
    const pushed = dialogReducer(state, { type: 'PUSH_VIEW', view: { kind: 'create_scope' as const, cursor: 0 } })
    const popped = dialogReducer(pushed, { type: 'POP_VIEW' })
    expect(popped.view.kind).toBe('list')
    expect(popped.stack).toHaveLength(0)
  })

  it('does not POP_VIEW when stack is empty', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'POP_VIEW' })
    expect(next.view.kind).toBe('list')
    expect(next.stack).toHaveLength(0)
  })

  it('handles RESET_TO_LIST action', () => {
    const state = {
      ...initialDialogState(),
      view: { kind: 'create_scope' as const, cursor: 0 },
      stack: [{ kind: 'list' as const, cursor: 0, banner: null }],
      draft: { name: 'test', description: 'test', systemPrompt: 'test' },
      agentDescriptionInput: 'desc',
      selectedTools: ['Read'],
    }
    const next = dialogReducer(state, { type: 'RESET_TO_LIST', banner: 'Created test agent' })
    expect(next.view).toEqual({ kind: 'list', cursor: 0, banner: 'Created test agent' })
    expect(next.stack).toEqual([])
    expect(next.draft).toBeNull()
    expect(next.agentDescriptionInput).toBe('')
    expect(next.selectedTools).toEqual([])
  })

  it('handles MOVE_CURSOR for views with cursor', () => {
    const state = { ...initialDialogState(), view: { kind: 'list' as const, cursor: 0 } }
    const next = dialogReducer(state, { type: 'MOVE_CURSOR', cursor: 5 })
    expect(next.view).toEqual({ kind: 'list', cursor: 5 })
  })

  it('does not update cursor for views without cursor', () => {
    const state = { ...initialDialogState(), view: { kind: 'error' as const, message: 'test' } }
    const next = dialogReducer(state, { type: 'MOVE_CURSOR', cursor: 5 })
    expect(next.view).toEqual({ kind: 'error', message: 'test' })
  })

  it('handles SET_DRAFT action', () => {
    const state = initialDialogState()
    const draft = { name: 'agent', description: 'desc', systemPrompt: 'prompt' }
    const next = dialogReducer(state, { type: 'SET_DRAFT', draft })
    expect(next.draft).toEqual(draft)
  })

  it('handles SET_SCOPE action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_SCOPE', scope: 'user' })
    expect(next.scope).toBe('user')
  })

  it('handles SET_DESCRIPTION_INPUT action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_DESCRIPTION_INPUT', value: 'test description' })
    expect(next.agentDescriptionInput).toBe('test description')
  })

  it('handles SET_MANUAL_NAME_INPUT action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_MANUAL_NAME_INPUT', value: 'test-agent' })
    expect(next.manualNameInput).toBe('test-agent')
  })

  it('handles SET_MANUAL_DESC_INPUT action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_MANUAL_DESC_INPUT', value: 'test description' })
    expect(next.manualDescInput).toBe('test description')
  })

  it('handles SET_MODEL action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_MODEL', model: 'Opus' })
    expect(next.selectedModel).toBe('Opus')
  })

  it('handles SET_COLOR action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_COLOR', color: 'Red' })
    expect(next.selectedColor).toBe('Red')
  })

  it('handles SET_ADVANCED_TOOLS action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_ADVANCED_TOOLS', show: true })
    expect(next.showAdvancedTools).toBe(true)
  })

  it('handles SET_TOOLS action', () => {
    const state = initialDialogState()
    const tools = ['Read', 'Write', 'Bash']
    const next = dialogReducer(state, { type: 'SET_TOOLS', tools })
    expect(next.selectedTools).toEqual(tools)
  })

  it('handles RESET_CREATE_STATE action', () => {
    const state = {
      ...initialDialogState(),
      draft: { name: 'test', description: 'test', systemPrompt: 'test' },
      scope: 'user' as const,
      agentDescriptionInput: 'desc',
      manualNameInput: 'name',
      manualDescInput: 'desc',
      selectedTools: ['Read'],
    }
    const selectableTools = ['Read', 'Write', 'Bash']
    const next = dialogReducer(state, { type: 'RESET_CREATE_STATE', selectableToolNames: selectableTools })
    expect(next.draft).toBeNull()
    expect(next.scope).toBe('project')
    expect(next.agentDescriptionInput).toBe('')
    expect(next.manualNameInput).toBe('')
    expect(next.manualDescInput).toBe('')
    expect(next.selectedModel).toBe('Sonnet')
    expect(next.selectedColor).toBe('Blue')
    expect(next.showAdvancedTools).toBe(false)
    expect(next.selectedTools).toEqual(selectableTools)
  })

  it('handles TOGGLE_TOOL_GROUP for "all" group when unchecked', () => {
    const state = { ...initialDialogState(), selectedTools: [] }
    const toolGroups = {
      all: new Set(['Read', 'Write', 'Bash']),
      readOnly: new Set(['Read']),
      edit: new Set(['Write']),
      execution: new Set(['Bash']),
      other: new Set<string>(),
    }
    const next = dialogReducer(state, { type: 'TOGGLE_TOOL_GROUP', group: 'all', toolGroups })
    expect(next.selectedTools).toEqual(['Read', 'Write', 'Bash'])
  })

  it('handles TOGGLE_TOOL_GROUP for "all" group when checked', () => {
    const state = { ...initialDialogState(), selectedTools: ['Read', 'Write', 'Bash'] }
    const toolGroups = {
      all: new Set(['Read', 'Write', 'Bash']),
      readOnly: new Set(['Read']),
      edit: new Set(['Write']),
      execution: new Set(['Bash']),
      other: new Set<string>(),
    }
    const next = dialogReducer(state, { type: 'TOGGLE_TOOL_GROUP', group: 'all', toolGroups })
    expect(next.selectedTools).toEqual([])
  })

  it('handles TOGGLE_TOOL_GROUP for subgroup when unchecked', () => {
    const state = { ...initialDialogState(), selectedTools: [] }
    const toolGroups = {
      all: new Set(['Read', 'Write', 'Bash']),
      readOnly: new Set(['Read']),
      edit: new Set(['Write']),
      execution: new Set(['Bash']),
      other: new Set<string>(),
    }
    const next = dialogReducer(state, { type: 'TOGGLE_TOOL_GROUP', group: 'edit', toolGroups })
    expect(next.selectedTools).toContain('Write')
  })

  it('handles TOGGLE_TOOL_GROUP for subgroup when checked', () => {
    const state = { ...initialDialogState(), selectedTools: ['Read', 'Write'] }
    const toolGroups = {
      all: new Set(['Read', 'Write', 'Bash']),
      readOnly: new Set(['Read']),
      edit: new Set(['Write']),
      execution: new Set(['Bash']),
      other: new Set<string>(),
    }
    const next = dialogReducer(state, { type: 'TOGGLE_TOOL_GROUP', group: 'readOnly', toolGroups })
    expect(next.selectedTools).toEqual(['Write'])
  })

  it('handles SET_ERROR action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_ERROR', message: 'Test error' })
    expect(next.view).toEqual({ kind: 'error', message: 'Test error' })
  })

  it('handles SET_GENERATING_MESSAGE action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_GENERATING_MESSAGE', message: 'Generating...' })
    expect(next.view).toEqual({ kind: 'generating_draft', message: 'Generating...' })
  })

  it('handles SET_SAVING_MESSAGE action', () => {
    const state = initialDialogState()
    const next = dialogReducer(state, { type: 'SET_SAVING_MESSAGE', message: 'Saving...' })
    expect(next.view).toEqual({ kind: 'saving_agent', message: 'Saving...' })
  })

  it('handles unknown action by returning unchanged state', () => {
    const state = initialDialogState()
    // @ts-expect-error - testing unknown action
    const next = dialogReducer(state, { type: 'UNKNOWN_ACTION' })
    expect(next).toEqual(state)
  })
})
