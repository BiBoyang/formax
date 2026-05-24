import { RpcRequestError } from '../../rpcClient'
import type { ThreadSummary } from '../../types'
import type { ThreadRuntimeState } from '../../semantics'
import type { PendingInput } from '../../types'
import { selectThreadTitle } from './threadViewModel'

export type RpcErrorDetails = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}

export type SubmitUiStatus = {
  kind: 'success' | 'error'
  message: string
}

export function displayThreadTitle(thread: ThreadSummary | undefined): string {
  return selectThreadTitle(thread)
}

export function toRuntimePendingInputsById(pendingInputs: PendingInput[]): ThreadRuntimeState['pendingInputs'] {
  const next: ThreadRuntimeState['pendingInputs'] = {}
  for (const input of pendingInputs) {
    next[input.inputId] = {
      inputId: input.inputId,
      threadId: input.threadId,
      turnId: input.turnId,
      toolUseId: input.toolUseId,
      kind: input.kind,
      status: 'pending',
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      payload: input.payload,
    }
  }
  return next
}

export function summarizeToolEvent(event: any): string {
  if (!event || typeof event !== 'object') return 'tool event'
  if (event.type === 'tool_start') return ''
  if (event.type === 'tool_input') return ''
  if (event.type === 'tool_end') {
    const content = typeof event?.result?.content === 'string' ? event.result.content.trim() : ''
    return content || 'completed'
  }
  if (event.type === 'tool_update') {
    const middleLines = Array.isArray(event.middleLines) ? event.middleLines : []
    const transcriptLines = Array.isArray(event.transcriptLines) ? event.transcriptLines : []
    const line = transcriptLines[transcriptLines.length - 1] ?? middleLines[middleLines.length - 1]
    if (line && String(line).trim()) return String(line)
    if (typeof event.toolUses === 'number') return `tool uses ${event.toolUses}`
    return ''
  }
  return String(event.type ?? 'tool event')
}

export function toToolUseId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function toRpcError(method: string, error: unknown): RpcErrorDetails {
  const at = new Date().toISOString()
  if (error instanceof RpcRequestError) {
    return {
      at,
      method,
      message: error.message,
      code: error.code,
      data: error.data,
    }
  }
  if (error instanceof Error) {
    return {
      at,
      method,
      message: error.message,
    }
  }
  return {
    at,
    method,
    message: String(error),
  }
}

export function toSubmitUiStatus(status: string): SubmitUiStatus {
  switch (status) {
    case 'accepted':
      return { kind: 'success', message: 'Accepted' }
    case 'already_submitted_same':
      return { kind: 'success', message: 'Same answer already accepted' }
    case 'conflict_already_submitted':
      return { kind: 'error', message: 'Different answer conflicts with previous submission' }
    case 'not_pending':
      return { kind: 'error', message: 'Input is no longer pending; refresh or re-run the action' }
    case 'expired':
      return { kind: 'error', message: 'Input expired; trigger the action again' }
    case 'canceled':
      return { kind: 'error', message: 'Input was canceled; trigger the action again' }
    default:
      return { kind: 'error', message: status }
  }
}

export function toTurnFooterStatus(errorMessage: string | null | undefined): 'failed' | 'interrupted' {
  const normalized = String(errorMessage ?? '').toLowerCase()
  if (normalized.includes('interrupt') || normalized.includes('aborted') || normalized.includes('cancel')) {
    return 'interrupted'
  }
  return 'failed'
}
