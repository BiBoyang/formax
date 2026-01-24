import type { HookEventName, HookSource } from '../../hooks/types.js'

export type View =
  | { kind: 'eventList'; cursor: number; banner: string | null }
  | { kind: 'matcherList'; event: HookEventName; cursor: number; banner: string | null }
  | { kind: 'addMatcher'; event: HookEventName; matcherInput: string }
  | { kind: 'hookList'; event: HookEventName; source: HookSource; matcher: string; cursor: number; banner: string | null }
  | { kind: 'addHook'; event: HookEventName; matcher: string; commandInput: string }
  | { kind: 'saveHook'; event: HookEventName; matcher: string; command: string; cursor: number }
  | {
      kind: 'confirmDeleteHook'
      event: HookEventName
      matcher: string
      command: string
      source: HookSource
      cursor: 0 | 1
    }

export type DialogState = {
  view: View
  stack: View[]
}

export type DialogAction =
  | { type: 'SET_VIEW'; view: View }
  | { type: 'PUSH_VIEW'; view: View }
  | { type: 'POP_VIEW' }
  | { type: 'RESET_NAV'; view: View; stack?: View[] }
  | { type: 'MOVE_CURSOR'; cursor: number }
  | { type: 'SET_MATCHER_INPUT'; value: string }
  | { type: 'SET_COMMAND_INPUT'; value: string }
  | { type: 'SET_BANNER'; banner: string | null }

export function initialDialogState(): DialogState {
  return { view: { kind: 'eventList', cursor: 0, banner: null }, stack: [] }
}

function updateViewCursor(view: View, cursor: number): View {
  switch (view.kind) {
    case 'eventList':
    case 'matcherList':
    case 'hookList':
    case 'saveHook':
      return { ...view, cursor }
    case 'confirmDeleteHook': {
      const next: 0 | 1 = cursor === 0 ? 0 : 1
      return { ...view, cursor: next }
    }
    default:
      return view
  }
}

function updateBanner(view: View, banner: string | null): View {
  switch (view.kind) {
    case 'eventList':
    case 'matcherList':
    case 'hookList':
      return { ...view, banner }
    default:
      return view
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
    case 'RESET_NAV': {
      return { view: action.view, stack: action.stack ?? [] }
    }
    case 'MOVE_CURSOR': {
      return { ...state, view: updateViewCursor(state.view, action.cursor) }
    }
    case 'SET_MATCHER_INPUT': {
      const view = state.view
      if (view.kind !== 'addMatcher') return state
      return { ...state, view: { ...view, matcherInput: action.value } }
    }
    case 'SET_COMMAND_INPUT': {
      const view = state.view
      if (view.kind !== 'addHook') return state
      return { ...state, view: { ...view, commandInput: action.value } }
    }
    case 'SET_BANNER': {
      return { ...state, view: updateBanner(state.view, action.banner) }
    }
    default: {
      return state
    }
  }
}
