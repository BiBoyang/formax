import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import { getConnectionTestHint } from './hints.js'

describe('getConnectionTestHint', () => {
  it('returns actionable hints for common connection errors', () => {
    const baseUrl = 'https://api.anthropic.com/v1'

    const unauthorized = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl,
      error: { ok: false, code: ErrorCode.Unauthorized, message: 'bad key' },
    })
    expect(unauthorized?.lines.join(' ')).toContain('API key')

    const forbidden = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl,
      error: { ok: false, code: ErrorCode.Forbidden, message: 'forbidden' },
    })
    expect(forbidden?.lines.join(' ')).toContain('denied')

    const timeout = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl,
      error: { ok: false, code: ErrorCode.Timeout, message: 'timeout' },
    })
    expect(timeout?.lines.join(' ')).toContain(baseUrl)

    const network = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl,
      error: { ok: false, code: ErrorCode.NetworkError, message: 'dns' },
    })
    expect(network?.lines.join(' ')).toContain('DNS')
  })

  it('falls back when baseUrl is empty and returns null for unsupported error codes', () => {
    const timeout = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl: '   ',
      error: { ok: false, code: ErrorCode.Timeout, message: 'timeout' },
    })
    expect(timeout?.lines[0]).toBe('Verify the base URL is reachable.')

    const network = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl: '',
      error: { ok: false, code: ErrorCode.NetworkError, message: 'network' },
    })
    expect(network?.lines[0]).toBe('Verify the base URL is correct and reachable.')

    const unknown = getConnectionTestHint({
      provider: 'anthropic',
      baseUrl: '',
      error: { ok: false, code: ErrorCode.Unknown, message: 'unknown' },
    })
    expect(unknown).toBeNull()
  })
})
