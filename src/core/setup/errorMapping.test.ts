import { describe, expect, it } from 'vitest'
import { ErrorCode } from '../errors/codes.js'
import { mapUnknownError } from './errorMapping.js'

describe('mapUnknownError', () => {
  it('maps auth errors', () => {
    expect(mapUnknownError(new Error('401 Unauthorized')).code).toBe(ErrorCode.Unauthorized)
    expect(mapUnknownError('Invalid API key').code).toBe(ErrorCode.Unauthorized)
    expect(mapUnknownError('403 Forbidden').code).toBe(ErrorCode.Forbidden)
  })

  it('maps timeout and network errors', () => {
    expect(mapUnknownError('Request timed out').code).toBe(ErrorCode.Timeout)
    expect(mapUnknownError('ETIMEDOUT').code).toBe(ErrorCode.Timeout)
    expect(mapUnknownError('ENOTFOUND api.example.com').code).toBe(ErrorCode.NetworkError)
    expect(mapUnknownError('SSL certificate error').code).toBe(ErrorCode.NetworkError)
  })

  it('keeps message and falls back to unknown', () => {
    const res = mapUnknownError({ what: 'happened' })
    expect(res.code).toBe(ErrorCode.Unknown)
    expect(res.message).toContain('what')
  })
})

