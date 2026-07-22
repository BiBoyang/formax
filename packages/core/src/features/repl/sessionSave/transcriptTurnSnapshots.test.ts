import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TranscriptSegment } from '@formax/semantics'
import { describe, expect, it } from 'vitest'
import { encodeRecord } from './recordEncoding'
import {
  APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME,
  buildPersistedTranscriptTurnSnapshotData,
  parsePersistedTranscriptTurnSnapshot,
  readPersistedTranscriptProjectionSnapshot,
} from './transcriptTurnSnapshots'

function snapshotRecord(args: {
  threadId?: string
  turnId: string
  schemaVersion?: number
  segments: unknown[]
}) {
  return {
    type: 'event' as const,
    v: 1 as const,
    ts: '2026-07-10T00:00:00.000Z',
    name: APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME,
    data: {
      schemaVersion: args.schemaVersion ?? 1,
      threadId: args.threadId ?? 'thread-1',
      turnId: args.turnId,
      segments: args.segments,
    },
  }
}

function assistant(id: string, turnId: string, text: string): TranscriptSegment {
  return { id, kind: 'assistant', turnId, text }
}

function footer(id: string, turnId: string): TranscriptSegment {
  return { id, kind: 'turn_footer', turnId, status: 'completed' }
}

describe('persisted transcript turn snapshots', () => {
  it('preserves rich tool presentation fields in a valid snapshot', () => {
    const tool = {
      id: 'tool-1',
      kind: 'tool',
      turnId: 'turn-1',
      toolUseId: 'tool-use-1',
      toolName: 'Task',
      status: 'completed',
      summary: 'Task completed',
      detailLines: ['detail'],
      middleLines: ['middle'],
      transcriptLines: ['transcript'],
      nestedTools: [
        { id: 'nested-1', name: 'Bash', input: { command: 'pwd' }, status: 'completed', summary: 'done' },
      ],
      toolUses: 1,
      usage: { input_tokens: 3, output_tokens: 2 },
    }
    const snapshot = parsePersistedTranscriptTurnSnapshot(
      { schemaVersion: 1, threadId: 'thread-1', turnId: 'turn-1', segments: [tool, footer('f1', 'turn-1')] },
      'thread-1',
    )

    expect(snapshot?.segments[0]).toEqual(tool)
  })

  it('rejects non-terminal snapshots before writing', () => {
    expect(() => buildPersistedTranscriptTurnSnapshotData({
      threadId: 'thread-1',
      turnId: 'turn-1',
      segments: [assistant('a1', 'turn-1', 'incomplete')],
    })).toThrow('non-terminal')
  })

  it('assembles turns in JSONL order and replaces a repeated turn in place', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-transcript-snapshot-'))
    const filePath = path.join(dir, 'session.jsonl')
    const records = [
      snapshotRecord({
        turnId: 'turn-1',
        segments: [
          assistant('a1', 'turn-1', 'before'),
          {
            id: 'tool-1',
            kind: 'tool',
            turnId: 'turn-1',
            toolUseId: 'tool-use-1',
            toolName: 'Read',
            status: 'completed',
            summary: 'Read completed',
            detailLines: ['line'],
          },
          assistant('a2', 'turn-1', 'after'),
          footer('f1', 'turn-1'),
        ],
      }),
      snapshotRecord({
        turnId: 'turn-2',
        segments: [assistant('a3', 'turn-2', 'second turn'), footer('f2', 'turn-2')],
      }),
      snapshotRecord({
        turnId: 'turn-1',
        segments: [assistant('a1-replaced', 'turn-1', 'replacement'), footer('f1-replaced', 'turn-1')],
      }),
    ]
    await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')

    const projection = await readPersistedTranscriptProjectionSnapshot({ filePath, threadId: 'thread-1' })

    expect(projection).not.toBeNull()
    expect(projection?.lastReplaySeq).toBe(0)
    expect(projection?.segments.map((segment) => `${segment.turnId}:${segment.id}`)).toEqual([
      'turn-1:a1-replaced',
      'turn-1:f1-replaced',
      'turn-2:a3',
      'turn-2:f2',
    ])
    expect(projection?.openAssistantSegmentIdByTurn).toEqual({})
    expect(projection?.openThinkingSegmentIdByTurn).toEqual({})
  })

  it('rejects a partial snapshot series when a later started turn has no terminal snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-transcript-snapshot-interrupted-'))
    const filePath = path.join(dir, 'session.jsonl')
    const records = [
      {
        type: 'event',
        v: 1,
        ts: '2026-07-10T00:00:00.000Z',
        name: 'app_turn_started',
        data: { threadId: 'thread-1', turnId: 'turn-1' },
      },
      snapshotRecord({
        turnId: 'turn-1',
        segments: [assistant('a1', 'turn-1', 'complete'), footer('f1', 'turn-1')],
      }),
      {
        type: 'event',
        v: 1,
        ts: '2026-07-10T00:00:01.000Z',
        name: 'app_turn_started',
        data: { threadId: 'thread-1', turnId: 'turn-2' },
      },
    ]
    await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')

    await expect(readPersistedTranscriptProjectionSnapshot({ filePath, threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('ignores malformed and unknown records without clearing an earlier valid turn', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-transcript-snapshot-invalid-'))
    const filePath = path.join(dir, 'session.jsonl')
    const records = [
      snapshotRecord({
        turnId: 'turn-1',
        segments: [assistant('a1', 'turn-1', 'kept'), footer('f1', 'turn-1')],
      }),
      snapshotRecord({
        turnId: 'turn-1',
        schemaVersion: 2,
        segments: [assistant('unknown-version', 'turn-1', 'ignored')],
      }),
      snapshotRecord({
        turnId: 'turn-1',
        segments: [assistant('wrong-turn', 'turn-other', 'ignored')],
      }),
      snapshotRecord({
        turnId: 'turn-1',
        segments: [assistant('missing-footer', 'turn-1', 'ignored')],
      }),
      { type: 'event', v: 1, ts: 'bad', name: APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME, data: null },
      '{not json',
    ]
    await fs.writeFile(
      filePath,
      `${records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n')}\n`,
      'utf8',
    )

    const projection = await readPersistedTranscriptProjectionSnapshot({ filePath, threadId: 'thread-1' })

    expect(projection?.segments.map((segment) => segment.id)).toEqual(['a1', 'f1'])
  })

  it('rejects a partial snapshot series when legacy turns precede the first snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-transcript-snapshot-partial-'))
    const filePath = path.join(dir, 'session.jsonl')
    const records = [
      {
        type: 'event',
        v: 1,
        ts: '2026-07-10T00:00:00.000Z',
        name: 'app_turn_started',
        data: { threadId: 'thread-1', turnId: 'legacy-turn' },
      },
      {
        type: 'event',
        v: 1,
        ts: '2026-07-10T00:00:01.000Z',
        name: 'app_turn_ended',
        data: { threadId: 'thread-1', turnId: 'legacy-turn', status: 'completed' },
      },
      snapshotRecord({
        turnId: 'new-turn',
        segments: [assistant('new-answer', 'new-turn', 'new'), footer('new-footer', 'new-turn')],
      }),
    ]
    await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')

    await expect(readPersistedTranscriptProjectionSnapshot({ filePath, threadId: 'thread-1' })).resolves.toBeNull()
  })

  it('keeps ordered essential segments when a snapshot exceeds the JSONL line budget', () => {
    const record = snapshotRecord({
      turnId: 'turn-large',
      segments: [
        assistant('a-before', 'turn-large', 'a'.repeat(5_000)),
        {
          id: 'tool-large',
          kind: 'tool',
          turnId: 'turn-large',
          toolUseId: 'tool-use-large',
          toolName: 'Bash',
          status: 'completed',
          summary: 'command completed',
          detailLines: Array.from({ length: 100 }, (_, index) => `detail-${index}-${'x'.repeat(100)}`),
          result: 'r'.repeat(5_000),
        },
        assistant('a-after', 'turn-large', 'b'.repeat(5_000)),
        footer('f-large', 'turn-large'),
      ],
    })

    const encoded = encodeRecord(record, 2_000)
    const parsed = JSON.parse(encoded.line) as Record<string, any>

    expect(encoded.truncated).toBe(true)
    expect(parsed.name).toBe(APP_TRANSCRIPT_TURN_SNAPSHOT_EVENT_NAME)
    expect(parsed.data.segments.map((segment: { id: string }) => segment.id)).toEqual([
      'a-before',
      'tool-large',
      'a-after',
      'f-large',
    ])
    expect(Buffer.byteLength(encoded.line, 'utf8')).toBeLessThanOrEqual(2_001)
  })
})
