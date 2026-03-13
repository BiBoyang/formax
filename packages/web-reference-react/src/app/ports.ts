export type RuntimePorts = {
  nowIso: () => string
  nowMs: () => number
}

export function createDefaultRuntimePorts(): RuntimePorts {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  }
}
