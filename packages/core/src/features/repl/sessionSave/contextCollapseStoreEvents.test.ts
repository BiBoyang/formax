import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
  readContextCollapseStoreSnapshotFromSession,
  readContextCollapseStoreSnapshotFromSessionSync,
} from './contextCollapseStoreEvents'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'

function committedEvent(args: {
  id: string
  createdAtMs: number
  startIndex: number
  endIndexExclusive: number
  recapFingerprint: string
}) {
  return {
    type: 'event',
    ts: new Date(args.createdAtMs).toISOString(),
    name: CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
    data: {
      id: args.id,
      createdAtMs: args.createdAtMs,
      source: 'request_collapse',
      collapsedRange: {
        kind: 'model_facing_index_range',
        startIndex: args.startIndex,
        endIndexExclusive: args.endIndexExclusive,
      },
      recapMessage: {
        role: 'user',
        content: [{ type: 'text', text: `recap ${args.id}` }],
      },
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        preservedTailMessageCount: 4,
        retainedCompactSummary: true,
        recentUserPromptCount: 1,
        recentFileCount: 1,
        earlierToolResultBlockCount: 2,
        recapFingerprint: args.recapFingerprint,
      },
    },
  }
}

describe('contextCollapseStoreEvents', () => {
  it('rebuilds a deterministic durable collapse snapshot from session events', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-context-collapse-store-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(committedEvent({
          id: 'collapse-later',
          createdAtMs: Date.parse('2026-05-21T00:02:00.000Z'),
          startIndex: 4,
          endIndexExclusive: 8,
          recapFingerprint: 'later-fingerprint',
        })),
        JSON.stringify({ type: 'event', name: CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME, data: { id: '' } }),
        JSON.stringify(committedEvent({
          id: 'collapse-earlier',
          createdAtMs: Date.parse('2026-05-21T00:01:00.000Z'),
          startIndex: -1,
          endIndexExclusive: 2,
          recapFingerprint: 'earlier-fingerprint',
        })),
      ].join('\n'),
      'utf8',
    )

    const expected = {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      entries: [
        expect.objectContaining({
          id: 'collapse-later',
          createdAtMs: Date.parse('2026-05-21T00:02:00.000Z'),
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 4, endIndexExclusive: 8 },
        }),
        expect.objectContaining({
          id: 'collapse-earlier',
          createdAtMs: Date.parse('2026-05-21T00:01:00.000Z'),
          collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
        }),
      ],
    }

    await expect(readContextCollapseStoreSnapshotFromSession({ filePath })).resolves.toEqual(expected)
    expect(readContextCollapseStoreSnapshotFromSessionSync({ filePath })).toEqual(expected)
  })

  it('carries the latest compact-boundary generation from history snapshots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-context-collapse-store-boundary-'))
    const filePath = path.join(dir, 'session.jsonl')
    const boundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: 'history_state',
          messages: [boundary, { role: 'user', content: [{ type: 'text', text: 'summary' }] }],
        }),
        JSON.stringify(committedEvent({
          id: 'collapse-current',
          createdAtMs: Date.parse('2026-05-21T00:03:00.000Z'),
          startIndex: 0,
          endIndexExclusive: 1,
          recapFingerprint: 'current-fingerprint',
        })),
      ].join('\n'),
      'utf8',
    )

    const expectedFingerprint = fingerprintCompactBoundaryMessage(boundary)

    await expect(readContextCollapseStoreSnapshotFromSession({ filePath })).resolves.toMatchObject({
      activeCompactBoundaryFingerprint: expectedFingerprint,
    })
    expect(readContextCollapseStoreSnapshotFromSessionSync({ filePath }).activeCompactBoundaryFingerprint).toBe(
      expectedFingerprint,
    )
  })

  it('clears the active compact-boundary generation on later boundaryless history snapshots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-context-collapse-store-boundary-clear-'))
    const filePath = path.join(dir, 'session.jsonl')
    const boundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: 'history_state',
          messages: [boundary, { role: 'user', content: [{ type: 'text', text: 'summary' }] }],
        }),
        JSON.stringify({
          type: 'history_state',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'fresh boundaryless prompt' }] }],
        }),
        JSON.stringify(committedEvent({
          id: 'collapse-stale',
          createdAtMs: Date.parse('2026-05-21T00:04:00.000Z'),
          startIndex: 0,
          endIndexExclusive: 1,
          recapFingerprint: 'stale-fingerprint',
        })),
      ].join('\n'),
      'utf8',
    )

    await expect(readContextCollapseStoreSnapshotFromSession({ filePath })).resolves.toMatchObject({
      activeCompactBoundaryFingerprint: null,
    })
    expect(readContextCollapseStoreSnapshotFromSessionSync({ filePath }).activeCompactBoundaryFingerprint).toBeNull()
  })
})
