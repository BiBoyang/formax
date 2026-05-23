export type NewThreadDraftSource = 'newThread' | 'addProject' | 'folderQuickAction'

export type NewThreadDraftState =
  | { status: 'inactive' }
  | {
      status: 'active'
      cwd: string | null
      source: NewThreadDraftSource
    }

export type VisibleSurface = 'welcome' | 'thread' | 'newThreadDraft'

export function deriveVisibleSurface(args: {
  activeThreadId: string | null
  newThreadDraft: NewThreadDraftState
}): VisibleSurface {
  if (args.newThreadDraft.status === 'active') {
    return 'newThreadDraft'
  }
  if (args.activeThreadId) {
    return 'thread'
  }
  return 'welcome'
}

export function normalizeDraftCwd(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
