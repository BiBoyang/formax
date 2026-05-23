import type { SelectThreadOptions } from './threadActions'

type ThreadUiHandlersArgs = {
  selectCwd: (cwd: string) => void
  selectThread: (threadId: string, options?: SelectThreadOptions) => void
  renameThread: (threadId: string, label: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
  enterNewThreadDraft: () => void
  enterNewThreadDraftInCwd: (cwd: string) => void
  hideThreadGroup: (cwd: string) => Promise<void>
  runAsyncSafely: (task: Promise<unknown>) => void
}

export function createThreadUiHandlers(args: ThreadUiHandlersArgs) {
  return {
    onSelectCwd: args.selectCwd,
    onSelectThread: args.selectThread,
    onRenameThread: (threadId: string, label: string) => {
      args.runAsyncSafely(args.renameThread(threadId, label))
    },
    onArchiveThread: (threadId: string) => {
      args.runAsyncSafely(args.archiveThread(threadId))
    },
    onEnterNewThreadDraft: () => {
      args.enterNewThreadDraft()
    },
    onEnterNewThreadDraftInCwd: (cwd: string) => {
      args.enterNewThreadDraftInCwd(cwd)
    },
    onHideThreadGroup: (cwd: string) => {
      args.runAsyncSafely(args.hideThreadGroup(cwd))
    },
  }
}
