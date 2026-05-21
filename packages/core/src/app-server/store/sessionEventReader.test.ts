import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionWriter } from '../../features/repl/sessionSave/index.js'
import {
  readLatestRequestCollapseEventFromSession,
  readPersistedToolMessagesFromSession,
  readRequestCollapseEventsFromSession,
  readStaleInputsFromSession,
} from './sessionEventReader.js'

describe('readStaleInputsFromSession', () => {
  it('returns only unresolved app_input_requested records as stale expired inputs', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer

    await writer.appendEvent('app_input_requested', {
      inputId: 'turn-1:ask-1:ask_user_question',
      threadId: created.meta.sessionId,
      turnId: 'turn-1',
      toolUseId: 'ask-1',
      kind: 'ask_user_question',
      createdAt: '2026-02-08T00:00:00.000Z',
      expiresAt: '2026-02-08T00:05:00.000Z',
    })
    await writer.appendEvent('app_input_requested', {
      inputId: 'turn-1:ask-2:ask_user_question',
      threadId: created.meta.sessionId,
      turnId: 'turn-1',
      toolUseId: 'ask-2',
      kind: 'ask_user_question',
      createdAt: '2026-02-08T00:01:00.000Z',
      expiresAt: '2026-02-08T00:06:00.000Z',
    })
    await writer.appendEvent('app_input_resolved', {
      inputId: 'turn-1:ask-2:ask_user_question',
      status: 'submitted',
      resolvedAt: '2026-02-08T00:01:30.000Z',
    })
    await writer.shutdown()

    const stale = await readStaleInputsFromSession({
      filePath: created.filePath,
      now: new Date('2026-02-09T00:00:00.000Z'),
    })

    expect(stale).toEqual([
      {
        inputId: 'turn-1:ask-1:ask_user_question',
        threadId: created.meta.sessionId,
        turnId: 'turn-1',
        toolUseId: 'ask-1',
        kind: 'ask_user_question',
        status: 'expired',
        createdAt: '2026-02-08T00:00:00.000Z',
        expiresAt: '2026-02-08T00:05:00.000Z',
        resolvedAt: '2026-02-09T00:00:00.000Z',
        reason: 'server_restart',
      },
    ])
  })

  it('uses current time when now is omitted', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-now-default-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-now-default-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer
    await writer.appendEvent('app_input_requested', {
      inputId: 'turn-1:approval-1:approval',
      threadId: created.meta.sessionId,
      turnId: 'turn-1',
      toolUseId: 'approval-1',
      kind: 'approval',
      createdAt: '2026-02-08T00:00:00.000Z',
      expiresAt: '2026-02-08T00:05:00.000Z',
    })
    await writer.shutdown()

    const stale = await readStaleInputsFromSession({ filePath: created.filePath })
    expect(stale).toHaveLength(1)
    expect(typeof stale[0]?.resolvedAt).toBe('string')
  })

  it('reconstructs persisted tool messages from app_tool_event records', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer

    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      phase: 'start',
      status: 'running',
      summary: 'Bash running',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      phase: 'update',
      input: { command: 'npm run type-check' },
      paramsText: 'command="npm run type-check"',
      line: 'update',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      phase: 'end',
      status: 'completed',
      summary: 'Ran command for 3s',
      patchStartLineNumber: 18,
      lines: ['> tsc --noEmit'],
    })
    await writer.shutdown()

    const toolMessages = await readPersistedToolMessagesFromSession({ filePath: created.filePath })
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      toolUseId: 'tool-1',
      toolName: 'Bash',
      status: 'completed',
      summary: 'Ran command for 3s',
      input: { command: 'npm run type-check' },
      patchStartLineNumber: 18,
      paramsText: 'command="npm run type-check"',
    })
    expect(toolMessages[0]?.detailLines).toEqual(expect.arrayContaining(['update', '> tsc --noEmit']))
  })

  it('preserves tool name when update/end events omit toolName', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-name-preserve-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-name-preserve-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer

    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-write-1',
      toolName: 'Write',
      phase: 'start',
      status: 'running',
      summary: 'Write running',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-write-1',
      phase: 'update',
      paramsText: 'file_path=\"/tmp/a.txt\"',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-1',
      threadId: created.meta.sessionId,
      toolUseId: 'tool-write-1',
      phase: 'end',
      status: 'completed',
      summary: 'Wrote /tmp/a.txt',
    })
    await writer.shutdown()

    const toolMessages = await readPersistedToolMessagesFromSession({ filePath: created.filePath })
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      toolUseId: 'tool-write-1',
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote /tmp/a.txt',
      paramsText: 'file_path=\"/tmp/a.txt\"',
    })
  })

  it('groups anonymous tool events by turn/tool across start-update-end', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-anon-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-anon-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer

    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-2',
      threadId: created.meta.sessionId,
      toolName: 'Bash',
      phase: 'start',
      status: 'running',
      summary: 'Bash running',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-2',
      threadId: created.meta.sessionId,
      toolName: 'Bash',
      phase: 'update',
      line: 'line-1',
    })
    await writer.appendEvent('app_tool_event', {
      turnId: 'turn-2',
      threadId: created.meta.sessionId,
      toolName: 'Bash',
      phase: 'end',
      status: 'completed',
      summary: 'Bash done',
      lines: ['line-2'],
    })
    await writer.shutdown()

    const toolMessages = await readPersistedToolMessagesFromSession({ filePath: created.filePath })
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      toolName: 'Bash',
      status: 'completed',
      summary: 'Bash done',
    })
    expect(toolMessages[0]?.detailLines).toEqual(expect.arrayContaining(['line-1', 'line-2']))
  })

  it('ignores malformed lines when reading stale inputs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-malformed-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        'not-json',
        JSON.stringify({
          type: 'event',
          name: 'app_input_requested',
          data: {
            inputId: 'turn-1:ask-1:ask_user_question',
            threadId: 'thread-1',
            turnId: 'turn-1',
            toolUseId: 'ask-1',
            kind: 'ask_user_question',
            createdAt: '2026-02-08T00:00:00.000Z',
            expiresAt: '2026-02-08T00:05:00.000Z',
          },
        }),
      ].join('\n'),
      'utf8',
    )

    const stale = await readStaleInputsFromSession({
      filePath,
      now: new Date('2026-02-09T00:00:00.000Z'),
    })

    expect(stale).toHaveLength(1)
    expect(stale[0]?.inputId).toBe('turn-1:ask-1:ask_user_question')
  })

  it('skips non-event and invalid payload shapes while reading stale inputs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-stale-input-invalid-shapes-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        '',
        '42',
        JSON.stringify({ type: 'meta', name: 'app_input_requested', data: {} }),
        JSON.stringify({ type: 'event', name: '   ', data: {} }),
        JSON.stringify({ type: 'event', name: 'app_other_event', data: {} }),
        JSON.stringify({ type: 'event', name: 'app_input_requested', data: null }),
        JSON.stringify({
          type: 'event',
          name: 'app_input_requested',
          data: {
            threadId: 't',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 'approval',
            createdAt: '2026-02-08T00:00:00.000Z',
            expiresAt: '2026-02-08T00:05:00.000Z',
          },
        }),
        JSON.stringify({
          type: 'event',
          name: 'app_input_requested',
          data: {
            inputId: 'x',
            threadId: 't',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 123,
            createdAt: '2026-02-08T00:00:00.000Z',
            expiresAt: '2026-02-08T00:05:00.000Z',
          },
        }),
        JSON.stringify({
          type: 'event',
          name: 'app_input_requested',
          data: {
            inputId: 'x',
            threadId: 't',
            turnId: 'turn-1',
            toolUseId: 'tool-1',
            kind: 'approval',
            createdAt: '2026-02-08T00:00:00.000Z',
            expiresAt: '2026-02-08T00:05:00.000Z',
          },
        }),
        JSON.stringify({ type: 'event', name: 'app_input_resolved', data: null }),
        JSON.stringify({
          type: 'event',
          name: 'app_input_resolved',
          data: { inputId: 'x' },
        }),
      ].join('\n'),
      'utf8',
    )

    const stale = await readStaleInputsFromSession({
      filePath,
      now: new Date('2026-02-09T00:00:00.000Z'),
    })

    expect(stale).toEqual([])
  })

  it('ignores malformed lines when reading persisted tool messages', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-malformed-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        '{"bad":',
        JSON.stringify({
          type: 'event',
          name: 'app_tool_event',
          ts: '2026-02-08T00:00:00.000Z',
          data: {
            turnId: 'turn-1',
            threadId: 'thread-1',
            toolUseId: 'tool-1',
            toolName: 'Bash',
            phase: 'start',
            status: 'running',
            summary: 'Bash running',
          },
        }),
      ].join('\n'),
      'utf8',
    )

    const toolMessages = await readPersistedToolMessagesFromSession({ filePath })
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]).toMatchObject({
      toolUseId: 'tool-1',
      toolName: 'Bash',
    })
  })

  it('skips non-event and non-tool lines while reading persisted tool messages', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-tool-event-invalid-shapes-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        '',
        '123',
        JSON.stringify({ type: 'meta', name: 'app_tool_event', data: {} }),
        JSON.stringify({ type: 'event', name: 'other_event', data: {} }),
      ].join('\n'),
      'utf8',
    )

    const toolMessages = await readPersistedToolMessagesFromSession({ filePath })
    expect(toolMessages).toEqual([])
  })

  it('reads persisted request-time collapse events from session', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      keepLastTurns: 2,
      preservedTailMessageCount: 4,
      retainedCompactSummary: true,
      recapFingerprint: 'abcdef0123456789',
    })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
    })
    await writer.shutdown()

    const events = await readRequestCollapseEventsFromSession({ filePath: created.filePath })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      keepLastTurns: 2,
      preservedTailMessageCount: 4,
      retainedCompactSummary: true,
      recapFingerprint: 'abcdef0123456789',
    })
    expect(events[1]).toMatchObject({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
    })
    expect(typeof events[0]?.occurredAtMs).toBe('number')
  })

  it('reads latest persisted request-time collapse event from session', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-latest-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-latest-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      recapFingerprint: 'abcdef0123456789',
    })
    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
    await writer.shutdown()

    const event = await readLatestRequestCollapseEventFromSession({ filePath: created.filePath })
    expect(event).toMatchObject({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'fedcba9876543210',
    })
  })

  it('reads latest request-time collapse only when it belongs to the current compact boundary', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-boundary-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-boundary-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    const writer = created.writer
    await writer.appendEvent('request_collapse_applied', {
      phase: 'initial',
      collapsedHeadMessageCount: 3,
      estimatedTokensSaved: 120,
      recapFingerprint: 'pre-compact-collapse',
    })
    const compactedHistory = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        meta: {
          compactBoundary: {
            schemaVersion: 1,
            trigger: 'auto',
            preTokens: 4096,
            summaryKind: 'session_memory',
          },
        },
      },
      { role: 'user', content: [{ type: 'text', text: 'compacted summary' }] },
    ] as any
    await writer.appendHistorySnapshot(compactedHistory)

    expect(await readLatestRequestCollapseEventFromSession({ filePath: created.filePath })).toBeNull()

    await writer.appendEvent('request_collapse_applied', {
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'post-compact-collapse',
    })
    await writer.appendHistorySnapshot([
      ...compactedHistory,
      { role: 'assistant', content: [{ type: 'text', text: 'later answer' }] },
    ] as any)
    await writer.shutdown()

    const event = await readLatestRequestCollapseEventFromSession({ filePath: created.filePath })
    expect(event).toMatchObject({
      phase: 'reactive_retry',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 64,
      recapFingerprint: 'post-compact-collapse',
    })
  })

  it('returns null when no persisted request-time collapse event exists', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-none-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-none-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const created = await SessionWriter.createNew({ cwd, env })
    await created.writer.shutdown()

    const event = await readLatestRequestCollapseEventFromSession({ filePath: created.filePath })
    expect(event).toBeNull()
  })

  it('ignores malformed request-time collapse events', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-collapse-event-malformed-'))
    const filePath = path.join(dir, 'session.jsonl')
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({ type: 'event', name: 'request_collapse_applied', data: { phase: 'initial' } }),
        JSON.stringify({
          type: 'event',
          ts: '2026-04-07T00:00:00.000Z',
          name: 'request_collapse_applied',
          data: {
            phase: 'bad',
            collapsedHeadMessageCount: 1,
            estimatedTokensSaved: 2,
          },
        }),
        JSON.stringify({
          type: 'event',
          ts: '2026-04-07T00:00:00.000Z',
          name: 'request_collapse_applied',
          data: {
            phase: 'initial',
            collapsedHeadMessageCount: 1,
            estimatedTokensSaved: 2,
            retainedCompactSummary: true,
          },
        }),
      ].join('\n'),
      'utf8',
    )

    const events = await readRequestCollapseEventsFromSession({ filePath })
    expect(events).toEqual([
      {
        phase: 'initial',
        occurredAtMs: Date.parse('2026-04-07T00:00:00.000Z'),
        collapsedHeadMessageCount: 1,
        estimatedTokensSaved: 2,
        retainedCompactSummary: true,
      },
    ])
  })
})
