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
  DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
  readDurableToolResultContentReplacementStateFromSession,
  readDurableToolResultContentReplacementStateFromSessionSync,
} from './durableToolResultContentReplacementEvents'

function replacementEvent(args: {
  sourceScope?: { kind: 'main_thread' } | { kind: 'sidechain'; id: string }
  compactBoundaryFingerprint?: string | null
  toolUseId: string
  replacementContent: string
  originalContentFingerprint?: string
  baseProjectionFingerprint?: string | null
  sourceProjectionKind?: 'model_facing_baseline'
}) {
  return {
    type: 'event',
    ts: '2026-05-21T00:00:00.000Z',
    name: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
    data: {
      schemaVersion: 1,
      source: 'tool_result_content_replacement',
      sourceScope: args.sourceScope ?? { kind: 'main_thread' },
      compactBoundaryFingerprint: args.compactBoundaryFingerprint,
      baseProjectionFingerprint: args.baseProjectionFingerprint,
      sourceProjectionKind: args.sourceProjectionKind,
      replacements: [
        {
          kind: 'tool_result_block',
          toolUseId: args.toolUseId,
          replacementContent: args.replacementContent,
          originalContentFingerprint: args.originalContentFingerprint,
          reason: 'durable tool result replacement test',
        },
      ],
    },
  }
}

describe('durableToolResultContentReplacementEvents', () => {
  it('rebuilds main-thread durable replacement state from session events', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(replacementEvent({
          toolUseId: 'tool-1',
          replacementContent: '[Tool result replaced by durable state]',
          originalContentFingerprint: 'result-fp',
          baseProjectionFingerprint: 'baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
        JSON.stringify({
          type: 'event',
          name: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
          data: { schemaVersion: 1 },
        }),
      ].join('\n'),
      'utf8',
    )

    const expected = {
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [
        {
          kind: 'tool_result_block',
          toolUseId: 'tool-1',
          replacementContent: '[Tool result replaced by durable state]',
          originalContentFingerprint: 'result-fp',
          reason: 'durable tool result replacement test',
        },
      ],
    }

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableToolResultContentReplacementStateFromSessionSync({ filePath })).toEqual(expected)
  })

  it('isolates sidechain replacement events from the main-thread state', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(replacementEvent({
          sourceScope: { kind: 'sidechain', id: 'agent-1' },
          toolUseId: 'tool-agent',
          replacementContent: '[agent replacement]',
        })),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: null,
      replacements: [],
    })
    await expect(
      readDurableToolResultContentReplacementStateFromSession({
        filePath,
        sourceScope: { kind: 'sidechain', id: 'agent-1' },
      }),
    ).resolves.toMatchObject({
      sourceScope: { kind: 'sidechain', id: 'agent-1' },
      replacements: [expect.objectContaining({ toolUseId: 'tool-agent' })],
    })
  })

  it('clears stale replacement snapshots when compact-boundary generation changes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-'))
    const filePath = path.join(dir, 'session.jsonl')
    const oldBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 2048,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
    const latestBoundary = buildCompactBoundaryMessage({
      trigger: 'auto',
      preTokens: 4096,
      summaryKind: 'model_summary',
      keepStrategy: buildAutoCompactKeepStrategy(2),
    })
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({ type: 'history_state', messages: [oldBoundary] }),
        JSON.stringify(replacementEvent({
          compactBoundaryFingerprint: fingerprintCompactBoundaryMessage(oldBoundary),
          toolUseId: 'tool-1',
          replacementContent: '[old replacement]',
        })),
        JSON.stringify({ type: 'history_state', messages: [latestBoundary] }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual({
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: fingerprintCompactBoundaryMessage(latestBoundary),
      replacements: [],
    })
  })
})
