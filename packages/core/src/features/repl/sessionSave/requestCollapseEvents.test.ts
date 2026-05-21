import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildAutoCompactKeepStrategy,
  buildCompactBoundaryMessage,
} from '../../../chat/context/compact'
import {
  readLatestRequestCollapseEventFromSession,
  readLatestRequestCollapseEventFromSessionSync,
} from './requestCollapseEvents'

function requestCollapseEvent(args: {
  ts: string
  phase?: 'initial' | 'reactive_retry'
  collapsedHeadMessageCount?: number
  estimatedTokensSaved?: number
  recapFingerprint?: string
}) {
  return {
    type: 'event',
    ts: args.ts,
    name: 'request_collapse_applied',
    data: {
      phase: args.phase ?? 'initial',
      collapsedHeadMessageCount: args.collapsedHeadMessageCount ?? 2,
      estimatedTokensSaved: args.estimatedTokensSaved ?? 128,
      recapFingerprint: args.recapFingerprint ?? 'collapse-recap-fingerprint',
    },
  }
}

function compactBoundary(preTokens: number) {
  return buildCompactBoundaryMessage({
    trigger: 'auto',
    preTokens,
    summaryKind: 'model_summary',
    keepStrategy: buildAutoCompactKeepStrategy(2),
  })
}

describe('requestCollapseEvents', () => {
  it('does not expose an old request-collapse event after a newer compact boundary generation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-request-collapse-generation-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(requestCollapseEvent({
          ts: '2026-05-21T00:00:00.000Z',
          recapFingerprint: 'old-collapse-recap',
        })),
        JSON.stringify({
          type: 'history_state',
          messages: [
            compactBoundary(8192),
            { role: 'user', content: [{ type: 'text', text: 'new compact summary' }] },
          ],
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readLatestRequestCollapseEventFromSession({ filePath })).resolves.toBeNull()
    expect(readLatestRequestCollapseEventFromSessionSync({ filePath })).toBeNull()
  })

  it('exposes the latest request-collapse event within the current compact boundary generation', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-request-collapse-current-generation-'))
    const filePath = path.join(dir, 'session.jsonl')
    const currentCollapse = requestCollapseEvent({
      ts: '2026-05-21T00:01:00.000Z',
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 256,
      recapFingerprint: 'current-collapse-recap',
    })
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(requestCollapseEvent({
          ts: '2026-05-21T00:00:00.000Z',
          recapFingerprint: 'old-collapse-recap',
        })),
        JSON.stringify({
          type: 'history_state',
          messages: [
            compactBoundary(8192),
            { role: 'user', content: [{ type: 'text', text: 'new compact summary' }] },
          ],
        }),
        JSON.stringify(currentCollapse),
      ].join('\n'),
      'utf8',
    )

    const expected = {
      phase: 'reactive_retry',
      occurredAtMs: Date.parse('2026-05-21T00:01:00.000Z'),
      collapsedHeadMessageCount: 4,
      estimatedTokensSaved: 256,
      recapFingerprint: 'current-collapse-recap',
    }
    await expect(readLatestRequestCollapseEventFromSession({ filePath })).resolves.toEqual(expected)
    expect(readLatestRequestCollapseEventFromSessionSync({ filePath })).toEqual(expected)
  })
})
