export type View =
  | {
      kind: 'list'
      cursor: number
      includeAllProjects: boolean
      showBranch: boolean
      previewActive: boolean
    }
  | {
      kind: 'search'
      cursor: number
      includeAllProjects: boolean
      showBranch: boolean
      previewActive: boolean
      query: string
    }
  | {
      kind: 'rename'
      cursor: number
      includeAllProjects: boolean
      showBranch: boolean
      previewActive: boolean
      value: string
    }

export type DialogState = { view: View }

export type DialogAction =
  | { type: 'SET_CURSOR'; cursor: number }
  | { type: 'TOGGLE_ALL_PROJECTS' }
  | { type: 'TOGGLE_BRANCH' }
  | { type: 'TOGGLE_PREVIEW' }
  | { type: 'ENTER_SEARCH' }
  | { type: 'EXIT_SEARCH' }
  | { type: 'SET_SEARCH_QUERY'; query: string }
  | { type: 'ENTER_RENAME'; value: string }
  | { type: 'EXIT_RENAME' }
  | { type: 'SET_RENAME_VALUE'; value: string }

export function initialDialogState(): DialogState {
  return {
    view: {
      kind: 'list',
      cursor: 0,
      includeAllProjects: false,
      showBranch: true,
      previewActive: false,
    },
  }
}

function updateCursor(view: View, cursor: number): View {
  return { ...view, cursor }
}

export function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  const view = state.view

  switch (action.type) {
    case 'SET_CURSOR': {
      return { view: updateCursor(view, action.cursor) }
    }
    case 'TOGGLE_ALL_PROJECTS': {
      return { view: { ...view, includeAllProjects: !view.includeAllProjects } }
    }
    case 'TOGGLE_BRANCH': {
      return { view: { ...view, showBranch: !view.showBranch } }
    }
    case 'TOGGLE_PREVIEW': {
      return { view: { ...view, previewActive: !view.previewActive } }
    }
    case 'ENTER_SEARCH': {
      if (view.kind === 'search') return { view: { ...view, query: '' } }
      return {
        view: {
          kind: 'search',
          cursor: view.cursor,
          includeAllProjects: view.includeAllProjects,
          showBranch: view.showBranch,
          previewActive: view.previewActive,
          query: '',
        },
      }
    }
    case 'EXIT_SEARCH': {
      if (view.kind !== 'search') return state
      return {
        view: {
          kind: 'list',
          cursor: view.cursor,
          includeAllProjects: view.includeAllProjects,
          showBranch: view.showBranch,
          previewActive: view.previewActive,
        },
      }
    }
    case 'SET_SEARCH_QUERY': {
      if (view.kind !== 'search') return state
      return { view: { ...view, query: action.query } }
    }
    case 'ENTER_RENAME': {
      if (view.kind === 'rename') return { view: { ...view, value: action.value } }
      return {
        view: {
          kind: 'rename',
          cursor: view.cursor,
          includeAllProjects: view.includeAllProjects,
          showBranch: view.showBranch,
          previewActive: view.previewActive,
          value: action.value,
        },
      }
    }
    case 'EXIT_RENAME': {
      if (view.kind !== 'rename') return state
      return {
        view: {
          kind: 'list',
          cursor: view.cursor,
          includeAllProjects: view.includeAllProjects,
          showBranch: view.showBranch,
          previewActive: view.previewActive,
        },
      }
    }
    case 'SET_RENAME_VALUE': {
      if (view.kind !== 'rename') return state
      return { view: { ...view, value: action.value } }
    }
    default: {
      return state
    }
  }
}

