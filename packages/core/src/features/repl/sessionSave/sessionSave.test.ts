import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findLatestSessionFile, readSessionFile, readSessionSummary } from './reader'
import type { SessionMetaRecord } from './records'
import { getSessionFilePath, getSessionsRoot } from './paths'
import type { ChatHistory } from './types'
import { SessionWriter } from './writer'

async function readLines(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
}

describe('sessionSave (jsonl)', () => {
  it('writes meta first and appends ui/history records', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer, filePath } = await SessionWriter.createNew({ cwd, env, model: 'test-model' })

    await writer.appendStableMsg({
      id: 'user-1',
      role: 'user',
      content: 'hi',
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })

    const history: ChatHistory = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    await writer.appendHistorySnapshot(history)
    await writer.shutdown()

    const lines = await readLines(filePath)
    expect(lines.length).toBeGreaterThanOrEqual(3)

    const meta = JSON.parse(lines[0]) as SessionMetaRecord
    expect(meta.type).toBe('session_meta')
    expect(meta.cwd).toBe(cwd)

    const ui = JSON.parse(lines[1]) as any
    expect(ui.type).toBe('ui_msg')
    expect(ui.msg.content).toBe('hi')

    const snap = JSON.parse(lines[2]) as any
    expect(snap.type).toBe('history_state')
    expect(Array.isArray(snap.messages)).toBe(true)
  })

  it('reader skips corrupted tail line and uses last history_state', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's1',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
        model: 'm',
      }),
      JSON.stringify({
        type: 'history_state',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        seq: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }],
      }),
      JSON.stringify({
        type: 'history_state',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        seq: 2,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'b' }] }],
      }),
      '{"type":"history_state",',
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    expect(replay.meta.sessionId).toBe('s1')
    expect(replay.parseErrors).toBeGreaterThanOrEqual(1)
    expect(replay.history.length).toBe(1)
    expect((replay.history[0] as any).content?.[0]?.text).toBe('b')
  })

  it('reader reconstructs tool messages from app_tool_event records', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tools-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Edit',
          phase: 'start',
          status: 'running',
          summary: 'Edit running',
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          phase: 'update',
          input: {
            file_path: 'demo.txt',
            old_string: 'foo',
            new_string: 'bar',
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:03.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          phase: 'end',
          status: 'completed',
          summary: 'Applied edit',
          lines: ['Applied edit', 'Updated 1 occurrence'],
          patchStartLineNumber: 12,
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const toolMessages = replay.messages.filter((message) => message.role === 'tool')
    expect(toolMessages).toHaveLength(1)

    const tool = toolMessages[0]
    expect(tool?.content).toBe('Applied edit')
    expect(tool?.toolInfo?.name).toBe('Edit')
    expect(tool?.toolInfo?.toolUseId).toBe('tool-1')
    expect(tool?.toolInfo?.status).toBe('completed')
    expect(tool?.toolInfo?.input).toEqual({
      file_path: 'demo.txt',
      old_string: 'foo',
      new_string: 'bar',
    })
    expect(tool?.toolInfo?.patchStartLineNumber).toBe(12)
    expect(tool?.toolInfo?.middleLines).toEqual(['Updated 1 occurrence'])
    expect(tool?.toolInfo?.result).toContain('Applied edit')
  })

  it('reader ignores ui tool rows and rebuilds tool input from app_tool_event', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tool-merge-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-merge',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        msg: {
          id: 'tool-ui-1',
          role: 'tool',
          content: 'Applied edit',
          timestamp: '2026-02-02T00:00:01.000Z',
          toolInfo: {
            name: 'Edit',
            toolUseId: 'tool-1',
            input: {},
            status: 'completed',
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Edit',
          phase: 'update',
          input: {
            file_path: 'demo.txt',
            old_string: 'old line',
            new_string: 'new line',
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:03.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Edit',
          phase: 'end',
          status: 'completed',
          summary: 'Applied edit',
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool')
    expect(tool?.id).toBe('tool-tool-1')
    expect(tool?.content).toBe('Applied edit')
    expect(tool?.toolInfo?.input).toEqual({
      file_path: 'demo.txt',
      old_string: 'old line',
      new_string: 'new line',
    })
  })

  it('reader falls back to legacy ui_msg tool rows when app_tool_event is absent', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tool-legacy-ui-only-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-legacy-only',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        msg: {
          id: 'tool-ui-only-1',
          role: 'tool',
          content: 'Legacy tool row',
          timestamp: '2026-02-02T00:00:01.000Z',
          toolInfo: {
            name: 'Edit',
            toolUseId: 'legacy-tool-1',
            input: { file_path: 'demo.txt' },
            status: 'completed',
          },
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool')
    expect(tool?.id).toBe('tool-ui-only-1')
    expect(tool?.toolInfo?.toolUseId).toBe('legacy-tool-1')
    expect(tool?.content).toBe('Legacy tool row')
  })

  it('reader keeps unmatched legacy ui tool rows in mixed legacy + event sessions', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tool-mixed-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-mixed',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        msg: {
          id: 'legacy-tool-ui-1',
          role: 'tool',
          content: 'Legacy read output',
          timestamp: '2026-02-02T00:00:01.000Z',
          toolInfo: {
            name: 'Read',
            toolUseId: 'legacy-read-1',
            input: { file_path: 'legacy.txt' },
            status: 'completed',
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-2',
          toolUseId: 'new-bash-1',
          toolName: 'Bash',
          phase: 'end',
          status: 'completed',
          summary: '/repo',
          lines: ['/repo'],
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tools = replay.messages.filter((message) => message.role === 'tool')
    expect(tools).toHaveLength(2)
    expect(tools.some((message) => message.id === 'legacy-tool-ui-1')).toBe(true)
    expect(tools.some((message) => message.toolInfo?.toolUseId === 'new-bash-1')).toBe(true)
  })

  it('reader prefers legacy terminal ui tool row over non-terminal persisted event for same toolUseId', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tool-partial-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-partial',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        msg: {
          id: 'legacy-bash-complete',
          role: 'tool',
          content: 'pwd => /repo',
          timestamp: '2026-02-02T00:00:02.000Z',
          toolInfo: {
            name: 'Bash',
            toolUseId: 'bash-1',
            input: { command: 'pwd' },
            status: 'completed',
            result: '/repo',
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'bash-1',
          toolName: 'Bash',
          phase: 'start',
          status: 'running',
          summary: 'Bash running',
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tools = replay.messages.filter((message) => message.role === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]?.id).toBe('legacy-bash-complete')
    expect(tools[0]?.toolInfo?.status).toBe('completed')
    expect(tools[0]?.content).toBe('pwd => /repo')
  })

  it('reader backfills missing terminal event fields from legacy ui tool row', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-tool-terminal-backfill-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-terminal-backfill',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        msg: {
          id: 'legacy-edit-1',
          role: 'tool',
          content: 'Edited demo.txt',
          timestamp: '2026-02-02T00:00:02.000Z',
          toolInfo: {
            name: 'Edit',
            toolUseId: 'edit-1',
            input: { file_path: 'demo.txt', old_string: 'before', new_string: 'after' },
            status: 'completed',
            result: 'Edited demo.txt',
            patchStartLineNumber: 33,
          },
        },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'edit-1',
          toolName: 'Edit',
          phase: 'end',
          status: 'completed',
          summary: 'Edited demo.txt',
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool' && message.toolInfo?.toolUseId === 'edit-1')
    expect(tool?.id).toBe('tool-edit-1')
    expect(tool?.toolInfo?.status).toBe('completed')
    expect(tool?.toolInfo?.input).toEqual({ file_path: 'demo.txt', old_string: 'before', new_string: 'after' })
    expect(tool?.toolInfo?.result).toBe('Edited demo.txt')
    expect(tool?.toolInfo?.patchStartLineNumber).toBe(33)
  })

  it('reader normalizes persisted Glob output to Found N files summary', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-glob-summary-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-glob',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'glob-1',
          toolName: 'Glob',
          phase: 'end',
          status: 'completed',
          summary: '/tmp/a.ts',
          lines: ['/tmp/a.ts', '/tmp/b.ts', '/tmp/c.ts'],
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool')
    expect(tool?.toolInfo?.name).toBe('Glob')
    expect(tool?.content).toBe('Found 3 files')
    expect(tool?.toolInfo?.middleLines).toBeUndefined()
  })

  it('reader keeps compact Read summary and hides persisted detail lines', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-summary-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-read',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'read-1',
          toolName: 'Read',
          phase: 'end',
          status: 'completed',
          summary: 'Read 630 lines',
          lines: ['1\timport x', '2\timport y', '3\timport z'],
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool')
    expect(tool?.toolInfo?.name).toBe('Read')
    expect(tool?.content).toBe('Read 630 lines')
    expect(tool?.toolInfo?.middleLines).toBeUndefined()
  })

  it('reader does not recompute Read line count from truncated persisted lines', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-read-noncompact-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-tools-read-noncompact',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_tool_event',
        data: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          toolUseId: 'read-legacy-1',
          toolName: 'Read',
          phase: 'end',
          status: 'completed',
          summary: 'Tool completed',
          lines: Array.from({ length: 80 }, (_, i) => `${i + 1}\tline ${i + 1}`),
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool')
    expect(tool?.toolInfo?.name).toBe('Read')
    expect(tool?.content).toBe('Tool completed')
    expect(tool?.content).not.toBe('Read 80 lines')
  })

  it('readSessionSummary prefers firstUserPrompt from ui_stats for title fallback', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-summary-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-summary',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'ui_stats',
        data: {
          uiMsgCount: 2,
          firstUserPrompt: '你好',
          lastUserPrompt: '早上吃没了',
        },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const summary = await readSessionSummary(filePath)
    expect(summary.lastUserPrompt).toBe('你好')
  })

  it('readSessionSummary keeps session_rename label even when newer ui_stats exists', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-summary-label-'))
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-summary-label',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: tmp,
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'session_rename',
        data: { label: 'Manual Name' },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        name: 'ui_stats',
        data: { uiMsgCount: 4, firstUserPrompt: '你好', lastUserPrompt: '新的消息' },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const summary = await readSessionSummary(filePath)
    expect(summary.label).toBe('Manual Name')
    expect(summary.lastUserPrompt).toBe('你好')
  })

  it('readSessionSummary prefers latest app_turn_started cwd over initial session_meta cwd', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-summary-cwd-'))
    const latestTurnCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-summary-cwd-target-'))
    const latestTurnCwdReal = await fs.realpath(latestTurnCwd).catch(() => latestTurnCwd)
    const filePath = path.join(tmp, 'session.jsonl')
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's-summary-cwd',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: '/var/folders/demo/T/resume-same-abc123',
        cwdReal: '/private/var/folders/demo/T/resume-same-abc123',
        provider: 'anthropic',
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:01.000Z',
        name: 'app_turn_started',
        data: { threadId: 's-summary-cwd', turnId: 'turn-1', cwd: '/Users/david/Desktop' },
      }),
      JSON.stringify({
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:02.000Z',
        name: 'app_turn_started',
        data: { threadId: 's-summary-cwd', turnId: 'turn-2', cwd: latestTurnCwd },
      }),
    ]
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8')

    const summary = await readSessionSummary(filePath)
    expect(summary.meta.cwd).toBe(latestTurnCwd)
    expect(summary.meta.cwdReal).toBe(latestTurnCwdReal)
  })

  it('writer enforces maxLineBytes by truncating ui_msg content (still valid json)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer, filePath } = await SessionWriter.createNew({ cwd, env, maxLineBytes: 500 })
    await writer.appendStableMsg({
      id: 'user-1',
      role: 'user',
      content: 'x'.repeat(5000),
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })
    await writer.shutdown()

    const lines = await readLines(filePath)
    const ui = JSON.parse(lines.find((l) => JSON.parse(l).type === 'ui_msg')!) as any
    expect(ui.truncated).toBe(true)
    expect(String(ui.msg.content)).toContain('Truncated')
  })

  it('appendStableMsg skips streaming and tool running messages', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer, filePath } = await SessionWriter.createNew({ cwd, env })
    await writer.appendStableMsg({
      id: 'assistant-streaming',
      role: 'assistant',
      content: 'partial',
      isStreaming: true,
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })
    await writer.appendStableMsg({
      id: 'tool-running',
      role: 'tool',
      content: 'running',
      toolInfo: { name: 'Bash', status: 'running', input: {}, result: '' },
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })
    await writer.appendStableMsg({
      id: 'assistant-final',
      role: 'assistant',
      content: 'ok',
      isStreaming: false,
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })
    await writer.shutdown()

    const lines = await readLines(filePath)
    const types = lines.map((l) => JSON.parse(l).type)
    expect(types.filter((t) => t === 'ui_msg')).toHaveLength(1)
    const ui = JSON.parse(lines.find((l) => JSON.parse(l).type === 'ui_msg')!) as any
    expect(ui.msg.id).toBe('assistant-final')
  })

  it('truncates oversized tool results when enforcing maxLineBytes', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer, filePath } = await SessionWriter.createNew({ cwd, env, maxLineBytes: 600 })
    await writer.appendStableMsg({
      id: 'tool-1',
      role: 'tool',
      content: 'OK',
      toolInfo: {
        name: 'Read',
        status: 'completed',
        input: {},
        result: 'x'.repeat(10_000),
      },
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    })
    await writer.shutdown()

    const lines = await readLines(filePath)
    const ui = JSON.parse(lines.find((l) => JSON.parse(l).type === 'ui_msg')!) as any
    expect(ui.truncated).toBe(true)
    expect(String(ui.msg.toolInfo.result)).toContain('Truncated')
  })

  it('keeps oversized app_tool_event records by truncating payload instead of dropping the event', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer, filePath } = await SessionWriter.createNew({ cwd, env, maxLineBytes: 700 })
    await writer.appendEvent('app_tool_event', {
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      phase: 'end',
      status: 'completed',
      summary: 'Read completed',
      lines: ['x'.repeat(10_000), 'y'.repeat(10_000)],
      input: {
        file_path: '/tmp/demo.txt',
        old_string: 'o'.repeat(10_000),
        new_string: 'n'.repeat(10_000),
      },
    })
    await writer.shutdown()

    const records = (await readLines(filePath)).map((line) => JSON.parse(line))
    const appToolEvents = records.filter((record) => record.type === 'event' && record.name === 'app_tool_event')
    expect(appToolEvents).toHaveLength(1)
    expect(records.some((record) => record.type === 'event' && record.name === 'line_truncated')).toBe(false)

    const replay = await readSessionFile(filePath)
    const tool = replay.messages.find((message) => message.role === 'tool' && message.toolInfo?.toolUseId === 'tool-1')
    expect(tool?.toolInfo?.status).toBe('completed')
    expect(String(tool?.content ?? '').length).toBeGreaterThan(0)
  })

  it('does not mutate live msg/history when truncating oversized records', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const { writer } = await SessionWriter.createNew({ cwd, env, maxLineBytes: 600 })

    const originalToolResult = 'x'.repeat(10_000)
    const msg: any = {
      id: 'tool-1',
      role: 'tool',
      content: 'OK',
      toolInfo: { name: 'Read', status: 'completed', result: originalToolResult },
      timestamp: new Date('2026-02-02T00:00:00.000Z'),
    }
    await writer.appendStableMsg(msg)
    expect(msg.toolInfo.result).toBe(originalToolResult)

    const originalText = 'y'.repeat(10_000)
    const history: ChatHistory = [{ role: 'user', content: [{ type: 'text', text: originalText }] }]
    await writer.appendHistorySnapshot(history)
    expect((history[0] as any).content?.[0]?.text).toBe(originalText)

    await writer.shutdown()
  })

  it('findLatestSessionFile prefers cwdReal and newest file', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const sessionsRoot = getSessionsRoot({ cwd, env })
    const now1 = new Date('2026-02-02T00:00:00.000Z')
    const now2 = new Date('2026-02-02T00:00:01.000Z')
    const file1 = getSessionFilePath({ sessionsRoot, now: now1, sessionId: 'a' })
    const file2 = getSessionFilePath({ sessionsRoot, now: now2, sessionId: 'b' })
    await fs.mkdir(path.dirname(file1), { recursive: true })
    await fs.mkdir(path.dirname(file2), { recursive: true })

    const cwdReal = await fs.realpath(cwd).catch(() => cwd)

    const metaBase = {
      type: 'session_meta',
      v: 1,
      startedAt: now1.toISOString(),
      cwd,
      cwdReal,
      provider: 'anthropic',
    }

    await fs.writeFile(
      file1,
      JSON.stringify({ ...metaBase, ts: now1.toISOString(), sessionId: 'a' }) + '\n',
      'utf8',
    )
    await fs.writeFile(
      file2,
      JSON.stringify({ ...metaBase, ts: now2.toISOString(), sessionId: 'b', startedAt: now2.toISOString() }) + '\n',
      'utf8',
    )

    const latest = await findLatestSessionFile({ cwd, env })
    expect(latest).toBe(file2)
  })

  it('findLatestSessionFile does not miss a project session when many other sessions are newer', async () => {
    const cwdA = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-a-'))
    const cwdB = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-cwd-b-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-session-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const sessionsRoot = getSessionsRoot({ cwd: cwdA, env })

    const cwdAReal = await fs.realpath(cwdA).catch(() => cwdA)
    const cwdBReal = await fs.realpath(cwdB).catch(() => cwdB)

    const metaA = {
      type: 'session_meta',
      v: 1,
      startedAt: '2026-02-01T00:00:00.000Z',
      cwd: cwdA,
      cwdReal: cwdAReal,
      provider: 'anthropic',
    }

    const fileA = getSessionFilePath({
      sessionsRoot,
      now: new Date('2026-02-01T00:00:00.000Z'),
      sessionId: 'project-a',
    })
    await fs.mkdir(path.dirname(fileA), { recursive: true })
    await fs.writeFile(fileA, JSON.stringify({ ...metaA, ts: '2026-02-01T00:00:00.000Z', sessionId: 'a' }) + '\n', 'utf8')

    // Create >200 newer sessions for another cwd, so a naive "check only top N newest globally"
    // would miss the current project's latest session.
    for (let i = 0; i < 250; i += 1) {
      const stamp = new Date(Date.UTC(2026, 1, 2, 0, 0, i)) // 2026-02-02
      const fp = getSessionFilePath({ sessionsRoot, now: stamp, sessionId: `other-${i}` })
      await fs.mkdir(path.dirname(fp), { recursive: true })
      await fs.writeFile(
        fp,
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: stamp.toISOString(),
          sessionId: `b-${i}`,
          startedAt: stamp.toISOString(),
          cwd: cwdB,
          cwdReal: cwdBReal,
          provider: 'anthropic',
        }) + '\n',
        'utf8',
      )
    }

    const latest = await findLatestSessionFile({ cwd: cwdA, env })
    expect(latest).toBe(fileA)
  })
})
