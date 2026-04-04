import type { PromptMessage } from '../../prompts'

const CONTINUED_SESSION_SUMMARY_PREFIX =
  'This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:'

export type CompactBoundaryMeta = {
  schemaVersion: 1
}

function isToolResultMessage(msg: PromptMessage): boolean {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return false
  return msg.content.some((b: any) => b?.type === 'tool_result')
}

function extractLeadingText(msg: PromptMessage): string {
  if (!Array.isArray(msg.content)) return ''
  for (const block of msg.content) {
    if (block?.type === 'text' && typeof (block as any).text === 'string') {
      return String((block as any).text)
    }
  }
  return ''
}

function findLastNonToolUserIndices(messages: PromptMessage[]): number[] {
  const out: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === 'user' && !isToolResultMessage(msg)) out.push(i)
  }
  return out
}

export function selectTailForCompaction(messages: PromptMessage[], keepLastTurns: number): PromptMessage[] {
  const keep = Number.isFinite(keepLastTurns) ? Math.max(0, Math.floor(keepLastTurns)) : 0
  if (keep <= 0 || messages.length === 0) return []

  const userTurnIndices = findLastNonToolUserIndices(messages)
  if (userTurnIndices.length === 0) return []

  const startUserIndex = userTurnIndices[Math.max(0, userTurnIndices.length - keep)] as number
  return messages.slice(startUserIndex)
}

export function buildCompactionSummaryUserText(summary: string): string {
  const trimmed = String(summary || '').trim()
  return (
    '<system-reminder>\n' +
    `${CONTINUED_SESSION_SUMMARY_PREFIX}\n` +
    `${trimmed}\n` +
    '</system-reminder>'
  )
}

export function buildCompactBoundaryMessage(): PromptMessage {
  return {
    role: 'assistant',
    content: [],
    meta: {
      compactBoundary: {
        schemaVersion: 1,
      },
    },
  }
}

export function isCompactBoundaryMessage(msg: PromptMessage | null | undefined): boolean {
  return msg?.role === 'assistant' && msg?.meta?.compactBoundary?.schemaVersion === 1
}

export function stripCompactBoundaryMessages(messages: PromptMessage[]): PromptMessage[] {
  if (!messages.some((message) => isCompactBoundaryMessage(message))) return messages
  return messages.filter((message) => !isCompactBoundaryMessage(message))
}

export function isCompactionSummaryUserMessage(msg: PromptMessage): boolean {
  if (!msg || msg.role !== 'user') return false
  if (isToolResultMessage(msg)) return false
  const raw = extractLeadingText(msg)
  const text = unwrapSystemReminder(raw)
  return text.startsWith(CONTINUED_SESSION_SUMMARY_PREFIX)
}

export function rebuildHistoryAfterCompaction(args: {
  summary: string
  previousHistory: PromptMessage[]
  keepLastTurns: number
}): PromptMessage[] {
  const summaryText = buildCompactionSummaryUserText(args.summary)
  const summaryMsg: PromptMessage = {
    role: 'user',
    content: [{ type: 'text', text: summaryText }] as any,
  }

  const tail = selectTailForCompaction(args.previousHistory, args.keepLastTurns)
  return [buildCompactBoundaryMessage(), summaryMsg, ...tail]
}

function unwrapSystemReminder(text: string): string {
  const raw = String(text || '').trim()
  const match = /^<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>$/.exec(raw)
  if (!match) return raw
  return String(match[1] || '').trim()
}
