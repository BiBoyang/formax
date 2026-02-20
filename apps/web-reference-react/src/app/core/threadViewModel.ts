import type { ThreadSummary } from '../../types'

export type ThreadViewModel = ThreadSummary & {
  title: string
}

export function selectThreadTitle(thread: Pick<ThreadSummary, 'label' | 'lastUserPrompt'> | undefined): string {
  if (!thread) return 'New Thread'
  const label = thread.label?.trim()
  if (label) return label
  const prompt = thread.lastUserPrompt?.trim()
  if (prompt) return prompt
  return 'New Thread'
}

export function toThreadViewModel(thread: ThreadSummary): ThreadViewModel {
  return {
    ...thread,
    title: selectThreadTitle(thread),
  }
}

export function selectThreadViewModelById(args: {
  threads: ThreadSummary[]
  threadId: string | null
}): ThreadViewModel | undefined {
  const { threads, threadId } = args
  if (!threadId) return undefined
  const thread = threads.find((item) => item.id === threadId)
  if (!thread) return undefined
  return toThreadViewModel(thread)
}

export function selectSortedThreadViewModels(threads: ThreadSummary[]): ThreadViewModel[] {
  return [...threads]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(toThreadViewModel)
}
