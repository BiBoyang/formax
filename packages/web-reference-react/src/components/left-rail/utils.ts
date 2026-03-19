import type { ThreadViewModel } from '../../app/core/threadViewModel'

const OPEN_BY_CWD_STORAGE_KEY = 'formax.web.leftRail.openByCwd.v1'

export type LeftRailThreadGroup = {
  cwd: string
  folderName: string
  threads: ThreadViewModel[]
  sortLabel: string
  sortPath: string
}

export function readOpenByCwdFromStorage(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(OPEN_BY_CWD_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [cwd, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!cwd.trim()) continue
      if (typeof value !== 'boolean') continue
      out[cwd] = value
    }
    return out
  } catch {
    return {}
  }
}

export function writeOpenByCwdToStorage(openByCwd: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPEN_BY_CWD_STORAGE_KEY, JSON.stringify(openByCwd))
  } catch {
    // Ignore storage quota/privacy errors and keep runtime state in-memory.
  }
}

export function relativeTime(updatedAt: string, nowMs: number): string {
  const ts = Date.parse(updatedAt)
  if (!Number.isFinite(ts)) return '--'
  const minutes = Math.max(1, Math.floor((nowMs - ts) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function normalizeCwdPath(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}

function cwdLabel(cwd: string): string {
  const normalized = normalizeCwdPath(cwd)
  if (!normalized) return cwd
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : normalized
}

export function groupThreadsByCwd(threads: ThreadViewModel[]): LeftRailThreadGroup[] {
  const groupMap = new Map<string, ThreadViewModel[]>()
  for (const thread of threads) {
    const cwd = thread.cwd
    if (!groupMap.has(cwd)) {
      groupMap.set(cwd, [thread])
      continue
    }
    groupMap.get(cwd)?.push(thread)
  }

  const groups: LeftRailThreadGroup[] = Array.from(groupMap.entries()).map(([cwd, grouped]) => {
    const folderName = cwdLabel(cwd)
    return {
      cwd,
      folderName,
      threads: grouped,
      sortLabel: folderName.toLowerCase(),
      sortPath: normalizeCwdPath(cwd).toLowerCase(),
    }
  })

  groups.sort((a, b) => {
    if (a.sortLabel !== b.sortLabel) return a.sortLabel < b.sortLabel ? -1 : 1
    if (a.sortPath === b.sortPath) return 0
    return a.sortPath < b.sortPath ? -1 : 1
  })

  return groups
}

export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(text)
}
