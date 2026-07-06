import type {
  DiffFilePatchPayload,
  DiffFilePreviewPayload,
  ReviewGitCommit,
  ReviewGitSource,
} from '../../components/diff/diffTypes'

type DiffUiHandlersArgs = {
  refreshWorkspaceDiff: (cwdOverride?: string | null, source?: ReviewGitSource | null) => Promise<void>
  requestDiffFilePatch: (filePath: string, cwdOverride?: string | null, source?: ReviewGitSource | null) => Promise<DiffFilePatchPayload | null>
  requestDiffFilePreview: (filePath: string, cwdOverride?: string | null, source?: ReviewGitSource | null) => Promise<DiffFilePreviewPayload | null>
  listReviewCommits: (cwdOverride?: string | null) => Promise<ReviewGitCommit[]>
  runAsyncSafely: (task: Promise<unknown>) => void
}

export function createDiffUiHandlers(args: DiffUiHandlersArgs) {
  return {
    onRefreshDiff: (source?: ReviewGitSource | null) => {
      args.runAsyncSafely(args.refreshWorkspaceDiff(undefined, source))
    },
    onRequestDiffPatch: (filePath: string, source?: ReviewGitSource | null) => args.requestDiffFilePatch(filePath, undefined, source),
    onRequestDiffPreview: (filePath: string, source?: ReviewGitSource | null) => args.requestDiffFilePreview(filePath, undefined, source),
    onListReviewCommits: () => args.listReviewCommits(),
  }
}
