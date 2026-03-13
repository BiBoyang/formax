import type { Msg } from '../../../../shared/toolMessageTypes'

const ERROR_SUBLINE_MAX_CHARS = 320

function truncateErrorSubline(text: string): string {
  if (text.length <= ERROR_SUBLINE_MAX_CHARS) return text
  const reserved = '... [truncated]'.length
  const headLen = Math.max(0, ERROR_SUBLINE_MAX_CHARS - reserved)
  return `${text.slice(0, headLen)}... [truncated]`
}

function simplifyErrorDetail(detail: string): string {
  const normalized = String(detail).replace(/\s+/g, ' ').trim()
  if (/^<!doctype html\b/i.test(normalized) || /^<html[\s>]/i.test(normalized)) {
    return 'HTML error response body'
  }
  return normalized
}

export function formatErrorSubline(rawMessage: string): string {
  const message = String(rawMessage || '').replace(/\s+/g, ' ').trim()
  if (!message) return 'Error: Unknown error'

  const finalize = (line: string): string => truncateErrorSubline(line)

  const httpMatch = /^HTTP\s+(\d{3})\s*:\s*(.+)$/i.exec(message)
  if (httpMatch) return finalize(`${httpMatch[1]} ${simplifyErrorDetail(httpMatch[2])}`)

  const apiWithStatusMatch = /^API Error:\s*(\d{3})\s*(.+)$/i.exec(message)
  if (apiWithStatusMatch) return finalize(`${apiWithStatusMatch[1]} ${simplifyErrorDetail(apiWithStatusMatch[2])}`)

  const apiWithoutStatusMatch = /^API Error:\s*(.+)$/i.exec(message)
  if (apiWithoutStatusMatch) return finalize(`API Error: ${simplifyErrorDetail(apiWithoutStatusMatch[1])}`)

  return finalize(message.startsWith('Error: ') ? message : `Error: ${message}`)
}

export function isErrorLikeSubline(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  return t.startsWith('Error:') || t.startsWith('API Error:') || /^[45]\d{2}\b/.test(t)
}

function lastAssistantMessageWithIndex(messages: Msg[]): { message: Msg; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'assistant') return { message: msg, index: i }
  }
  return null
}

function lastUserMessageIndex(messages: Msg[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'user') return i
  }
  return -1
}

function normalizedSubline(text: string): string {
  return String(text || '').trim()
}

function findMatchingErrorSublineIndex(args: {
  messages: Msg[]
  expectedErrorSubline: string
  maxIndex: number
}): number {
  for (let i = args.maxIndex; i >= 0; i--) {
    const msg = args.messages[i]
    if (msg?.role !== 'assistant') continue
    if (msg.ui?.kind !== 'command_subline') continue
    if (!isErrorLikeSubline(msg.content)) continue
    if (normalizedSubline(msg.content) === normalizedSubline(args.expectedErrorSubline)) return i
  }

  return -1
}

export function shouldSuppressGlobalError(args: { messages: Msg[]; currentError: string | null }): boolean {
  const { messages, currentError } = args
  if (!currentError) return false

  const latestAssistant = lastAssistantMessageWithIndex(messages)
  if (!latestAssistant) return false
  if (latestAssistant.message.ui?.kind !== 'command_subline') return false

  // A newer user input means currentError may belong to a fresh turn.
  const latestUserIdx = lastUserMessageIndex(messages)
  if (latestUserIdx > latestAssistant.index) return false

  const expectedErrorSubline = formatErrorSubline(currentError)

  if (
    isErrorLikeSubline(latestAssistant.message.content) &&
    normalizedSubline(latestAssistant.message.content) === normalizedSubline(expectedErrorSubline)
  ) {
    return true
  }

  return (
    findMatchingErrorSublineIndex({
      messages,
      expectedErrorSubline,
      maxIndex: latestAssistant.index - 1,
    }) >= 0
  )
}
