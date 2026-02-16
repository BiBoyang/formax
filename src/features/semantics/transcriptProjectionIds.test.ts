import { describe, expect, it } from 'vitest'
import { createTranscriptSegmentId } from './transcriptProjectionIds'

describe('transcriptProjectionIds', () => {
  it('builds segment id without suffix', () => {
    const id = createTranscriptSegmentId({
      kind: 'assistant',
      replaySeq: 12,
      turnId: 'turn-1',
    })
    expect(id).toBe('turn-1:assistant:12')
  })

  it('builds segment id with suffix', () => {
    const id = createTranscriptSegmentId({
      kind: 'tool',
      replaySeq: 20,
      turnId: 'turn-2',
      suffix: 'tool-99',
    })
    expect(id).toBe('turn-2:tool:20:tool-99')
  })
})
