export type DiffFileViewModel = {
  path: string
  additions: number
  deletions: number
  patch?: string
  untracked?: boolean
}

export type ReviewGitSourceKind = 'unstaged' | 'staged' | 'commit'

export type ReviewGitSource =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; sha: string }

export type ReviewGitSourceKey = 'git:unstaged' | 'git:staged' | `git:commit:${string}`

export type ReviewGitCommit = {
  sha: string
  shortSha: string
  subject: string
  committedAt: string
  committedAtUnixSeconds: number
}

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
    source?: 'working_tree' | 'head' | 'index' | 'commit'
    changeKind?: 'added' | 'modified' | 'deleted'
  } | null
  error?: string
}

export type DiffFileFullContentPayload = {
  path: string
  found: boolean
  content: {
    before: string
    after: string
  } | null
  error?:
    | 'missing_path'
    | 'outside_workspace'
    | 'not_found'
    | 'not_file'
    | 'binary'
    | 'too_large'
    | 'read_failed'
    | 'unsupported_source'
}

export type FullContentErrorKind = 'unavailable' | 'load_failed'

export type FullContentState =
  | { status: 'idle' }
  | { status: 'loading'; requestKey: string }
  | { status: 'ready'; requestKey: string; content: NonNullable<DiffFileFullContentPayload['content']> }
  | { status: 'error'; requestKey: string; error: FullContentErrorKind }

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
