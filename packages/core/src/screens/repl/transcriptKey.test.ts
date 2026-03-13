import { describe, expect, it } from 'vitest'
import { buildPrimaryTranscriptStaticKey } from './transcriptKey'

describe('buildPrimaryTranscriptStaticKey', () => {
  it('changes key when sequence changes', () => {
    expect(buildPrimaryTranscriptStaticKey(10, 0)).not.toBe(buildPrimaryTranscriptStaticKey(11, 0))
  })

  it('changes key when compact start index changes', () => {
    expect(buildPrimaryTranscriptStaticKey(10, 0)).not.toBe(buildPrimaryTranscriptStaticKey(10, 1))
  })

  it('does not collide when seq increments and start index decrements', () => {
    const before = buildPrimaryTranscriptStaticKey(10, 1)
    const after = buildPrimaryTranscriptStaticKey(11, 0)
    expect(before).not.toBe(after)
  })
})
