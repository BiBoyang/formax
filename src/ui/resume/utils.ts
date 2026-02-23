import type { ResumeSessionSummary } from '../../features/commands/resumeDialogService.js'
import type { PreviewRow, ResumeListView } from './types.js'

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

export function formatRelativeTime(then: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - then.getTime())
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec || 1} seconds ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minutes ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hours ago`
  const day = Math.floor(hr / 24)
  return `${day} days ago`
}

export function normalizePromptText(value: string | null): string {
  const t = typeof value === 'string' ? value.trim() : ''
  return t ? t : 'No prompt'
}

export function matchesQuery(summary: ResumeSessionSummary, queryRaw: string): boolean {
  const q = queryRaw.trim().toLowerCase()
  if (!q) return true
  const parts = [
    summary.label ?? '',
    summary.lastUserPrompt ?? '',
    summary.meta.gitBranch ?? '',
    summary.meta.cwd ?? '',
    summary.meta.cwdReal ?? '',
  ]
  return parts.some((p) => String(p).toLowerCase().includes(q))
}

export function buildPreviewRows(args: {
  title: string
  rows: Array<{ role: string; text: string }>
}): PreviewRow[] {
  const out: PreviewRow[] = [{ key: 'title', text: args.title, dim: true }]
  for (let i = 0; i < args.rows.length; i++) {
    const r = args.rows[i]
    const prefix = r.role === 'user' ? '> ' : r.role === 'assistant' ? '⏺ ' : ''
    out.push({ key: `${i}-${r.role}`, text: `${prefix}${r.text}` })
  }
  return out
}

export function computeResumeListView<T>(args: {
  items: T[]
  cursor: number
  maxVisible: number
}): ResumeListView<T> {
  const { items, cursor, maxVisible } = args
  const maxTop = Math.max(0, items.length - maxVisible)

  let top = 0
  if (cursor <= 0) top = 0
  else if (cursor > maxVisible - 1) top = clamp(cursor - (maxVisible - 1), 0, maxTop)

  const visible = items.slice(top, top + maxVisible)
  const hasMoreAbove = top > 0
  const hasMoreBelow = top + maxVisible < items.length

  return { top, visible, hasMoreAbove, hasMoreBelow, total: items.length }
}
