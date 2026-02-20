const LOCAL_STORAGE_KEY = 'formax.web.transcriptVirtualization'

function readBooleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'enabled') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'disabled') return false
  return null
}

export function isTranscriptVirtualizationEnabled(args: { isDevRuntime: boolean }): boolean {
  if (!args.isDevRuntime) return false
  if (typeof window === 'undefined') return false

  const runtimeFlag = readBooleanFlag(
    (window as Window & { __FORMAX_TRANSCRIPT_VIRTUALIZATION__?: unknown }).__FORMAX_TRANSCRIPT_VIRTUALIZATION__,
  )
  if (runtimeFlag != null) return runtimeFlag

  try {
    const localStorageFlag = readBooleanFlag(window.localStorage.getItem(LOCAL_STORAGE_KEY))
    if (localStorageFlag != null) return localStorageFlag
  } catch {
    // Ignore localStorage access errors in restricted environments.
  }

  return false
}
