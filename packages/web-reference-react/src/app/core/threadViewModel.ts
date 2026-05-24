import type { ThreadSummary } from '../../types'

export type ThreadViewModel = ThreadSummary & {
  title: string
}

function displayWidthOfCodePoint(codePoint: number): number {
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2329 && codePoint <= 0x232a) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2
  }
  return 1
}

export function compactThreadTitleForDisplay(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  let width = 0
  let out = ''
  let truncated = false
  let nextCharAfterCut = ''
  for (const char of normalized) {
    const charWidth = displayWidthOfCodePoint(char.codePointAt(0) ?? 0)
    if (width + charWidth > 50) {
      truncated = true
      nextCharAfterCut = char
      break
    }
    out += char
    width += charWidth
  }
  const trimmed = out.trimEnd()
  if (truncated && /[^\x00-\x7F]/.test(trimmed) && /[A-Za-z0-9_./-]/.test(nextCharAfterCut)) {
    return trimmed.replace(/[A-Za-z0-9_./-]+$/, '').trimEnd()
  }
  return trimmed
}

export function selectThreadTitle(
  thread: (Pick<ThreadSummary, 'label'> & Partial<Pick<ThreadSummary, 'lastUserPrompt'>>) | undefined,
): string {
  if (!thread) return 'New Thread'
  const label = thread.label?.trim()
  if (label) return compactThreadTitleForDisplay(label)
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
  const sortable = threads.map((thread) => ({
    thread,
    updatedAtMs: Date.parse(thread.updatedAt),
  }))
  sortable.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  return sortable.map(({ thread }) => toThreadViewModel(thread))
}
