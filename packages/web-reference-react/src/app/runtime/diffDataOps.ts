import type {
  DiffFilePatchPayload,
  DiffFileFullContentPayload,
  DiffFilePreviewPayload,
  DiffSnapshot,
  ReviewGitCommit,
  ReviewGitSource,
  ReviewGitSourceKey,
} from '../../components/diff/diffTypes'

export type DiffDataOpsContext = {
  request: (method: string, params?: unknown) => Promise<unknown>
  setIsRefreshingDiff: (value: boolean) => void
  setDiffSnapshot: (value: DiffSnapshot | null) => void
  canRefreshDiff: () => boolean
  resolveDiffCwd: () => string | null
  beginDiffRequest: () => number
  isCurrentDiffRequest: (requestId: number) => boolean
  shouldAcceptDiffResult: (args: { requestId: number; cwd: string | null }) => boolean
}

const DEFAULT_REVIEW_SOURCE: ReviewGitSource = { kind: 'unstaged' }

function getReviewSourceKey(source: ReviewGitSource): ReviewGitSourceKey {
  if (source.kind === 'commit') return `git:commit:${source.sha}`
  return `git:${source.kind}`
}

function normalizeReviewSource(value?: ReviewGitSource | null): ReviewGitSource {
  if (value?.kind === 'staged') return { kind: 'staged' }
  if (value?.kind === 'commit' && typeof value.sha === 'string' && value.sha.trim()) {
    return { kind: 'commit', sha: value.sha.trim().toLowerCase() }
  }
  return DEFAULT_REVIEW_SOURCE
}

function isExpectedReviewSource(snapshot: DiffSnapshot, expectedSourceKey: ReviewGitSourceKey): boolean {
  return snapshot.sourceKey === expectedSourceKey
}

function asDiffSnapshot(value: unknown): DiffSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.files)) return null
  const source = normalizeReviewSource(raw.source as ReviewGitSource | null)
  const sourceKey =
    raw.sourceKey === 'git:staged' || raw.sourceKey === 'git:unstaged' || isCommitSourceKey(raw.sourceKey)
      ? raw.sourceKey
      : getReviewSourceKey(source)
  const files = raw.files
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const file = entry as Record<string, unknown>
      if (typeof file.path !== 'string') return null
      return {
        path: file.path,
        additions: typeof file.additions === 'number' ? file.additions : 0,
        deletions: typeof file.deletions === 'number' ? file.deletions : 0,
        patch: typeof file.patch === 'string' ? file.patch : undefined,
        untracked: file.untracked === true ? true : undefined,
      }
    })
    .filter((file): file is NonNullable<typeof file> => file !== null)

  return {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    source,
    sourceKey,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    hasChanges: raw.hasChanges === true,
    truncated: raw.truncated === true,
    files,
  }
}

function isCommitSourceKey(value: unknown): value is `git:commit:${string}` {
  return typeof value === 'string' && /^git:commit:[0-9a-f]{7,64}$/.test(value)
}

function asReviewGitCommitList(value: unknown): ReviewGitCommit[] {
  if (!value || typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.commits)) return []
  return raw.commits
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const commit = entry as Record<string, unknown>
      if (typeof commit.sha !== 'string' || typeof commit.shortSha !== 'string') return null
      return {
        sha: commit.sha,
        shortSha: commit.shortSha,
        subject: typeof commit.subject === 'string' && commit.subject.trim() ? commit.subject : commit.shortSha,
        committedAt: typeof commit.committedAt === 'string' ? commit.committedAt : '',
        committedAtUnixSeconds: typeof commit.committedAtUnixSeconds === 'number' ? commit.committedAtUnixSeconds : 0,
      }
    })
    .filter((commit): commit is ReviewGitCommit => commit !== null)
}

function hasDiffErrorMarker(snapshot: DiffSnapshot): boolean {
  return snapshot.files.some((file) => file.path === 'git-diff-error')
}

function asDiffFilePatchPayload(value: unknown): DiffFilePatchPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const file = raw.file
  if (!file || typeof file !== 'object') {
    return {
      path: typeof raw.path === 'string' ? raw.path : '',
      found: raw.found === true,
      truncated: raw.truncated === true,
      patch: '',
      additions: 0,
      deletions: 0,
      untracked: undefined,
    }
  }
  const rawFile = file as Record<string, unknown>
  return {
    path: typeof rawFile.path === 'string' ? rawFile.path : typeof raw.path === 'string' ? raw.path : '',
    found: raw.found === true,
    truncated: raw.truncated === true,
    patch: typeof rawFile.patch === 'string' ? rawFile.patch : '',
    additions: typeof rawFile.additions === 'number' ? rawFile.additions : 0,
    deletions: typeof rawFile.deletions === 'number' ? rawFile.deletions : 0,
    untracked: rawFile.untracked === true ? true : undefined,
  }
}

