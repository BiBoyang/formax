import type { SelectThreadOptions } from './threadActions'

type ThreadUiHandlersArgs = {
  selectCwd: (cwd: string) => void
  selectThread: (threadId: string, options?: SelectThreadOptions) => void
  renameThread: (threadId: string, label: string) => Promise<void>
  archiveThread: (threadId: string) => Promise<void>
  startThread: () => Promise<void>
  startThreadInCwd: (cwd: string) => Promise<void>
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
    onStartThread: () => {
      args.runAsyncSafely(args.startThread())
    },
    onStartThreadInCwd: (cwd: string) => {
      args.runAsyncSafely(args.startThreadInCwd(cwd))
    },
    onHideThreadGroup: (cwd: string) => {
      args.runAsyncSafely(args.hideThreadGroup(cwd))
    },
  }
}
