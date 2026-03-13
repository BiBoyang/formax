export type WorkspaceSessionEntry = {
  dir: string
}

type ProjectRootKey = string

const byProjectRoot = new Map<ProjectRootKey, string[]>()

function normalizeKey(projectRoot: string): ProjectRootKey {
  return String(projectRoot || '').trim()
}

export function listWorkspaceSessionDirectories(projectRoot: string): WorkspaceSessionEntry[] {
  const key = normalizeKey(projectRoot)
  if (!key) return []
  const dirs = byProjectRoot.get(key) ?? []
  return dirs.map((dir) => ({ dir }))
}

export function addWorkspaceSessionDirectory(projectRoot: string, dir: string): void {
  const key = normalizeKey(projectRoot)
  const clean = String(dir || '').trim()
  if (!key || !clean) return

  const prev = byProjectRoot.get(key) ?? []
  if (prev.includes(clean)) return
  byProjectRoot.set(key, [...prev, clean])
}

export function deleteWorkspaceSessionDirectory(projectRoot: string, dir: string): void {
  const key = normalizeKey(projectRoot)
  const clean = String(dir || '').trim()
  if (!key || !clean) return

  const prev = byProjectRoot.get(key) ?? []
  const next = prev.filter((d) => d !== clean)
  if (next.length === 0) byProjectRoot.delete(key)
  else byProjectRoot.set(key, next)
}

export function resetWorkspaceSessionForTests(): void {
  byProjectRoot.clear()
}

