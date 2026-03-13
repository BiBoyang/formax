type DevPerfWindow = Window & {
  __FORMAX_DEV_PERF__?: unknown
}

const DEV_PERF_QUERY_PARAM = 'formaxPerf'
const DEV_PERF_LOCAL_STORAGE_KEY = 'formax.dev.perf'

function readPerfQueryParam(windowObj: Window): string | null {
  try {
    const value = new URL(windowObj.location.href).searchParams.get(DEV_PERF_QUERY_PARAM)
    if (!value) return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

function readPerfStorage(windowObj: Window): string | null {
  try {
    const value = windowObj.localStorage.getItem(DEV_PERF_LOCAL_STORAGE_KEY)
    if (!value) return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

function isTruthyFlag(value: string | null): boolean {
  return value === '1' || value === 'true'
}

export function isDevPerformanceEnabled(args?: {
  isDevRuntime?: boolean
  windowObj?: Window
}): boolean {
  const isDev = args?.isDevRuntime ?? ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true)
  if (!isDev) return false

  const windowObj = args?.windowObj ?? (typeof window === 'undefined' ? null : window)
  if (!windowObj) return false

  const devWindow = windowObj as DevPerfWindow
  if (devWindow.__FORMAX_DEV_PERF__ === true) return true
  if (isTruthyFlag(readPerfQueryParam(windowObj))) return true
  return isTruthyFlag(readPerfStorage(windowObj))
}

export function withDevPerformanceSync<T>(args: {
  enabled: boolean
  label: string
  run: () => T
  consoleRef?: Pick<Console, 'time' | 'timeEnd'>
}): T {
  if (!args.enabled) return args.run()
  const consoleRef = args.consoleRef ?? console
  consoleRef.time(args.label)
  try {
    return args.run()
  } finally {
    consoleRef.timeEnd(args.label)
  }
}
