export type ArchiveThreadLike = {
  id: string
  label?: string | null
  lastUserPrompt?: string | null
}

export type ArchiveSelectionArgs = {
  activeThreadId: string | null
  archivedThreadId: string
  orderedThreadIds: string[]
}

export type ArchiveSelectionResult = {
  shouldSwitchActiveThread: boolean
  nextActiveThreadId: string | null
}

function firstNonEmpty(values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    return trimmed
  }
  return null
}

export function resolveArchiveThreadDisplayName(thread: ArchiveThreadLike | null | undefined): string {
  if (!thread) return 'thread'
  return firstNonEmpty([thread.label, thread.lastUserPrompt]) ?? 'thread'
}

export function resolveArchiveSelection(args: ArchiveSelectionArgs): ArchiveSelectionResult {
  if (args.activeThreadId !== args.archivedThreadId) {
    return {
      shouldSwitchActiveThread: false,
      nextActiveThreadId: args.activeThreadId,
    }
  }

  const nextActiveThreadId =
    args.orderedThreadIds.find((threadId) => threadId !== args.archivedThreadId && threadId.trim().length > 0) ?? null
  return {
    shouldSwitchActiveThread: true,
    nextActiveThreadId,
  }
}

export function formatArchiveNotice(thread: ArchiveThreadLike | null | undefined): string {
  return `Archived "${resolveArchiveThreadDisplayName(thread)}"`
}
