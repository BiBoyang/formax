import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
  fingerprintCompactBoundaryMessage,
} from '../../../chat/context/compact'
import {
  DURABLE_SNIP_COMMITTED_EVENT_NAME,
  readDurableSnipStateFromSession,
  readDurableSnipStateFromSessionSync,
} from './durableSnipStoreEvents'

function snipEvent(args: {
  compactBoundaryFingerprint?: string | null
  startIndex: number
  endIndexExclusive: number
  removedMessageIds?: string[]
  removedMessageFingerprints?: string[]
  removedMessageIdentities?: Array<{
    schemaVersion: 1
    id: string
    parentId: string | null
    fingerprint: string
    source: 'explicit' | 'legacy_fallback'
  }>
  baseProjectionFingerprint?: string | null
  sourceProjectionKind?: 'model_facing_baseline'
}) {
  return {
    type: 'event',
    ts: '2026-05-21T00:00:00.000Z',
    name: DURABLE_SNIP_COMMITTED_EVENT_NAME,
    data: {
      schemaVersion: 1,
      source: 'request_snip',
      compactBoundaryFingerprint: args.compactBoundaryFingerprint,
      baseProjectionFingerprint: args.baseProjectionFingerprint,
      sourceProjectionKind: args.sourceProjectionKind,
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: args.startIndex,
          endIndexExclusive: args.endIndexExclusive,
          reason: 'durable snip test',
          removedMessageIds: args.removedMessageIds,
          removedMessageFingerprints: args.removedMessageFingerprints,
          removedMessageIdentities: args.removedMessageIdentities,
        },
      ],
    },
  }
}

describe('durableSnipStoreEvents', () => {
  it('rebuilds durable snip state from session events', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['msg-1'],
          removedMessageFingerprints: ['fp-1'],
          removedMessageIdentities: [
            {
              schemaVersion: 1,
              id: 'msg-1',
              parentId: null,
              fingerprint: 'fp-1',
              source: 'explicit',
            },
          ],
          baseProjectionFingerprint: 'baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
        JSON.stringify({ type: 'event', name: DURABLE_SNIP_COMMITTED_EVENT_NAME, data: { schemaVersion: 1 } }),
      ].join('\n'),
      'utf8',
    )

    const expected = {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'durable snip test',
          removedMessageIds: ['msg-1'],
          removedMessageFingerprints: ['fp-1'],
          removedMessageIdentities: [
            {
              schemaVersion: 1,
              id: 'msg-1',
              parentId: null,
              fingerprint: 'fp-1',
              source: 'explicit',
            },
          ],
        },
      ],
    }
    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableSnipStateFromSessionSync({ filePath })).toEqual(expected)
  })

  it('treats each durable snip event as the current removal snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-snapshot-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['old-msg'],
          removedMessageFingerprints: ['old-fp'],
        })),
        JSON.stringify(snipEvent({
          startIndex: 3,
          endIndexExclusive: 5,
          removedMessageIds: ['new-msg-1', 'new-msg-2'],
          removedMessageFingerprints: ['new-fp-1', 'new-fp-2'],
          baseProjectionFingerprint: 'new-baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: 'new-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 3,
          endIndexExclusive: 5,
          reason: 'durable snip test',
          removedMessageIds: ['new-msg-1', 'new-msg-2'],
          removedMessageFingerprints: ['new-fp-1', 'new-fp-2'],
        },
      ],
    })
  })

  it('rejects a mixed valid and invalid durable snip snapshot without replacing the previous snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-invalid-snapshot-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['old-msg'],
          removedMessageFingerprints: ['old-fp'],
          baseProjectionFingerprint: 'old-baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
        JSON.stringify({
          type: 'event',
          ts: '2026-05-21T00:00:01.000Z',
          name: DURABLE_SNIP_COMMITTED_EVENT_NAME,
          data: {
            schemaVersion: 1,
            source: 'request_snip',
            compactBoundaryFingerprint: null,
            baseProjectionFingerprint: 'invalid-baseline-fp',
            sourceProjectionKind: 'model_facing_baseline',
            removals: [
              {
                kind: 'model_facing_index_range',
                startIndex: 3,
                endIndexExclusive: 5,
                reason: 'valid entry in invalid snapshot',
              },
              {
                kind: 'model_facing_index_range',
                startIndex: 7,
                endIndexExclusive: 7,
                reason: 'invalid zero-width entry rejects whole snapshot',
              },
            ],
          },
        }),
      ].join('\n'),
      'utf8',
    )

    const expected = {
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: 'old-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'durable snip test',
          removedMessageIds: ['old-msg'],
          removedMessageFingerprints: ['old-fp'],
        },
      ],
    }

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableSnipStateFromSessionSync({ filePath })).toEqual(expected)
  })

  it('allows an empty durable snip snapshot to clear previous removals', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-clear-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['old-msg'],
        })),
        JSON.stringify({
          type: 'event',
          ts: '2026-05-21T00:00:01.000Z',
          name: DURABLE_SNIP_COMMITTED_EVENT_NAME,
          data: {
            schemaVersion: 1,
            source: 'request_snip',
            compactBoundaryFingerprint: null,
            removals: [],
          },
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: null,
      sourceProjectionKind: null,
      removals: [],
    })
  })

  it('clears unscoped durable snip removals when a compact boundary appears', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-unscoped-'))
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
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['pre-boundary-msg'],
        })),
        JSON.stringify({
          type: 'history_state',
          messages: [boundary, { role: 'user', content: [{ type: 'text', text: 'summary' }] }],
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: fingerprintCompactBoundaryMessage(boundary),
      baseProjectionFingerprint: null,
      sourceProjectionKind: null,
      removals: [],
    })
  })

  it('ignores unscoped durable snip events after a compact boundary is active', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-post-boundary-'))
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
        JSON.stringify(snipEvent({
          startIndex: 1,
          endIndexExclusive: 2,
          removedMessageIds: ['unscoped-post-boundary-msg'],
        })),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: fingerprintCompactBoundaryMessage(boundary),
      removals: [],
    })
  })

  it('clears stale durable snip removals on a newer compact-boundary generation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-snip-store-boundary-'))
    const filePath = path.join(dir, 'session.jsonl')
    const oldBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
    const newBoundary = buildCompactBoundaryMessage({
      trigger: 'reactive',
      triggerReason: { kind: 'reactive_error', detail: 'HTTP 413' },
      preTokens: 8192,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(1),
    })
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: 'history_state',
          messages: [oldBoundary, { role: 'user', content: [{ type: 'text', text: 'old summary' }] }],
        }),
        JSON.stringify(snipEvent({
          compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(oldBoundary),
          startIndex: 1,
          endIndexExclusive: 2,
        })),
        JSON.stringify({
          type: 'history_state',
          messages: [newBoundary, { role: 'user', content: [{ type: 'text', text: 'new summary' }] }],
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableSnipStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      activeCompactBoundaryFingerprint: fingerprintCompactBoundaryMessage(newBoundary),
      baseProjectionFingerprint: null,
      sourceProjectionKind: null,
      removals: [],
    })
    expect(readDurableSnipStateFromSessionSync({ filePath }).removals).toEqual([])
  })
})
