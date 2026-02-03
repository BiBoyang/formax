import { describe, expect, it } from 'vitest'
import { isPrintableToken, isReturnKeyToken } from './keyTokens'

describe('keyTokens', () => {
  it('treats \\r as return even when key.return is false', () => {
    expect(isReturnKeyToken({ token: '\r', key: {} })).toBe(true)
  })

  it('treats \\n as return even when key.return is false', () => {
    expect(isReturnKeyToken({ token: '\n', key: {} })).toBe(true)
  })

  it('does not treat printable characters as return', () => {
    expect(isReturnKeyToken({ token: 'a', key: {} })).toBe(false)
  })

  it('does not treat return tokens as printable', () => {
    expect(isPrintableToken({ token: '\r', key: {} })).toBe(false)
    expect(isPrintableToken({ token: '\n', key: {} })).toBe(false)
  })
})

