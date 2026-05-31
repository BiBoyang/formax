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
  readDurableToolResultContentReplacementSessionRecordsFromSession,
} from './durableToolResultContentReplacementEvents'
import {
  readDurableToolResultContentReplacementStateFromSession,
  readDurableToolResultContentReplacementStateFromSessionSync,
} from '../sessionRestore/durableToolResultContentReplacement'

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
  it('parses durable replacement DTO records without rebuilding semantic state', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-dto-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({ type: 'history_state', messages: [{ role: 'assistant', content: [] }] }),
        JSON.stringify(replacementEvent({
          sourceScope: { kind: 'sidechain', id: 'agent-1' },
          toolUseId: 'tool-1',
          replacementContent: '[replacement]',
          baseProjectionFingerprint: 'baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
        JSON.stringify({
          type: 'event',
          name: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
          data: {
            schemaVersion: 1,
            source: 'tool_result_content_replacement',
            sourceScope: { kind: 'sidechain', id: '' },
            replacements: [],
          },
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableToolResultContentReplacementSessionRecordsFromSession({ filePath })).resolves.toEqual([
      { type: 'history_state', messages: [{ role: 'assistant', content: [] }] },
      {
        type: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
        schemaVersion: 1,
        source: 'tool_result_content_replacement',
        sourceScope: { kind: 'sidechain', id: 'agent-1' },
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: 'baseline-fp',
        sourceProjectionKind: 'model_facing_baseline',
        replacements: [
          {
            kind: 'tool_result_block',
            toolUseId: 'tool-1',
            replacementContent: '[replacement]',
            reason: 'durable tool result replacement test',
          },
        ],
      },
    ])
  })

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

  it('falls back to main-thread scope for legacy events without sourceScope', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-legacy-'))
    const filePath = path.join(dir, 'session.jsonl')
    const event = replacementEvent({
      toolUseId: 'legacy-tool',
      replacementContent: '[legacy replacement]',
      baseProjectionFingerprint: 'legacy-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
    })
    delete (event.data as Record<string, unknown>).sourceScope

    await fs.writeFile(filePath, JSON.stringify(event), 'utf8')

    const expected = {
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: null,
      baseProjectionFingerprint: 'legacy-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [
        {
          kind: 'tool_result_block',
          toolUseId: 'legacy-tool',
          replacementContent: '[legacy replacement]',
          reason: 'durable tool result replacement test',
        },
      ],
    }

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableToolResultContentReplacementStateFromSessionSync({ filePath })).toEqual(expected)
  })

  it('rejects events with a malformed present sourceScope instead of falling back to main-thread', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-bad-scope-'))
    const filePath = path.join(dir, 'session.jsonl')
    const event = replacementEvent({
      toolUseId: 'bad-scope-tool',
      replacementContent: '[bad scope replacement]',
      baseProjectionFingerprint: 'bad-scope-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
    })
    ;(event.data as Record<string, unknown>).sourceScope = { kind: 'sidechain', id: '' }

    await fs.writeFile(filePath, JSON.stringify(event), 'utf8')

    const expected = {
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: null,
      replacements: [],
    }

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableToolResultContentReplacementStateFromSessionSync({ filePath })).toEqual(expected)
  })

  it('ignores malformed events after a valid replacement without clearing previous state', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-malformed-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(replacementEvent({
          toolUseId: 'valid-tool',
          replacementContent: '[valid replacement]',
          baseProjectionFingerprint: 'valid-baseline-fp',
          sourceProjectionKind: 'model_facing_baseline',
        })),
        JSON.stringify({
          type: 'event',
          name: DURABLE_TOOL_RESULT_CONTENT_REPLACEMENT_EVENT_NAME,
          data: {
            schemaVersion: 1,
            source: 'tool_result_content_replacement',
            sourceScope: { kind: 'main_thread' },
            replacements: [{ kind: 'tool_result_block', toolUseId: '', replacementContent: '[malformed]' }],
          },
        }),
      ].join('\n'),
      'utf8',
    )

    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toMatchObject({
      baseProjectionFingerprint: 'valid-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [{ toolUseId: 'valid-tool', replacementContent: '[valid replacement]' }],
    })
    expect(readDurableToolResultContentReplacementStateFromSessionSync({ filePath })).toMatchObject({
      baseProjectionFingerprint: 'valid-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      replacements: [{ toolUseId: 'valid-tool', replacementContent: '[valid replacement]' }],
    })
  })

  it('ignores events with an unknown sourceProjectionKind', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-durable-tool-result-replacement-source-kind-'))
    const filePath = path.join(dir, 'session.jsonl')
    const event = replacementEvent({
      toolUseId: 'bad-source-kind-tool',
      replacementContent: '[bad source kind replacement]',
      baseProjectionFingerprint: 'bad-source-kind-baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
    })
    ;(event.data as Record<string, unknown>).sourceProjectionKind = 'raw_transcript'

    await fs.writeFile(filePath, JSON.stringify(event), 'utf8')

    const expected = {
      schemaVersion: 1,
      sourceScope: { kind: 'main_thread' },
      activeCompactBoundaryFingerprint: null,
      replacements: [],
    }
    await expect(readDurableToolResultContentReplacementStateFromSession({ filePath })).resolves.toEqual(expected)
    expect(readDurableToolResultContentReplacementStateFromSessionSync({ filePath })).toEqual(expected)
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
