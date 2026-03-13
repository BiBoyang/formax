import type { ThreadRuntimeState } from '../../semantics'

type ThreadScopedRefs = {
  replayCursorByThreadRef: { current: Record<string, number> }
  replayAnomalyCountSeenByThreadRef: { current: Record<string, number> }
  runtimeStateByThreadRef: { current: Record<string, ThreadRuntimeState> }
}

type PruneThreadScopedRefsArgs = ThreadScopedRefs & {
  threadIds: string[]
  preservedThreadIds?: string[]
}

function pruneRecordByThreadIds<T>(record: Record<string, T>, validThreadIds: Set<string>): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [threadId, value] of Object.entries(record)) {
    if (!validThreadIds.has(threadId)) continue
    next[threadId] = value
  }
  return next
}

export function pruneThreadScopedRefs(args: PruneThreadScopedRefsArgs): void {
  const validThreadIds = new Set(args.threadIds)
  for (const threadId of args.preservedThreadIds ?? []) {
    if (!threadId) continue
    validThreadIds.add(threadId)
  }
  args.replayCursorByThreadRef.current = pruneRecordByThreadIds(args.replayCursorByThreadRef.current, validThreadIds)
  args.replayAnomalyCountSeenByThreadRef.current = pruneRecordByThreadIds(
    args.replayAnomalyCountSeenByThreadRef.current,
    validThreadIds,
  )
  args.runtimeStateByThreadRef.current = pruneRecordByThreadIds(args.runtimeStateByThreadRef.current, validThreadIds)
}
