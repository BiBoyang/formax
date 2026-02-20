export type InitializeRuntimeArgs = {
  initializeHandshake: () => Promise<void>
  refreshThreads: () => Promise<void>
  refreshWorkspaceDiff: () => Promise<void>
  activeThreadIdRef: { current: string | null }
  resumeThreadInputs: (threadId: string) => Promise<void>
  replayThreadEvents: (threadId: string, options?: { fromStart?: boolean }) => Promise<boolean>
}

export async function initializeRuntime(args: InitializeRuntimeArgs): Promise<void> {
  await args.initializeHandshake()
  await Promise.all([args.refreshThreads(), args.refreshWorkspaceDiff()])
  const activeThreadId = args.activeThreadIdRef.current
  if (!activeThreadId) return
  await args.resumeThreadInputs(activeThreadId)
  await args.replayThreadEvents(activeThreadId)
}
