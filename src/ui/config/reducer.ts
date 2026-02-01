import type { ConfigTab } from './constants.js'

export type DialogState =
  | {
      view: 'list'
      tab: ConfigTab
      cursor: number
    }
  | {
      view: 'themeSelect'
      tab: ConfigTab
      cursor: number
    }
  | {
      view: 'outputStyleSelect'
      tab: ConfigTab
      cursor: number
    }

export type DialogAction =
  | { type: 'SET_TAB'; tab: ConfigTab }
  | { type: 'MOVE_CURSOR'; next: number }
  | { type: 'OPEN_THEME_SELECT' }
  | { type: 'OPEN_OUTPUT_STYLE_SELECT' }
  | { type: 'CLOSE_SUB_VIEW' }

export function initialDialogState(): DialogState {
  return { view: 'list', tab: 'config', cursor: 0 }
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'SET_TAB': {
      return {
        view: 'list',
        tab: action.tab,
        cursor: 0,
      }
    }
    case 'MOVE_CURSOR': {
      return { ...state, cursor: action.next }
    }
    case 'OPEN_THEME_SELECT': {
      return {
        view: 'themeSelect',
        tab: state.tab,
        cursor: 0,
      }
    }
    case 'OPEN_OUTPUT_STYLE_SELECT': {
      return {
        view: 'outputStyleSelect',
        tab: state.tab,
        cursor: 0,
      }
    }
    case 'CLOSE_SUB_VIEW': {
      return {
        view: 'list',
        tab: state.tab,
        cursor: 0,
      }
    }
    default:
      return state
  }
}
