export type DiffFileViewModel = {
  path: string
  additions: number
  deletions: number
  patch?: string
  untracked?: boolean
}

export type ReviewGitSourceKind = 'unstaged' | 'staged'

export type ReviewGitSource = {
  kind: ReviewGitSourceKind
}

export type ReviewGitSourceKey = `git:${ReviewGitSourceKind}`

export type PatchErrorKind = 'unavailable' | 'load_failed'
export type PreviewErrorKind = 'unavailable' | 'load_failed'

export type DiffFilePreviewPayload = {
  path: string
  found: boolean
  preview: {
    kind: 'image'
    mimeType: string
    dataUrl: string
    sizeBytes: number
    source?: 'working_tree' | 'head' | 'index'
    changeKind?: 'added' | 'modified' | 'deleted'
  } | null
  error?: string
}

export type ImagePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; requestKey: string }
  | { status: 'ready'; requestKey: string; preview: NonNullable<DiffFilePreviewPayload['preview']> }
  | { status: 'error'; requestKey: string; error: PreviewErrorKind }

export type DiffSnapshot = {
  cwd: string
  source?: ReviewGitSource
  sourceKey?: ReviewGitSourceKey
  generatedAt: string
  hasChanges: boolean
  truncated: boolean
  files: DiffFileViewModel[]
}

export type DiffFilePatchPayload = {
  path: string
  found: boolean
  truncated: boolean
  patch: string
  additions: number
  deletions: number
  untracked?: boolean
}

export const DIFF_FILE_PATH_MAX_CHARS = 44

export function truncatePathFromLeft(path: string, maxChars = DIFF_FILE_PATH_MAX_CHARS): string {
  if (path.length <= maxChars) return path
  return `…${path.slice(-(maxChars - 1))}`
}
