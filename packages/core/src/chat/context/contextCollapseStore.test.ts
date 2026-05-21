import { describe, expect, it } from 'vitest'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  appendContextCollapseStoreEntry,
  buildContextCollapseStoreSnapshot,
  createContextCollapseCommittedEntry,
  setContextCollapseStoreActiveCompactBoundaryFingerprint,
} from './contextCollapseStore'
import type { ContextCollapseMeta } from './contextCollapse'
import type { PromptMessage } from '../../prompts'

function recapMessage(text: string): PromptMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
  }
}

function collapseMeta(overrides: Partial<ContextCollapseMeta> = {}): ContextCollapseMeta {
  return {
    schemaVersion: 1,
    kind: 'request_recap',
    keepLastTurns: 2,
    preservedTailMessageCount: 4,
    retainedCompactSummary: true,
    recentUserPromptCount: 1,
    recentFileCount: 1,
    earlierToolResultBlockCount: 2,
    recapFingerprint: '0123456789abcdef',
    ...overrides,
  }
}

describe('contextCollapseStore', () => {
  it('defines a serializable committed collapse entry shape', () => {
    const entry = createContextCollapseCommittedEntry({
      id: 'collapse-1',
      createdAtMs: 1234,
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 5 },
      compactBoundaryFingerprint: null,
      recapMessage: recapMessage('<system-reminder>Older continuation collapsed</system-reminder>'),
      metadata: collapseMeta(),
    })

    expect(CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME).toBe('context_collapse_committed')
    expect(entry).toEqual({
      schemaVersion: 1,
      id: 'collapse-1',
      createdAtMs: 1234,
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: 1, endIndexExclusive: 5 },
      compactBoundaryFingerprint: null,
      recapMessage: recapMessage('<system-reminder>Older continuation collapsed</system-reminder>'),
      metadata: collapseMeta(),
    })
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry)
  })

  it('normalizes invalid committed ranges while preserving append order', () => {
    const later = createContextCollapseCommittedEntry({
      id: 'collapse-later',
      createdAtMs: 2000,
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: -2, endIndexExclusive: 3 },
      recapMessage: recapMessage('later recap'),
      metadata: collapseMeta({ recapFingerprint: 'later-fingerprint' }),
    })
    const earlier = createContextCollapseCommittedEntry({
      id: 'collapse-earlier',
      createdAtMs: 1000,
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: 4, endIndexExclusive: 4 },
      recapMessage: recapMessage('earlier recap'),
      metadata: collapseMeta({ recapFingerprint: 'earlier-fingerprint' }),
    })

    const snapshot = buildContextCollapseStoreSnapshot({ entries: [later, earlier] })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      entries: [
        {
          ...later,
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 3 },
        },
        {
          ...earlier,
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 4, endIndexExclusive: 5 },
        },
      ],
    })
  })

  it('updates in-memory snapshots without rebuilding from the session file', () => {
    const entry = createContextCollapseCommittedEntry({
      id: 'collapse-1',
      createdAtMs: 1000,
      source: 'request_collapse',
      collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
      compactBoundaryFingerprint: 'compact-generation-1',
      recapMessage: recapMessage('recap'),
      metadata: collapseMeta(),
    })

    const withEntry = appendContextCollapseStoreEntry({ snapshot: null, entry })
    expect(withEntry).toMatchObject({
      activeCompactBoundaryFingerprint: 'compact-generation-1',
      entries: [entry],
    })

    const next = setContextCollapseStoreActiveCompactBoundaryFingerprint({
      snapshot: withEntry,
      activeCompactBoundaryFingerprint: 'compact-generation-2',
    })
    expect(next).toMatchObject({
      activeCompactBoundaryFingerprint: 'compact-generation-2',
      entries: [entry],
    })
  })
})
