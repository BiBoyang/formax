export type RuntimeFlags = {
  sessionSaveEnabled: boolean
  isVitest: boolean
  toolLoopLimit: number | null
  hooksDebugEnabled: boolean
  bashModeShellOverride: string | null
  userShellPath: string | null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function parseTruthy(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function parseToolLoopLimit(value: unknown): number | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(2000, parsed)
}

function parseSessionSaveEnabled(env: NodeJS.ProcessEnv): boolean {
  if (parseTruthy(env.FORMAX_SESSION_SAVE_DISABLED)) return false

  const raw = String(env.FORMAX_SESSION_SAVE ?? '').trim().toLowerCase()
  if (!raw) return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return true
}

export function createRuntimeFlags(env: NodeJS.ProcessEnv = process.env): RuntimeFlags {
  return {
    sessionSaveEnabled: parseSessionSaveEnabled(env),
    isVitest: String(env.VITEST ?? '').trim().length > 0,
    toolLoopLimit: parseToolLoopLimit(env.FORMAX_TOOL_LOOP_LIMIT),
    hooksDebugEnabled: parseTruthy(env.FORMAX_HOOKS_DEBUG),
    bashModeShellOverride: normalizeOptionalString(env.FORMAX_BASH_MODE_SHELL),
    userShellPath: normalizeOptionalString(env.SHELL),
  }
}
