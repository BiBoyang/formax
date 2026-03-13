import type { ChatHistory } from '../../../../chat/engine'
import type { TokenUsage } from '../../../../streaming/types'
import { isCompactionSummaryUserMessage } from '../../../../chat/context/compact'
import { isExactSlashCommand as isExactSlashCommandFromRouting } from '../../../semantics/core/commandRouting'

export const isExactSlashCommand = isExactSlashCommandFromRouting

export function isAbortLikeError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: unknown; message?: unknown }
  const name = typeof e.name === 'string' ? e.name : ''
  const message = typeof e.message === 'string' ? e.message : ''
  if (name === 'AbortError') return true
  if (message === 'Stream aborted' || message === 'Request aborted') return true
  return /aborted/i.test(message)
}

export function formatToolUses(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return `${n} tool use${n === 1 ? '' : 's'}`
}

export function formatTokenTotal(usage: TokenUsage | undefined): string | null {
  const total = sumTokens(usage)
  if (total <= 0) return null
  return formatTokens(total)
}

export function sumInputTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
}

export function sumTokens(usage: TokenUsage | undefined): number {
  const u = usage || {}
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  )
}

export function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}m`
}

export function formatDuration(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function countNonToolUserTurns(history: ChatHistory): number {
  let n = 0
  for (const msg of history) {
    if (!msg || msg.role !== 'user') continue
    if (isCompactionSummaryUserMessage(msg)) continue
    const content = (msg as any).content
    if (!Array.isArray(content)) {
      n++
      continue
    }
    const hasToolResult = content.some((b: any) => b?.type === 'tool_result')
    if (!hasToolResult) n++
  }
  return n
}

export function extractAssistantText(history: ChatHistory): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg?.role !== 'assistant') continue

    const content = (msg as any).content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) continue

    const parts = content
      .map((b: any) => (b?.type === 'text' && typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
    return parts.join('')
  }

  return ''
}
