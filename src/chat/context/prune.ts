import type { PromptBlock, PromptMessage } from '../../prompts'
import { computeContextBudget } from './budget'
import { estimatePromptTokens } from './estimate'

const MAX_TOOL_RESULT_CHARS = 8_000
const MAX_EPHEMERAL_TEXT_CHARS = 8_000
const MIN_FALLBACK_TEXT_CHARS = 200

function isToolResultMessage(msg: PromptMessage): boolean {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return false
  return msg.content.some((b: any) => b?.type === 'tool_result')
}

function findLastNonToolUserIndex(messages: PromptMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    if (msg.role === 'user' && !isToolResultMessage(msg)) return i
  }
  return -1
}

function getToolUseIds(msg: PromptMessage): string[] {
  if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return []
  const ids: string[] = []
  for (const b of msg.content as any[]) {
    if (b?.type === 'tool_use' && typeof b.id === 'string') ids.push(b.id)
  }
  return ids
}

function getToolResultIds(msg: PromptMessage): string[] {
  if (msg.role !== 'user' || !Array.isArray(msg.content)) return []
  const ids: string[] = []
  for (const b of msg.content as any[]) {
    if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') ids.push(b.tool_use_id)
  }
  return ids
}

function normalizeToolPairs(messages: PromptMessage[]): PromptMessage[] {
  const toolUses = new Set<string>()
  const toolResults = new Set<string>()

  for (const msg of messages) {
    for (const id of getToolUseIds(msg)) toolUses.add(id)
    for (const id of getToolResultIds(msg)) toolResults.add(id)
  }

  const paired = new Set<string>()
  for (const id of toolUses) {
    if (toolResults.has(id)) paired.add(id)
  }

  const out: PromptMessage[] = []
  for (const msg of messages) {
    if (!Array.isArray(msg.content) || msg.content.length === 0) continue

    if (msg.role === 'assistant') {
      const next = msg.content.filter((b: any) => b?.type !== 'tool_use' || paired.has(String(b.id)))
      if (next.length > 0) out.push({ ...msg, content: next as any })
      continue
    }

    if (msg.role === 'user') {
      const next = msg.content.filter((b: any) => b?.type !== 'tool_result' || paired.has(String(b.tool_use_id)))
      if (next.length > 0) out.push({ ...msg, content: next as any })
      continue
    }

    out.push(msg)
  }

  return out
}

function dropLeadingToolResultMessages(messages: PromptMessage[]): PromptMessage[] {
  let start = 0
  while (start < messages.length && isToolResultMessage(messages[start]!)) start++
  return messages.slice(start)
}

function keepOnlyToolBlocks(msg: PromptMessage): PromptMessage | null {
  if (!Array.isArray(msg.content) || msg.content.length === 0) return null

  if (msg.role === 'assistant') {
    const next = msg.content.filter((b: any) => b?.type === 'tool_use')
    return next.length > 0 ? { ...msg, content: next as any } : null
  }

  if (msg.role === 'user') {
    const next = msg.content.filter((b: any) => b?.type === 'tool_result')
    return next.length > 0 ? { ...msg, content: next as any } : null
  }

  return msg
}

function reduceToEssentialTail(messages: PromptMessage[]): PromptMessage[] {
  if (messages.length <= 0) return messages

  const first = messages[0]!
  const rest = messages.slice(1)

  const essential: PromptMessage[] = [first]
  for (const msg of rest) {
    const kept = keepOnlyToolBlocks(msg)
    if (kept) essential.push(kept)
  }

  return dropLeadingToolResultMessages(normalizeToolPairs(essential))
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
  const clipped =
    raw.length > maxChars
      ? raw.startsWith('<')
        ? truncateTaggedText(raw, maxChars)
        : raw.slice(0, maxChars) + '\n\n… [truncated]'
      : raw
  return { role: msg.role, content: [{ type: 'text', text: clipped }] as any }
}

function forceFit(args: { system: PromptBlock[]; budgetTokens: number; messages: PromptMessage[] }): PromptMessage[] {
  const limit = Math.max(1, Math.floor(args.budgetTokens))
  let candidate = args.messages

  // Iteratively reduce to a single (possibly truncated) text message until it fits.
  for (let attempt = 0; attempt < 6; attempt++) {
    const estimate = estimatePromptTokens({ system: args.system, messages: candidate })
    if (estimate <= limit) return candidate

    const lastNonToolUserIndex = findLastNonToolUserIndex(candidate)
    let target: PromptMessage | undefined
    if (lastNonToolUserIndex >= 0) {
      target = candidate[lastNonToolUserIndex]
    } else {
      for (let i = candidate.length - 1; i >= 0; i--) {
        const msg = candidate[i]
        if (!msg) continue
        if (!isToolResultMessage(msg)) {
          target = msg
          break
        }
      }
      if (!target) target = candidate[candidate.length - 1]
    }
    if (!target) return []

    const maxChars = Math.max(
      MIN_FALLBACK_TEXT_CHARS,
      Math.floor(limit * 4 * Math.pow(0.6, attempt)),
    )
    candidate = [squashToSingleTextMessage(target, maxChars)]
  }

  return candidate
}

