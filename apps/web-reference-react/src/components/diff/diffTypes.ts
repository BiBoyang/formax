export type DiffFileViewModel = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

export const DIFF_FILE_PATH_MAX_CHARS = 44

export function truncatePathFromLeft(path: string, maxChars = DIFF_FILE_PATH_MAX_CHARS): string {
  if (path.length <= maxChars) return path
  return `…${path.slice(-(maxChars - 1))}`
}
