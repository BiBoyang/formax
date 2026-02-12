export type ReplMode = 'normal' | 'acceptEdits' | 'plan'

export type ReplModeTransition = {
  from: ReplMode
  to: ReplMode
}

const REPL_MODES: ReplMode[] = ['normal', 'acceptEdits', 'plan']

export function isReplMode(value: unknown): value is ReplMode {
  return typeof value === 'string' && REPL_MODES.includes(value as ReplMode)
}

export function normalizeReplMode(value: unknown, fallback: ReplMode = 'normal'): ReplMode {
  return isReplMode(value) ? value : fallback
}

export function resolveReplModeTransition(args: {
  current: unknown
  next: unknown
  fallback?: ReplMode
}): ReplModeTransition | null {
  const fallback = args.fallback ?? 'normal'
  const from = normalizeReplMode(args.current, fallback)
  const to = normalizeReplMode(args.next, fallback)
  if (from === to) return null
  return { from, to }
}

export function shouldInjectExitPlanReminder(args: {
  current: unknown
  next: unknown
  fallback?: ReplMode
}): boolean {
  const transition = resolveReplModeTransition(args)
  if (!transition) return false
  return transition.from === 'plan' && transition.to !== 'plan'
}
