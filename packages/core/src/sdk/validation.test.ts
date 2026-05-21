import { describe, expect, it } from 'vitest'
import { parsePromptHistory, parseRawSessionReplayOutput } from './validation.js'

const compactBoundaryMessage = {
  role: 'assistant' as const,
  content: [],
  meta: {
    compactBoundary: {
      schemaVersion: 1 as const,
      trigger: 'manual' as const,
      preTokens: 2048,
      summaryKind: 'model_summary' as const,
      preservedSegment: {
        schemaVersion: 1 as const,
        continuationMessageCount: 3,
        preservedTailMessageCount: 2,
        summaryFingerprint: 'summary-fp',
        headFingerprint: 'head-fp',
        tailFingerprint: 'tail-fp',
        messageFingerprints: ['summary-fp', 'head-fp', 'tail-fp'],
      },
    },
  },
}

describe('sdk validation', () => {
  it('preserves compact preserved-segment message fingerprints in prompt history', () => {
    const parsed = parsePromptHistory([compactBoundaryMessage])

    expect(parsed[0]?.meta?.compactBoundary?.preservedSegment?.messageFingerprints).toEqual([
      'summary-fp',
      'head-fp',
      'tail-fp',
    ])
  })

  it('preserves compact preserved-segment message fingerprints in raw session replay output', () => {
    const parsed = parseRawSessionReplayOutput({
      meta: { sessionId: 'session-1', cwd: '/repo' },
      history: [compactBoundaryMessage],
    })

    expect(parsed.history[0]?.meta?.compactBoundary?.preservedSegment?.messageFingerprints).toEqual([
      'summary-fp',
      'head-fp',
      'tail-fp',
    ])
  })
})
