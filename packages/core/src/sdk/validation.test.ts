import { describe, expect, it } from 'vitest'
import { parsePromptHistory, parseRawSessionReplayOutput } from './validation.js'

const compactBoundaryMessage = {
  role: 'assistant' as const,
  content: [],
  meta: {
    messageIdentity: {
      schemaVersion: 1 as const,
      id: 'boundary-message-id',
      parentId: null,
      fingerprint: 'boundary-message-fp',
      source: 'explicit' as const,
    },
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
        messageIdentities: [
          {
            schemaVersion: 1 as const,
            id: 'summary-id',
            parentId: null,
            fingerprint: 'summary-fp',
            source: 'explicit' as const,
          },
        ],
      },
    },
  },
}

describe('sdk validation', () => {
  it('preserves compact preserved-segment message fingerprints in prompt history', () => {
    const parsed = parsePromptHistory([compactBoundaryMessage])

    expect(parsed[0]?.meta?.messageIdentity).toEqual({
      schemaVersion: 1,
      id: 'boundary-message-id',
      parentId: null,
      fingerprint: 'boundary-message-fp',
      source: 'explicit',
    })
    expect(parsed[0]?.meta?.compactBoundary?.preservedSegment?.messageFingerprints).toEqual([
      'summary-fp',
      'head-fp',
      'tail-fp',
    ])
    expect(parsed[0]?.meta?.compactBoundary?.preservedSegment?.messageIdentities).toEqual([
      {
        schemaVersion: 1,
        id: 'summary-id',
        parentId: null,
        fingerprint: 'summary-fp',
        source: 'explicit',
      },
    ])
  })

  it('preserves compact preserved-segment message fingerprints in raw session replay output', () => {
    const parsed = parseRawSessionReplayOutput({
      meta: { sessionId: 'session-1', cwd: '/repo' },
      history: [compactBoundaryMessage],
    })

    expect(parsed.history[0]?.meta?.messageIdentity?.id).toBe('boundary-message-id')
    expect(parsed.history[0]?.meta?.compactBoundary?.preservedSegment?.messageFingerprints).toEqual([
      'summary-fp',
      'head-fp',
      'tail-fp',
    ])
  })

  it('accepts preserved-segment identity entries that omit optional parentId', () => {
    const parsed = parsePromptHistory([
      {
        ...compactBoundaryMessage,
        meta: {
          compactBoundary: {
            ...compactBoundaryMessage.meta.compactBoundary,
            preservedSegment: {
              ...compactBoundaryMessage.meta.compactBoundary.preservedSegment,
              messageIdentities: [
                {
                  schemaVersion: 1 as const,
                  id: 'summary-id',
                  fingerprint: 'summary-fp',
                  source: 'explicit' as const,
                },
              ],
            },
          },
        },
      },
    ])

    expect(parsed[0]?.meta?.compactBoundary?.preservedSegment?.messageIdentities).toEqual([
      {
        schemaVersion: 1,
        id: 'summary-id',
        fingerprint: 'summary-fp',
        source: 'explicit',
      },
    ])
  })
})
