import { describe, expect, it } from 'vitest'
import { canFastRebaseGapWithoutHistory, shouldPromoteReplayAsCanonical } from './replayMachine'

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

  it('allows fast gap rebase only when transcript already has usable logs', () => {
    expect(canFastRebaseGapWithoutHistory({ transcriptSource: 'history', cachedLogsLength: 2 })).toBe(true)
    expect(canFastRebaseGapWithoutHistory({ transcriptSource: 'replay', cachedLogsLength: 1 })).toBe(true)
    expect(canFastRebaseGapWithoutHistory({ transcriptSource: undefined, cachedLogsLength: 2 })).toBe(false)
    expect(canFastRebaseGapWithoutHistory({ transcriptSource: 'history', cachedLogsLength: 0 })).toBe(false)
  })
})
