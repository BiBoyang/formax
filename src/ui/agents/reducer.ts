import type { DialogState, DialogAction } from './constants.js'

export function initialDialogState(): DialogState {
  return {
    view: { kind: 'list', cursor: 0, banner: null },
    stack: [],
    draft: null,
    scope: 'project',
    agentDescriptionInput: '',
    manualNameInput: '',
    manualDescInput: '',
    selectedModel: 'Sonnet',
    selectedColor: 'Blue',
    showAdvancedTools: false,
    selectedTools: [],
  }
}

function updateViewCursor(state: DialogState, cursor: number): DialogState {
  const view = state.view
  switch (view.kind) {
    case 'list':
    case 'create_scope':
    case 'create_method':
    case 'create_tools':
    case 'create_model':
    case 'create_color':
      return { ...state, view: { ...view, cursor } }
    default:
      return state
  }
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'SET_VIEW': {
      return { ...state, view: action.view }
    }
    case 'PUSH_VIEW': {
      return { ...state, stack: [...state.stack, state.view], view: action.view }
    }
    case 'POP_VIEW': {
      const stack = state.stack
      if (stack.length === 0) return state
      const previousView = stack[stack.length - 1]
      return { ...state, view: previousView, stack: stack.slice(0, -1) }
    }
    case 'RESET_TO_LIST': {
      return {
        ...state,
        view: { kind: 'list', cursor: 0, banner: action.banner ?? null },
        stack: [],
        draft: null,
        agentDescriptionInput: '',
        manualNameInput: '',
        manualDescInput: '',
        selectedModel: 'Sonnet',
        selectedColor: 'Blue',
        showAdvancedTools: false,
        selectedTools: [],
      }
    }
    case 'MOVE_CURSOR': {
      return updateViewCursor(state, action.cursor)
    }
    case 'SET_DRAFT': {
      return { ...state, draft: action.draft }
    }
    case 'SET_SCOPE': {
      return { ...state, scope: action.scope }
    }
    case 'SET_DESCRIPTION_INPUT': {
      return { ...state, agentDescriptionInput: action.value }
    }
    case 'SET_MANUAL_NAME_INPUT': {
      return { ...state, manualNameInput: action.value }
    }
    case 'SET_MANUAL_DESC_INPUT': {
      return { ...state, manualDescInput: action.value }
    }
    case 'SET_MODEL': {
      return { ...state, selectedModel: action.model }
    }
    case 'SET_COLOR': {
      return { ...state, selectedColor: action.color }
    }
    case 'SET_ADVANCED_TOOLS': {
      return { ...state, showAdvancedTools: action.show }
    }
    case 'SET_TOOLS': {
      return { ...state, selectedTools: action.tools }
    }
    case 'RESET_CREATE_STATE': {
      return {
        ...state,
        draft: null,
        scope: 'project',
        agentDescriptionInput: '',
        manualNameInput: '',
        manualDescInput: '',
        selectedModel: 'Sonnet',
        selectedColor: 'Blue',
        showAdvancedTools: false,
        selectedTools: action.selectableToolNames,
      }
    }
    case 'TOGGLE_TOOL_GROUP': {
      const groupSet = action.toolGroups[action.group]
      const isOn = groupSet.size > 0 && Array.from(groupSet).every((t) => state.selectedTools.includes(t))

      if (action.group === 'all') {
        return { ...state, selectedTools: isOn ? [] : Array.from(groupSet) }
      }

      const next = new Set(state.selectedTools)
      if (isOn) {
        for (const t of groupSet) next.delete(t)
      } else {
        for (const t of groupSet) next.add(t)
      }
      return { ...state, selectedTools: Array.from(next) }
    }
    case 'SET_ERROR': {
      return { ...state, view: { kind: 'error', message: action.message } }
    }
    case 'SET_GENERATING_MESSAGE': {
      return { ...state, view: { kind: 'generating_draft', message: action.message } }
    }
    case 'SET_SAVING_MESSAGE': {
      return { ...state, view: { kind: 'saving_agent', message: action.message } }
    }
    default: {
      return state
    }
  }
}
