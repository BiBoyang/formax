export type ReplBottomSlotState =
  | { kind: 'blocking_overlay'; overlay: ReplBlockingOverlay }
  | { kind: 'expanded_hint' }
  | { kind: 'active_prompt' }
  | { kind: 'input'; mode: 'idle' | 'loading'; runningToolCount: number }

export type ReplBlockingOverlay =
  | 'agents'
  | 'permissions'
  | 'hooks'
  | 'config'
  | 'model'
  | 'resume'

export type ReplBlockingOverlayFlags = Partial<Record<`${ReplBlockingOverlay}DialogOpen`, boolean>>

export function normalizeRunningToolCount(count: number): number {
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.floor(count))
}

export function resolveReplBottomSlotState(args: {
  blockingOverlay?: ReplBlockingOverlay | null
  expandedViewActive: boolean
  hasActiveInteractivePrompt: boolean
  isLoading: boolean
  runningToolCount: number
}): ReplBottomSlotState {
  const runningToolCount = normalizeRunningToolCount(args.runningToolCount)

  if (args.blockingOverlay) return { kind: 'blocking_overlay', overlay: args.blockingOverlay }
  if (args.expandedViewActive) return { kind: 'expanded_hint' }
  if (args.hasActiveInteractivePrompt) return { kind: 'active_prompt' }

  return {
    kind: 'input',
    mode: args.isLoading || runningToolCount > 0 ? 'loading' : 'idle',
    runningToolCount,
  }
}

export function resolveReplBlockingOverlay(flags: ReplBlockingOverlayFlags): ReplBlockingOverlay | null {
  if (flags.agentsDialogOpen) return 'agents'
  if (flags.permissionsDialogOpen) return 'permissions'
  if (flags.hooksDialogOpen) return 'hooks'
  if (flags.configDialogOpen) return 'config'
  if (flags.modelDialogOpen) return 'model'
  if (flags.resumeDialogOpen) return 'resume'
  return null
}

export function formatRunningToolsText(count: number): string | null {
  const runningToolCount = normalizeRunningToolCount(count)
  if (runningToolCount <= 0) return null
  return runningToolCount === 1 ? 'Running 1 tool' : `Running ${runningToolCount} tools`
}
