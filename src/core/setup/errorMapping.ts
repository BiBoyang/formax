import { ErrorCode } from '../errors/codes.js'
import type { ErrorCode as ErrorCodeValue } from '../errors/codes.js'

export type MappedError = {
  code: ErrorCodeValue
  message: string
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function messageToErrorCode(message: string): ErrorCodeValue {
  const m = message.toLowerCase()

  if (
    m.includes('401') ||
    m.includes('unauthorized') ||
    m.includes('invalid api key') ||
    m.includes('authentication')
  ) {
    return ErrorCode.Unauthorized
  }

  if (m.includes('403') || m.includes('forbidden') || m.includes('permission')) {
    return ErrorCode.Forbidden
  }

  if (m.includes('timeout') || m.includes('timed out') || m.includes('etimedout')) {
    return ErrorCode.Timeout
  }

  if (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('dns') ||
    m.includes('ssl') ||
    m.includes('certificate')
  ) {
    return ErrorCode.NetworkError
  }

  return ErrorCode.Unknown
}

export function mapUnknownError(err: unknown): MappedError {
  const message = asMessage(err)
  const code = messageToErrorCode(message)
  return { code, message }
}
