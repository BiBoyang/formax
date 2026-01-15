import type { PromptMessage } from '../../prompts'

function isToolResultMessage(msg: PromptMessage): boolean {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return false
  return msg.content.some((b: any) => b?.type === 'tool_result')
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

  const startUserIndex = userTurnIndices[Math.max(0, userTurnIndices.length - keep)] ?? 0
  return messages.slice(startUserIndex)
}

export function rebuildHistoryAfterCompaction(args: {
  summary: string
  previousHistory: PromptMessage[]
  keepLastTurns: number
}): PromptMessage[] {
  const summaryText = (args.summary || '').trim()
  const summaryMsg: PromptMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: summaryText }] as any,
  }

  const tail = selectTailForCompaction(args.previousHistory, args.keepLastTurns)
  return [summaryMsg, ...tail]
}

