import type { DiffFilePatchPayload } from '../../components/WorktreeDiffPane'

type DiffUiHandlersArgs = {
  refreshWorkspaceDiff: () => Promise<void>
  requestDiffFilePatch: (filePath: string) => Promise<DiffFilePatchPayload | null>
  runAsyncSafely: (task: Promise<unknown>) => void
}

export function createDiffUiHandlers(args: DiffUiHandlersArgs) {
  return {
    onRefreshDiff: () => {
      args.runAsyncSafely(args.refreshWorkspaceDiff())
    },
    onRequestDiffPatch: (filePath: string) => args.requestDiffFilePatch(filePath),
  }
}
