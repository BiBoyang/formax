import type { PromptBlock, PromptMessage } from '../../prompts'
import { computeContextBudget } from './budget'
import { estimatePromptTokens } from './estimate'

const MAX_TOOL_RESULT_CHARS = 8_000
const MIN_FALLBACK_TEXT_CHARS = 200

function isToolResultMessage(msg: PromptMessage): boolean {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return false
  return msg.content.some((b: any) => b?.type === 'tool_result')
}

function squashToSingleTextMessage(msg: PromptMessage, maxChars: number): PromptMessage {
  const chunks: string[] = []
  for (const b of msg.content as any[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text') chunks.push(String(b.text ?? ''))
    else if (b.type === 'thinking') chunks.push(String(b.thinking ?? ''))
    else if (b.type === 'tool_result') chunks.push(String(b.content ?? ''))
    else if (b.type === 'tool_use') chunks.push(`[tool_use ${String(b.name ?? '')}]`)
    else chunks.push(JSON.stringify(b))
  }

  const raw = chunks.join('\n').trim()
  const clipped = raw.length > maxChars ? raw.slice(0, maxChars) + '\n\n… [truncated]' : raw
  return { role: msg.role, content: [{ type: 'text', text: clipped }] as any }
}

function forceFit(args: { system: PromptBlock[]; budgetTokens: number; messages: PromptMessage[] }): PromptMessage[] {
  const limit = Math.max(1, Math.floor(args.budgetTokens))
  let candidate = args.messages

  // Iteratively reduce to a single (possibly truncated) text message until it fits.
  for (let attempt = 0; attempt < 6; attempt++) {
    const estimate = estimatePromptTokens({ system: args.system, messages: candidate })
    if (estimate <= limit) return candidate

    const last = candidate[candidate.length - 1]
    if (!last) return []

    const maxChars = Math.max(
      MIN_FALLBACK_TEXT_CHARS,
      Math.floor(limit * 4 * Math.pow(0.6, attempt)),
    )
    candidate = [squashToSingleTextMessage(last, maxChars)]
  }

  return candidate
}

function truncateToolResultContent(msg: PromptMessage): PromptMessage {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg

  let changed = false
  const next = msg.content.map((b: any) => {
    if (b?.type !== 'tool_result') return b
    const raw = typeof b.content === 'string' ? b.content : String(b.content ?? '')
    if (raw.length <= MAX_TOOL_RESULT_CHARS) return b
    changed = true
    return {
      ...b,
      content: raw.slice(0, MAX_TOOL_RESULT_CHARS) + '\n\n… [truncated]',
    }
  })

  return changed ? { ...msg, content: next as any } : msg
}

export function pruneForPromptBudget(args: {
  system: PromptBlock[]
  messages: PromptMessage[]
  contextWindowTokens: number
  effectiveContextWindowPercent?: number
  autoCompactLimitPercent?: number
  baselineTokens?: number
}): { messages: PromptMessage[]; pruned: boolean } {
  const budget = computeContextBudget({
    contextWindowTokens: args.contextWindowTokens,
    effectiveContextWindowPercent: args.effectiveContextWindowPercent,
    autoCompactLimitPercent: args.autoCompactLimitPercent,
    baselineTokens: args.baselineTokens,
  })

  const initialEstimate = estimatePromptTokens({ system: args.system, messages: args.messages })
  if (initialEstimate <= budget.effectiveLimitTokens) {
    return { messages: args.messages, pruned: false }
  }

  // Pass 1: truncate tool_result payloads (keeps tool pairs intact, only shortens content).
  const truncated = args.messages.map(truncateToolResultContent)
  const truncatedEstimate = estimatePromptTokens({ system: args.system, messages: truncated })
  if (truncatedEstimate <= budget.effectiveLimitTokens) {
    return { messages: truncated, pruned: true }
  }

  // Pass 2: drop oldest messages until within budget, but never start with a tool_result message.
  let start = 0
  while (start < truncated.length) {
    const slice = truncated.slice(start)
    const estimate = estimatePromptTokens({ system: args.system, messages: slice })
    if (estimate <= budget.effectiveLimitTokens) break
    start++
  }

  while (start < truncated.length && isToolResultMessage(truncated[start]!)) {
    start++
  }

  const sliced = truncated.slice(start)
  if (sliced.length > 0) {
    return {
      messages: forceFit({ system: args.system, budgetTokens: budget.effectiveLimitTokens, messages: sliced }),
      pruned: true,
    }
  }

  // Last-resort fallback: prefer returning nothing over emitting a tool_result-only prompt.
  // Callers that always append a user message (typical turn) will still be safe.
  for (let i = truncated.length - 1; i >= 0; i--) {
    const msg = truncated[i]!
    if (!isToolResultMessage(msg)) {
      return {
        messages: forceFit({ system: args.system, budgetTokens: budget.effectiveLimitTokens, messages: [msg] }),
        pruned: true,
      }
    }
  }

  return { messages: [], pruned: true }
}
