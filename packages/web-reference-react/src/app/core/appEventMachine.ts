export function isNotificationForActiveThread(args: {
  params: any
  activeThreadId: string | null
}): boolean {
  const threadId =
    (typeof args.params?.threadId === 'string' ? args.params.threadId : null) ??
    (typeof args.params?.turn?.threadId === 'string' ? args.params.turn.threadId : null)
  if (!threadId) return true
  if (!args.activeThreadId) return true
  return threadId === args.activeThreadId
}
