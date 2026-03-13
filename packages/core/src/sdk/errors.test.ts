import { describe, expect, it } from 'vitest'
import { AbortError as exportedAbortError } from './index.js'
import { AbortError } from './errors.js'

describe('sdk errors', () => {
  it('exports AbortError as an Error subclass with stable name', () => {
    const error = new AbortError('aborted')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AbortError)
    expect(error.name).toBe('AbortError')
    expect(error.message).toBe('aborted')
    expect(exportedAbortError).toBe(AbortError)
  })
})