function asDiffFilePreviewPayload(value: unknown): DiffFilePreviewPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const preview = raw.preview
  if (!preview || typeof preview !== 'object') {
    return {
      path: typeof raw.path === 'string' ? raw.path : '',
      found: raw.found === true,
      preview: null,
      error: typeof raw.error === 'string' ? raw.error : undefined,
    }
  }
  const rawPreview = preview as Record<string, unknown>
  const kind = rawPreview.kind === 'image' ? 'image' : null
  if (!kind) return null
  const source =
    rawPreview.source === 'head' ||
    rawPreview.source === 'working_tree' ||
    rawPreview.source === 'index' ||
    rawPreview.source === 'commit'
      ? rawPreview.source
      : undefined
  const changeKind =
    rawPreview.changeKind === 'added' || rawPreview.changeKind === 'modified' || rawPreview.changeKind === 'deleted'
      ? rawPreview.changeKind
      : undefined
  return {
    path: typeof raw.path === 'string' ? raw.path : '',
    found: raw.found === true,
    preview: {
      kind,
      mimeType: typeof rawPreview.mimeType === 'string' ? rawPreview.mimeType : '',
      dataUrl: typeof rawPreview.dataUrl === 'string' ? rawPreview.dataUrl : '',
      sizeBytes: typeof rawPreview.sizeBytes === 'number' ? rawPreview.sizeBytes : 0,
      ...(source ? { source } : {}),
      ...(changeKind ? { changeKind } : {}),
    },
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}

function asDiffFileFullContentPayload(value: unknown): DiffFileFullContentPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const content = raw.content
  if (!content || typeof content !== 'object') {
    return {
      path: typeof raw.path === 'string' ? raw.path : '',
      found: raw.found === true,
      content: null,
      error: typeof raw.error === 'string' ? raw.error as DiffFileFullContentPayload['error'] : undefined,
    }
  }
  const rawContent = content as Record<string, unknown>
  if (typeof rawContent.before !== 'string' || typeof rawContent.after !== 'string') return null
  return {
    path: typeof raw.path === 'string' ? raw.path : '',
    found: raw.found === true,
    content: {
      before: rawContent.before,
      after: rawContent.after,
    },
    error: typeof raw.error === 'string' ? raw.error as DiffFileFullContentPayload['error'] : undefined,
  }
}

export function createDiffDataOps(ctx: DiffDataOpsContext) {
  const refreshWorkspaceDiff = async (cwdOverride?: string | null, sourceInput?: ReviewGitSource | null) => {
    if (!ctx.canRefreshDiff()) return
    const source = normalizeReviewSource(sourceInput)
    const requestId = ctx.beginDiffRequest()
    ctx.setIsRefreshingDiff(true)
    try {
      const cwd = cwdOverride ?? ctx.resolveDiffCwd()
      const expectedSourceKey = getReviewSourceKey(source)
      const summaryParams = { source, maxFiles: 600, ...(cwd ? { cwd } : {}) }
      const summaryResult = await ctx.request('bridge/reviewGit/readDiffSummary', summaryParams).catch(() => null)
      const summarySnapshot = asDiffSnapshot(summaryResult)
      if (
        summarySnapshot &&
        isExpectedReviewSource(summarySnapshot, expectedSourceKey) &&
        !hasDiffErrorMarker(summarySnapshot) &&
        ctx.shouldAcceptDiffResult({ requestId, cwd: summarySnapshot.cwd || cwd })
      ) {
        ctx.setDiffSnapshot(summarySnapshot)
        return
      }
    } finally {
      if (ctx.isCurrentDiffRequest(requestId)) {
        ctx.setIsRefreshingDiff(false)
      }
    }
  }

  const requestDiffFilePatch = async (
    filePath: string,
    cwdOverride?: string | null,
    sourceInput?: ReviewGitSource | null,
  ): Promise<DiffFilePatchPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    if (!ctx.canRefreshDiff()) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const source = normalizeReviewSource(sourceInput)
    const result = await ctx
      .request('bridge/reviewGit/readDiffFilePatch', { source, path, maxBytes: 220 * 1024, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    const payload = asDiffFilePatchPayload(result)
    if (!payload) return null
    return payload
  }

  const requestDiffFilePreview = async (
    filePath: string,
    cwdOverride?: string | null,
    sourceInput?: ReviewGitSource | null,
  ): Promise<DiffFilePreviewPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    if (!ctx.canRefreshDiff()) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const source = normalizeReviewSource(sourceInput)
    const result = await ctx
      .request('bridge/reviewGit/readDiffFilePreview', { source, path, maxBytes: 8 * 1024 * 1024, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    return asDiffFilePreviewPayload(result)
  }

  const requestDiffFileFullContent = async (
    filePath: string,
    cwdOverride?: string | null,
    sourceInput?: ReviewGitSource | null,
  ): Promise<DiffFileFullContentPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    if (!ctx.canRefreshDiff()) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const source = normalizeReviewSource(sourceInput)
    const result = await ctx
      .request('bridge/reviewGit/readDiffFileFullContent', {
        source,
        path,
        maxBytes: 512 * 1024,
        ...(cwd ? { cwd } : {}),
      })
      .catch(() => null)
    return asDiffFileFullContentPayload(result)
  }

  const listReviewCommits = async (cwdOverride?: string | null): Promise<ReviewGitCommit[]> => {
    if (!ctx.canRefreshDiff()) return []
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const result = await ctx
      .request('bridge/reviewGit/listCommits', { limit: 10, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    return asReviewGitCommitList(result)
  }

  return {
    refreshWorkspaceDiff,
    requestDiffFilePatch,
    requestDiffFilePreview,
    requestDiffFileFullContent,
    listReviewCommits,
  }
}
