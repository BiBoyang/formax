export type RuntimeFlags = {
  sessionSaveEnabled: boolean
  isVitest: boolean
  hooksDebugEnabled: boolean
  userShellPath: string | null
  deferredToolExposureEnabled: boolean
  requestDryRunEnabled: boolean
  requestDryRunOutputDir: string | null
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

function parseSessionSaveEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env.FORMAX_SESSION_SAVE ?? '').trim().toLowerCase()
  if (!raw) return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return true
}

export function createRuntimeFlags(env: NodeJS.ProcessEnv = process.env): RuntimeFlags {
  return {
    sessionSaveEnabled: parseSessionSaveEnabled(env),
    isVitest: String(env.VITEST ?? '').trim().length > 0,
    hooksDebugEnabled: parseTruthy(env.FORMAX_HOOKS_DEBUG),
    userShellPath: normalizeOptionalString(env.SHELL),
    deferredToolExposureEnabled: parseTruthy(env.FORMAX_DEFERRED_TOOL_EXPOSURE),
    requestDryRunEnabled: parseTruthy(env.FORMAX_REQUEST_DRY_RUN),
    requestDryRunOutputDir: normalizeOptionalString(env.FORMAX_REQUEST_DRY_RUN_DIR),
  }
}
