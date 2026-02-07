import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ChatHistory } from '../../../chat/engine'
import { findLatestSessionFile, readSessionFile } from './reader'
import type { SessionMetaRecord } from './records'
import { getSessionFilePath, getSessionsRoot } from './paths'
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
