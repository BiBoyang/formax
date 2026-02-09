import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionWriter } from '../../features/repl/sessionSave/index.js'
import { readPersistedToolMessagesFromSession, readStaleInputsFromSession } from './sessionEventReader.js'

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
      paramsText: 'command="npm run type-check"',
    })
    expect(toolMessages[0]?.detailLines).toEqual(expect.arrayContaining(['update', '> tsc --noEmit']))
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
})
