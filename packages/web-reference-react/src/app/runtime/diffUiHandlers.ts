import type { DiffFilePatchPayload, DiffFilePreviewPayload } from '../../components/WorktreeDiffPane'

type DiffUiHandlersArgs = {
  refreshWorkspaceDiff: () => Promise<void>
  requestDiffFilePatch: (filePath: string) => Promise<DiffFilePatchPayload | null>
  requestDiffFilePreview: (filePath: string) => Promise<DiffFilePreviewPayload | null>
  runAsyncSafely: (task: Promise<unknown>) => void
}

export function createDiffUiHandlers(args: DiffUiHandlersArgs) {
  return {
    onRefreshDiff: () => {
      args.runAsyncSafely(args.refreshWorkspaceDiff())
    },
    onRequestDiffPatch: (filePath: string) => args.requestDiffFilePatch(filePath),
    onRequestDiffPreview: (filePath: string) => args.requestDiffFilePreview(filePath),
  }
}