function truncateTaggedText(raw: string, maxChars: number): string {
  const text = String(raw ?? '')
  if (text.length <= maxChars) return text

  const openMatch = text.match(/^<([a-zA-Z0-9_-]+)(?:\s[^>]*)?>/)
  if (!openMatch) return text.slice(0, maxChars) + '\n… [truncated]'

  const tag = openMatch[1]
  const close = `</${tag}>`
  const hadClose = text.includes(close)
  let clipped = text.slice(0, maxChars)

  if (hadClose && !clipped.includes(close)) {
    clipped = clipped.replace(/\s*$/, '') + `\n… [truncated]\n${close}`
  } else if (!hadClose) {
    clipped = clipped + '\n… [truncated]'
  }

  return clipped
}

function truncateHotContent(msg: PromptMessage): PromptMessage {
  if (!Array.isArray(msg.content) || msg.content.length === 0) return msg

  let changed = false
  const next = msg.content.map((b: any) => {
    if (b?.type === 'tool_result') {
      const raw = typeof b.content === 'string' ? b.content : String(b.content ?? '')
      if (raw.length <= MAX_TOOL_RESULT_CHARS) return b
      changed = true
      return {
        ...b,
        content: raw.slice(0, MAX_TOOL_RESULT_CHARS) + '\n\n… [truncated]',
      }
    }

    if (b?.type === 'text' && b?.cache_control?.type === 'ephemeral') {
      const raw = typeof b.text === 'string' ? b.text : String(b.text ?? '')
      if (raw.length <= MAX_EPHEMERAL_TEXT_CHARS) return b
      changed = true
      return { ...b, text: truncateTaggedText(raw, MAX_EPHEMERAL_TEXT_CHARS) }
    }

    return b
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
  const truncated = args.messages.map(truncateHotContent)
  const truncatedEstimate = estimatePromptTokens({ system: args.system, messages: truncated })
  if (truncatedEstimate <= budget.effectiveLimitTokens) {
    return { messages: truncated, pruned: true }
  }

  // Pass 2: drop oldest messages until within budget, while maintaining tool_use/tool_result pairs.
  const lastNonToolUserIndex = findLastNonToolUserIndex(truncated)
  const maxStart = lastNonToolUserIndex >= 0 ? lastNonToolUserIndex : truncated.length - 1

  let start = 0
  while (start < truncated.length) {
    const normalized = dropLeadingToolResultMessages(normalizeToolPairs(truncated.slice(start)))
    const estimate = estimatePromptTokens({ system: args.system, messages: normalized })
    if (estimate <= budget.effectiveLimitTokens) {
      return {
        messages: forceFit({ system: args.system, budgetTokens: budget.effectiveLimitTokens, messages: normalized }),
        pruned: true,
      }
    }

    if (start >= maxStart) {
      const essential = reduceToEssentialTail(normalized)
      const essentialEstimate = estimatePromptTokens({ system: args.system, messages: essential })

      return {
        messages:
          essentialEstimate <= budget.effectiveLimitTokens
            ? essential
            : forceFit({ system: args.system, budgetTokens: budget.effectiveLimitTokens, messages: essential }),
        pruned: true,
      }
    }

    start++
  }

  const normalizedAll = dropLeadingToolResultMessages(normalizeToolPairs(truncated))
  if (normalizedAll.length > 0) {
    return {
      messages: forceFit({
        system: args.system,
        budgetTokens: budget.effectiveLimitTokens,
        messages: normalizedAll,
      }),
      pruned: true,
    }
  }

  // Last-resort fallback: prefer returning nothing over emitting a tool_result-only prompt.
  // Callers that always append a user message (typical turn) will still be safe.
  for (let i = truncated.length - 1; i >= 0; i--) {
    const normalized = dropLeadingToolResultMessages(normalizeToolPairs([truncated[i]!]))
    const msg = normalized[0]
    if (!msg) continue
    if (isToolResultMessage(msg)) continue
    return {
      messages: forceFit({ system: args.system, budgetTokens: budget.effectiveLimitTokens, messages: [msg] }),
      pruned: true,
    }
  }

  return { messages: [], pruned: true }
}
