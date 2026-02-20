export type InitializeRuntimeArgs = {
  initializeHandshake: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  activeThreadIdRef: { current: string | null }
  resumeThreadInputs: (threadId: string) => Promise<void>
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
  shouldContinue?: () => boolean
}

export async function initializeRuntime(args: InitializeRuntimeArgs): Promise<void> {
  if (args.shouldContinue && !args.shouldContinue()) return
  await args.initializeHandshake()
  if (args.shouldContinue && !args.shouldContinue()) return
  await Promise.all([args.refreshThreads(), args.refreshWorkspaceDiff()])
  if (args.shouldContinue && !args.shouldContinue()) return
  const activeThreadId = args.activeThreadIdRef.current
  if (!activeThreadId) return
  await args.resumeThreadInputs(activeThreadId)
  if (args.shouldContinue && !args.shouldContinue()) return
  await args.replayThreadEvents(activeThreadId)
}
