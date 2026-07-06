export type GitReviewSourceKind = 'unstaged' | 'staged' | 'commit'

export type GitReviewSource =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'commit'; sha: string }

export type GitReviewSourceKey = 'git:unstaged' | 'git:staged' | `git:commit:${string}`

export type GitReviewCommit = {
  sha: string
  shortSha: string
  subject: string
  committedAt: string
  committedAtUnixSeconds: number
}

export type GitReviewDiffFile = {
  path: string
  additions: number
  deletions: number
  patch: string
  untracked?: boolean
}

export type GitReviewDiffSummaryFile = Omit<GitReviewDiffFile, 'patch'>

export type GitRenamePair = {
  oldPath: string
  newPath: string
}

export const DEFAULT_GIT_REVIEW_SOURCE: GitReviewSource = { kind: 'unstaged' }

export function normalizeGitReviewSource(value: unknown): GitReviewSource {
  if (value === undefined || value === null) return DEFAULT_GIT_REVIEW_SOURCE
  if (value === 'unstaged' || value === 'staged') return { kind: value }
  if (typeof value === 'object') {
    const kind = (value as { kind?: unknown }).kind
    if (kind === 'unstaged' || kind === 'staged') return { kind }
    if (kind === 'commit') {
      const sha = typeof (value as { sha?: unknown }).sha === 'string' ? (value as { sha: string }).sha.trim() : ''
      if (/^[0-9a-fA-F]{7,64}$/.test(sha)) return { kind, sha: sha.toLowerCase() }
    }
  }
  throw Object.assign(new Error('Invalid Git review source.'), { code: -32602 })
}

export function getGitReviewSourceKey(source: GitReviewSource): GitReviewSourceKey {
  if (source.kind === 'commit') return `git:commit:${source.sha}`
  return `git:${source.kind}`
}

export function shouldIncludeUntrackedFiles(source: GitReviewSource): boolean {
  return source.kind === 'unstaged'
}

export function buildGitReviewPatchArgs(source: GitReviewSource, filePath?: string): string[] {
  return buildGitDiffArgs(source, '--patch', filePath)
}

export function buildGitReviewNumstatArgs(source: GitReviewSource): string[] {
  return buildGitDiffArgs(source, '--numstat')
}

export function buildGitReviewNameStatusArgs(source: GitReviewSource): string[] {
  return buildGitDiffArgs(source, '--name-status')
}

export function buildGitReviewUntrackedArgs(filePath?: string): string[] {
  const args = ['ls-files', '--others', '--exclude-standard']
  if (filePath) args.push('--', filePath)
  return args
}

export function normalizeGitReviewCommitLimit(value: unknown, fallback = 10): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(50, Math.floor(value)))
}

export function buildGitReviewCommitListArgs(limit: number): string[] {
  return [
    'log',
    `--max-count=${normalizeGitReviewCommitLimit(limit)}`,
    '--format=%H%x1f%h%x1f%ct%x1f%s',
  ]
}

export function parseGitReviewCommitList(stdout: string): GitReviewCommit[] {
  if (!stdout.trim()) return []
  const commits: GitReviewCommit[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const [sha, shortSha, unixText, ...subjectParts] = rawLine.split('\x1f')
    const subject = subjectParts.join('\x1f').trim()
    const committedAtUnixSeconds = Number(unixText)
    if (!sha || !shortSha || !Number.isFinite(committedAtUnixSeconds)) continue
    commits.push({
      sha,
      shortSha,
      subject: subject || shortSha,
      committedAt: new Date(committedAtUnixSeconds * 1000).toISOString(),
      committedAtUnixSeconds,
    })
  }
  return commits
}

export function getDeletedImageBlobRef(source: GitReviewSource, filePath: string): { ref: string; source: 'index' } | null {
  if (source.kind !== 'unstaged') return null
  return { ref: `:${filePath}`, source: 'index' }
}

export function supportsImagePreview(source: GitReviewSource): boolean {
  return source.kind === 'unstaged' || source.kind === 'commit'
}

function buildGitDiffArgs(source: GitReviewSource, format: '--patch' | '--numstat' | '--name-status', filePath?: string): string[] {
  if (source.kind === 'commit') {
    const args = ['show', '--format=', '--no-color', format, '--find-renames', '--first-parent', '--root', source.sha]
    if (filePath) args.push('--', filePath)
    return args
  }

  const args = ['diff']
  if (source.kind === 'staged') args.push('--cached')
  args.push('--no-color', format, '--find-renames')
  if (filePath) args.push('--', filePath)
  return args
}

export function parsePatchFiles(diffText: string): GitReviewDiffFile[] {
  if (!diffText.trim()) return []
  const chunks = diffText.split(/(?=^diff --git )/gm).filter((chunk) => chunk.trim())
  const files: GitReviewDiffFile[] = []
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const first = lines[0]
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(first.trim())
    const path = match ? match[2] : 'unknown'
    let additions = 0
    let deletions = 0
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) additions += 1
      if (line.startsWith('-')) deletions += 1
    }
    files.push({
      path,
      additions,
      deletions,
      patch: chunk.trimEnd(),
    })
  }
  return files
}

export function parseRenamePairs(nameStatusText: string): GitRenamePair[] {
  if (!nameStatusText.trim()) return []
  const out: GitRenamePair[] = []
  for (const rawLine of nameStatusText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const status = parts[0]
    if (!status.startsWith('R')) continue
    const oldPath = parts[1]?.trim()
    const newPath = parts[2]?.trim()
    if (!oldPath || !newPath) continue
    out.push({ oldPath, newPath })
  }
  return out
}

export function parseNumstatFiles(diffText: string, renamePairs: GitRenamePair[]): GitReviewDiffSummaryFile[] {
  if (!diffText.trim()) return []
  const files: GitReviewDiffSummaryFile[] = []
  for (const rawLine of diffText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^([0-9-]+)\t([0-9-]+)\t(.+)$/.exec(line)
    if (!match) continue
    const [, addText, delText, rawPath] = match
    const filePath = normalizeNumstatPath(rawPath, renamePairs)
    files.push({
      path: filePath,
      additions: addText === '-' ? 0 : Number(addText),
      deletions: delText === '-' ? 0 : Number(delText),
    })
  }
  return files
}

export function normalizeNumstatPath(rawPath: string, renamePairs: GitRenamePair[]): string {
  if (!rawPath.includes(' => ')) return rawPath
  if (renamePairs.length === 0) return rawPath

  const direct = renamePairs.find((pair) => `${pair.oldPath} => ${pair.newPath}` === rawPath)
  if (direct) return direct.newPath

  const braceExpanded = rawPath.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')
  if (braceExpanded !== rawPath) {
    const matched = renamePairs.find((pair) => pair.newPath === braceExpanded)
    if (matched) return matched.newPath
  }

  return rawPath
}

export function mergeSummaryFiles(
  tracked: GitReviewDiffSummaryFile[],
  untrackedPaths: string[],
): GitReviewDiffSummaryFile[] {
  const merged = new Map<string, GitReviewDiffSummaryFile>()
  for (const file of tracked) {
    merged.set(file.path, file)
  }
  for (const filePath of untrackedPaths) {
    if (merged.has(filePath)) continue
    merged.set(filePath, {
      path: filePath,
      additions: 0,
      deletions: 0,
      untracked: true,
    })
  }
  return Array.from(merged.values())
}
