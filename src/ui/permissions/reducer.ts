import type {
  PermissionListKind,
  PermissionRuleEntry,
  WorkspaceDirectoryEntry,
} from '../../features/commands/permissionsDialogService.js'
import type { PermissionTab, SaveScope } from './constants.js'

export type DialogState =
  | {
      view: 'list'
      tab: PermissionTab
      cursor: number
      searching: boolean
      searchQuery: string
    }
  | {
      view: 'addRule'
      tab: Exclude<PermissionTab, 'workspace'>
      kind: PermissionListKind
      cursor: number
      searching: boolean
      searchQuery: string
      ruleInput: string
    }
  | {
      view: 'saveRule'
      tab: Exclude<PermissionTab, 'workspace'>
      kind: PermissionListKind
      cursor: number
      searching: boolean
      searchQuery: string
      rule: string
      saveScopeCursor: number
    }
  | {
      view: 'confirmDeleteRule'
      tab: Exclude<PermissionTab, 'workspace'>
      kind: PermissionListKind
      entry: PermissionRuleEntry
      confirmCursor: 0 | 1
      cursor: number
      searching: boolean
      searchQuery: string
    }
  | {
      view: 'addDirectory'
      tab: 'workspace'
      cursor: number
      searching: boolean
      searchQuery: string
      dirInput: string
    }
  | {
      view: 'confirmDeleteDir'
      tab: 'workspace'
      entry: WorkspaceDirectoryEntry
      confirmCursor: 0 | 1
      cursor: number
      searching: boolean
      searchQuery: string
    }

export type DialogAction =
  | { type: 'SET_TAB'; tab: PermissionTab }
  | { type: 'MOVE_LIST_CURSOR'; next: number }
  | { type: 'TOGGLE_SEARCH' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'OPEN_ADD' }
  | { type: 'OPEN_DELETE_RULE'; kind: PermissionListKind; entry: PermissionRuleEntry }
  | { type: 'OPEN_DELETE_DIR'; entry: WorkspaceDirectoryEntry }
  | { type: 'MOVE_CONFIRM_CURSOR'; next: 0 | 1 }
  | { type: 'CANCEL_VIEW' }
  | { type: 'SET_RULE_INPUT'; value: string }
  | { type: 'SUBMIT_RULE' }
  | { type: 'MOVE_SAVE_SCOPE_CURSOR'; next: number }
  | { type: 'CONFIRM_SAVE_SCOPE'; scope: SaveScope }
  | { type: 'SET_DIR_INPUT'; value: string }
  | { type: 'SUBMIT_DIR' }

export function initialDialogState(): DialogState {
  return { view: 'list', tab: 'allow', cursor: 0, searching: false, searchQuery: '' }
}

function baseFrom(state: DialogState): Pick<DialogState, 'tab' | 'cursor' | 'searching' | 'searchQuery'> {
  return {
    tab: state.tab,
    cursor: state.cursor,
    searching: state.searching,
    searchQuery: state.searchQuery,
  }
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'SET_TAB': {
      const tab = action.tab
      return {
        view: 'list',
        tab,
        cursor: 0,
        searching: false,
        searchQuery: '',
      }
    }
    case 'MOVE_LIST_CURSOR': {
      return { ...state, cursor: action.next }
    }
    case 'TOGGLE_SEARCH': {
      const next = !state.searching
      return { ...state, searching: next, searchQuery: next ? state.searchQuery : '' }
    }
    case 'SET_SEARCH_QUERY': {
      return { ...state, searchQuery: action.query }
    }
    case 'OPEN_ADD': {
      if (state.tab === 'workspace') {
        return { ...baseFrom(state), view: 'addDirectory', tab: 'workspace', dirInput: '' }
      }
      return {
        ...baseFrom(state),
        view: 'addRule',
        tab: state.tab,
        kind: state.tab,
        ruleInput: '',
      }
    }
    case 'OPEN_DELETE_RULE': {
      return {
        ...baseFrom(state),
        view: 'confirmDeleteRule',
        tab: state.tab === 'workspace' ? 'allow' : state.tab,
        kind: action.kind,
        entry: action.entry,
        confirmCursor: 0,
      }
    }
    case 'OPEN_DELETE_DIR': {
      return {
        ...baseFrom(state),
        view: 'confirmDeleteDir',
        tab: 'workspace',
        entry: action.entry,
        confirmCursor: 0,
      }
    }
    case 'MOVE_CONFIRM_CURSOR': {
      if (state.view !== 'confirmDeleteRule' && state.view !== 'confirmDeleteDir') return state
      return { ...state, confirmCursor: action.next }
    }
    case 'CANCEL_VIEW': {
      return { ...baseFrom(state), view: 'list' }
    }
    case 'SET_RULE_INPUT': {
      if (state.view !== 'addRule') return state
      return { ...state, ruleInput: action.value }
    }
    case 'SUBMIT_RULE': {
      if (state.view !== 'addRule') return state
      const rule = state.ruleInput.trim()
      if (!rule) return state
      return {
        ...baseFrom(state),
        view: 'saveRule',
        tab: state.tab,
        kind: state.kind,
        rule,
        saveScopeCursor: 0,
      }
    }
    case 'MOVE_SAVE_SCOPE_CURSOR': {
      if (state.view !== 'saveRule') return state
      return { ...state, saveScopeCursor: action.next }
    }
    case 'CONFIRM_SAVE_SCOPE': {
      return state
    }
    case 'SET_DIR_INPUT': {
      if (state.view !== 'addDirectory') return state
      return { ...state, dirInput: action.value }
    }
    case 'SUBMIT_DIR': {
      if (state.view !== 'addDirectory') return state
      const dir = state.dirInput.trim()
      if (!dir) return state
      return { ...baseFrom(state), view: 'list' }
    }
    default: {
      return state
    }
  }
}
