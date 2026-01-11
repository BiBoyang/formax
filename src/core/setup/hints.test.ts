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
})

