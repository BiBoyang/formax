import { describe, expect, it } from 'vitest'
import { shouldPromoteReplayAsCanonical } from './replayMachine'

describe('replayMachine', () => {
  it('promotes replay stream as canonical only when entries are present and source rules match', () => {
    expect(
      shouldPromoteReplayAsCanonical({
        receivedEntries: true,
        fromStart: false,
        initialAfter: 5,
        currentTranscriptSource: 'replay',
      }),
    ).toBe(true)
    expect(
      shouldPromoteReplayAsCanonical({
        receivedEntries: false,
        fromStart: true,
        initialAfter: 0,
        currentTranscriptSource: 'history',
      }),
    ).toBe(false)
  })
})
