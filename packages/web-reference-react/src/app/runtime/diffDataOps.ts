import type { DiffFilePatchPayload, DiffFilePreviewPayload, DiffSnapshot } from '../../components/WorktreeDiffPane'

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

function asDiffSnapshot(value: unknown): DiffSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.files)) return null
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
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    hasChanges: raw.hasChanges === true,
    truncated: raw.truncated === true,
    files,
  }
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
  const source = rawPreview.source === 'head' || rawPreview.source === 'working_tree' ? rawPreview.source : undefined
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

export function createDiffDataOps(ctx: DiffDataOpsContext) {
  const refreshWorkspaceDiff = async (cwdOverride?: string | null) => {
    if (!ctx.canRefreshDiff()) return
    const requestId = ctx.beginDiffRequest()
    ctx.setIsRefreshingDiff(true)
    try {
      const cwd = cwdOverride ?? ctx.resolveDiffCwd()
      const summaryParams = { maxFiles: 600, ...(cwd ? { cwd } : {}) }
      const summaryResult = await ctx.request('bridge/readDiffSummary', summaryParams).catch(() => null)
      const summarySnapshot = asDiffSnapshot(summaryResult)
      if (
        summarySnapshot &&
        !hasDiffErrorMarker(summarySnapshot) &&
        ctx.shouldAcceptDiffResult({ requestId, cwd: summarySnapshot.cwd || cwd })
      ) {
        ctx.setDiffSnapshot(summarySnapshot)
        return
      }
      if (!ctx.shouldAcceptDiffResult({ requestId, cwd })) {
        return
      }

      const legacyResult = await ctx.request('bridge/readDiff', { maxBytes: 180 * 1024, ...(cwd ? { cwd } : {}) })
      const legacySnapshot = asDiffSnapshot(legacyResult)
      if (legacySnapshot && ctx.shouldAcceptDiffResult({ requestId, cwd: legacySnapshot.cwd || cwd })) {
        ctx.setDiffSnapshot(legacySnapshot)
      }
    } finally {
      if (ctx.isCurrentDiffRequest(requestId)) {
        ctx.setIsRefreshingDiff(false)
      }
    }
  }

  const requestDiffFilePatch = async (filePath: string, cwdOverride?: string | null): Promise<DiffFilePatchPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    if (!ctx.canRefreshDiff()) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const result = await ctx
      .request('bridge/readDiffFilePatch', { path, maxBytes: 220 * 1024, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    const payload = asDiffFilePatchPayload(result)
    if (!payload) return null
    return payload
  }

  const requestDiffFilePreview = async (filePath: string, cwdOverride?: string | null): Promise<DiffFilePreviewPayload | null> => {
    const path = filePath.trim()
    if (!path) return null
    if (!ctx.canRefreshDiff()) return null
    const cwd = cwdOverride ?? ctx.resolveDiffCwd()
    const result = await ctx
      .request('bridge/readDiffFilePreview', { path, maxBytes: 8 * 1024 * 1024, ...(cwd ? { cwd } : {}) })
      .catch(() => null)
    return asDiffFilePreviewPayload(result)
  }

  return {
    refreshWorkspaceDiff,
    requestDiffFilePatch,
    requestDiffFilePreview,
  }
}
