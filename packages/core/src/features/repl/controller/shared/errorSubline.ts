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

function lastAssistantMessage(messages: Msg[]): Msg | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'assistant') return msg
  }
  return null
}

export function shouldSuppressGlobalError(args: { messages: Msg[]; currentError: string | null }): boolean {
  const { messages, currentError } = args
  if (!currentError) return false

  const latestAssistant = lastAssistantMessage(messages)
  if (!latestAssistant) return false
  if (latestAssistant.ui?.kind !== 'command_subline') return false
  if (!isErrorLikeSubline(latestAssistant.content)) return false

  const expected = formatErrorSubline(currentError)
  return latestAssistant.content.trim() === expected.trim()
}
