import { describe, expect, it } from 'vitest'
import { readCanonicalToolEndSummary, readCanonicalToolUpdateLine } from './toolEventCanonicalFields'

describe('toolEventCanonicalFields', () => {
  it('resolves update line from transcript, middle lines, then tool uses', () => {
    expect(readCanonicalToolUpdateLine({ transcriptLines: ['a', ' tail '] })).toBe('tail')
    expect(readCanonicalToolUpdateLine({ middleLines: ['x', ' tail2 '] })).toBe('tail2')
    expect(readCanonicalToolUpdateLine({ toolUses: 3 })).toBe('tool uses 3')
    expect(readCanonicalToolUpdateLine({ transcriptLines: [], middleLines: [] })).toBeUndefined()
  })

  it('resolves tool end summary with optional completed fallback', () => {
    expect(readCanonicalToolEndSummary({ result: { content: ' done ' } })).toBe('done')
    expect(readCanonicalToolEndSummary({ result: { is_error: true } })).toBe('error')
    expect(readCanonicalToolEndSummary({ result: {} })).toBeUndefined()
    expect(readCanonicalToolEndSummary({ result: {} }, { includeCompletedFallback: true })).toBe('completed')
    expect(readCanonicalToolEndSummary({}, { includeCompletedFallback: true })).toBe('completed')
  })
})
