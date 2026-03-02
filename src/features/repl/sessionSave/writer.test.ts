import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { __writerTestOnly, getDefaultMaxLineBytes, SessionWriter } from './writer'
import type { ChatHistory, Msg } from './types'

describe('sessionSave/writer helpers', () => {
  it('covers id/time/git and persistable guards', async () => {
    expect(__writerTestOnly.isoNow(new Date('2026-02-02T00:00:00.000Z'))).toBe('2026-02-02T00:00:00.000Z')
    expect(__writerTestOnly.parseRequestedSessionId(' ok_1-2 ')).toBe('ok_1-2')
    expect(() => __writerTestOnly.parseRequestedSessionId('')).toThrow('non-empty')
    expect(() => __writerTestOnly.parseRequestedSessionId('bad/id')).toThrow('letters, numbers')

    const now = __writerTestOnly.resolveSessionStartTime(undefined)
    expect(now instanceof Date).toBe(true)
    expect(__writerTestOnly.resolveSessionStartTime('2026-02-02T00:00:00.000Z').toISOString()).toBe('2026-02-02T00:00:00.000Z')
    expect(() => __writerTestOnly.resolveSessionStartTime('bad-time')).toThrow('ISO datetime')
    expect(() => __writerTestOnly.resolveSessionStartTime(new Date('bad'))).toThrow('valid Date')

    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-writer-git-'))
    expect(__writerTestOnly.bestEffortGitBranch(nonGitDir)).toBeNull()
    const gitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-writer-git-real-'))
    expect(spawnSync('git', ['init'], { cwd: gitDir }).status).toBe(0)
    await fs.writeFile(path.join(gitDir, 'a.txt'), 'a', 'utf8')
    expect(spawnSync('git', ['add', 'a.txt'], { cwd: gitDir }).status).toBe(0)
    expect(
      spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'init'], {
        cwd: gitDir,
      }).status,
    ).toBe(0)
    const branchName = __writerTestOnly.bestEffortGitBranch(gitDir)
    expect(typeof branchName).toBe('string')
    expect(branchName && branchName !== 'HEAD').toBe(true)
    expect(spawnSync('git', ['checkout', '--detach'], { cwd: gitDir }).status).toBe(0)
    expect(__writerTestOnly.bestEffortGitBranch(gitDir)).toBeNull()

    expect(__writerTestOnly.bestEffortGitBranch('\u0000invalid')).toBeNull()

    const runningTool: Msg = {
      id: 't1',
      role: 'tool',
      content: 'running',
      timestamp: new Date(),
      toolInfo: { name: 'Bash', input: {}, status: 'running' },
    }
    expect(__writerTestOnly.isPersistableMsg({ ...runningTool, isStreaming: true } as Msg)).toBe(false)
    expect(__writerTestOnly.isPersistableMsg(runningTool)).toBe(false)
    expect(__writerTestOnly.isPersistableMsg({ ...runningTool, toolInfo: { name: 'Bash', input: {}, status: 'completed' } } as Msg)).toBe(true)
    expect(__writerTestOnly.isPersistableMsg({ ...runningTool, role: 'user' } as Msg)).toBe(true)
  })

  it('covers cloning and truncation helpers', () => {
    const msg: Msg = {
      id: 'tool-1',
      role: 'tool',
      content: 'x'.repeat(200),
      timestamp: new Date(),
      toolInfo: {
        name: 'Read',
        input: {},
        status: 'completed',
        result: 'y'.repeat(200),
        nestedTools: [{ id: 'n1', name: 'sub', status: 'completed' }] as any,
      },
    }
    const cloned = __writerTestOnly.cloneMsgForPersistence(msg)
    ;(cloned.toolInfo!.nestedTools![0] as any).name = 'changed'
    expect((msg.toolInfo!.nestedTools![0] as any).name).toBe('sub')

    const history: ChatHistory = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(200) }, { type: 'tool_use', id: 'x' }] } as any,
      { role: 'assistant', content: 'raw' as any },
      'plain-string' as any,
      { role: 'assistant', content: [1 as any, { type: 'text', text: 'ok' }] } as any,
    ]
    const historyCloned = __writerTestOnly.cloneHistoryForPersistence(history)
    ;(historyCloned[0] as any).content[0].text = 'changed'
    expect((history[0] as any).content[0].text).not.toBe('changed')

    const msgForTruncate: Msg = {
      id: 'u1',
      role: 'tool',
      content: 'z'.repeat(400),
      timestamp: new Date(),
      toolInfo: { name: 'Edit', input: {}, status: 'completed', result: 'q'.repeat(400) },
    }
    expect(__writerTestOnly.truncateMsgInPlace({ msg: msgForTruncate, maxContentBytes: 64 })).toBe(true)
    expect(String(msgForTruncate.content).length).toBeLessThan(400)
    expect(String(msgForTruncate.toolInfo?.result).length).toBeLessThan(400)

    const historyForTruncate: ChatHistory = [
      { role: 'user', content: [{ type: 'text', text: 'r'.repeat(500) }, { type: 'image', source: 'x' }] } as any,
      null as any,
      { role: 'assistant', content: [{ type: 'text', text: 1 as any }] } as any,
    ]
    expect(__writerTestOnly.truncateHistoryInPlace({ history: historyForTruncate, maxTextBytes: 64 })).toBe(true)
    expect(
      __writerTestOnly.truncateHistoryInPlace({
        history: [
          { role: 'assistant', content: [1 as any, { type: 'text', text: 'short' }] } as any,
          { role: 'assistant', content: 'not-array' as any } as any,
        ],
        maxTextBytes: 64,
      }),
    ).toBe(false)

    expect(
      __writerTestOnly.truncateMsgInPlace({
        msg: { id: 'a', role: 'assistant', content: ['x'] as any, timestamp: new Date() } as any,
        maxContentBytes: 10,
      }),
    ).toBe(false)
    expect(
      __writerTestOnly.truncateMsgInPlace({
        msg: {
          id: 't2',
          role: 'tool',
          content: 'ok',
          timestamp: new Date(),
          toolInfo: { name: 'Read', status: 'completed', result: { nested: true } as any },
        } as any,
        maxContentBytes: 10,
      }),
    ).toBe(false)
  })

  it('covers object and event sanitization helpers', () => {
    expect(__writerTestOnly.isPlainObject({})).toBe(true)
    expect(__writerTestOnly.isPlainObject([])).toBe(false)
    expect(__writerTestOnly.truncateTextValue(1, 10)).toBeUndefined()
    expect(__writerTestOnly.truncateTextValue('abc', 2)?.length).toBeLessThanOrEqual(2)

    const compacted = __writerTestOnly.compactInputObjectForEvent({
      input: {
        '': 'empty-key',
        a: 'x'.repeat(200),
        b: 1,
        c: true,
        d: null,
        e: ['x'],
        f: { k: 'v' },
        g: undefined,
      },
      maxEntries: 3,
      maxStringBytes: 16,
    })
    expect(Object.keys(compacted).length).toBe(3)
    const compactedRich = __writerTestOnly.compactInputObjectForEvent({
      input: {
        arr: ['x'],
        obj: { a: 1 },
        undef: undefined,
      },
      maxEntries: 10,
      maxStringBytes: 32,
    })
    expect(typeof compactedRich.arr).toBe('string')
    expect(typeof compactedRich.obj).toBe('string')

    const sanitizedDrop = __writerTestOnly.sanitizeAppToolEventData({
      data: {
        threadId: 't'.repeat(200),
        turnId: 'u'.repeat(200),
        toolUseId: 'v'.repeat(200),
        toolName: 'Read',
        phase: 'update',
        status: 'running',
        summary: 's'.repeat(200),
        paramsText: 'p'.repeat(200),
        line: 'l'.repeat(200),
        lines: [' ', 'a', 'b', 1 as any],
        input: { q: 'w'.repeat(200) },
        patchStartLineNumber: -1,
      },
      maxStringBytes: 20,
      maxLineBytes: 10,
      maxLines: 1,
      dropInput: true,
    })
    expect(sanitizedDrop.input).toBeUndefined()
    expect(sanitizedDrop.lines).toEqual(['a'])
    expect(sanitizedDrop.patchStartLineNumber).toBe(1)

    const sanitizedNoLines = __writerTestOnly.sanitizeAppToolEventData({
      data: { lines: [' ', '\t'] },
      maxStringBytes: 20,
      maxLineBytes: 20,
      maxLines: 5,
      dropInput: false,
    })
    expect(sanitizedNoLines.lines).toBeUndefined()

    const sanitizedKeep = __writerTestOnly.sanitizeAppToolEventData({
      data: {
        input: { keep: 'value' },
        patchStartLineNumber: 9.8,
      },
      maxStringBytes: 20,
      maxLineBytes: 20,
      maxLines: 5,
      dropInput: false,
    })
    expect(sanitizedKeep.input).toEqual({ keep: 'value' })
    expect(sanitizedKeep.patchStartLineNumber).toBe(9)

    const essentialDefault = __writerTestOnly.buildEssentialAppToolEventData({}, 30)
    expect(essentialDefault.phase).toBe('update')
    expect(essentialDefault.summary).toBeUndefined()

    const essentialEndError = __writerTestOnly.buildEssentialAppToolEventData(
      { phase: 'end', status: 'error' },
      30,
    )
    expect(essentialEndError.summary).toBe('Tool failed')
    expect(
      __writerTestOnly.buildEssentialAppToolEventData({ phase: 'start', summary: 1 as any }, 30).summary,
    ).toBe('Tool running')
    expect(
      __writerTestOnly.buildEssentialAppToolEventData({ phase: 'end', status: 'completed', summary: null as any }, 30).summary,
    ).toBe('Tool completed')

    expect(
      __writerTestOnly.buildAppToolEventTrimCandidates({
        record: { type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'app_tool_event', data: null as any },
        maxLineBytes: 200,
      }),
    ).toEqual([])
    expect(
      __writerTestOnly.buildAppToolEventTrimCandidates({
        record: {
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          name: 'app_tool_event',
          data: { toolName: 'Read', summary: 'x'.repeat(1000) },
        },
        maxLineBytes: 120,
      }).length,
    ).toBe(3)
  })

  it('covers encodeRecord branches and defaults', () => {
    expect(getDefaultMaxLineBytes()).toBeGreaterThan(0)

    const small = __writerTestOnly.encodeRecord(
      {
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        name: 'small',
        data: { ok: true },
      },
      4096,
    )
    expect(small.truncated).toBe(false)

    const largeUi = __writerTestOnly.encodeRecord(
      {
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        msg: { id: 'u1', role: 'user', content: 'x'.repeat(5000), timestamp: new Date().toISOString() },
      } as any,
      500,
    )
    expect(largeUi.truncated).toBe(true)
    const largeUiStillLarge = __writerTestOnly.encodeRecord(
      {
        type: 'ui_msg',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        msg: {
          id: 'u2',
          role: 'tool',
          content: 'ok',
          timestamp: new Date().toISOString(),
          toolInfo: {
            name: 'Edit',
            status: 'completed',
            result: 'ok',
            nestedTools: Array.from({ length: 2000 }, (_, i) => ({ id: `n-${i}`, name: 'n' })),
          },
        },
      } as any,
      500,
    )
    expect(largeUiStillLarge.truncated).toBe(true)

    const largeHistory = __writerTestOnly.encodeRecord(
      {
        type: 'history_state',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        seq: 1,
        messages: Array.from({ length: 30 }, () => ({
          role: 'user',
          content: [{ type: 'text', text: 'y'.repeat(500) }],
        })),
      } as any,
      800,
    )
    expect(largeHistory.truncated).toBe(true)

    const largeToolEvent = __writerTestOnly.encodeRecord(
      {
        type: 'event',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        name: 'app_tool_event',
        data: {
          toolName: 'Edit',
          toolUseId: 'u1',
          summary: 's'.repeat(5000),
          line: 'line'.repeat(2000),
          input: { command: 'x'.repeat(5000) },
          lines: Array.from({ length: 100 }, () => 'l'.repeat(500)),
        },
      },
      800,
    )
    expect(largeToolEvent.truncated).toBe(true)

    const smallHistory = __writerTestOnly.encodeRecord(
      {
        type: 'history_state',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        seq: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ok' }] }],
      } as any,
      4096,
    )
    expect(smallHistory.truncated).toBe(false)
    const largeNoTextHistory = __writerTestOnly.encodeRecord(
      {
        type: 'history_state',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        seq: 2,
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'image',
                source: 'x'.repeat(5000),
              },
            ],
          },
        ],
      } as any,
      600,
    )
    expect(largeNoTextHistory.truncated).toBe(true)

    const fallback = __writerTestOnly.encodeRecord(
      {
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 's1',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: 'z'.repeat(5000),
        provider: 'anthropic',
      } as any,
      120,
    )
    expect(fallback.truncated).toBe(true)
    expect(fallback.line).toContain('"name":"line_truncated"')
  })

  it('covers SessionWriter queue/drain/openExisting branches', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-writer-cwd-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-writer-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const missingCwd = path.join(cwd, 'missing-dir')
    const chmodSpy = vi.spyOn(fs, 'chmod')
    chmodSpy.mockRejectedValueOnce(new Error('chmod-fail-create'))
    const { writer, filePath } = await SessionWriter.createNew({
      cwd: missingCwd,
      env,
      sessionId: 'session_1',
      startedAt: new Date('2026-02-02T00:00:00.000Z'),
    })
    expect(filePath).toContain('session_1')
    expect(writer.getDroppedCount()).toBe(0)
    const gitRepoForCreate = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-writer-create-git-'))
    expect(spawnSync('git', ['init'], { cwd: gitRepoForCreate }).status).toBe(0)
    await fs.writeFile(path.join(gitRepoForCreate, 'seed.txt'), 'seed', 'utf8')
    expect(spawnSync('git', ['add', 'seed.txt'], { cwd: gitRepoForCreate }).status).toBe(0)
    expect(
      spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'seed'], {
        cwd: gitRepoForCreate,
      }).status,
    ).toBe(0)
    const createdInGit = await SessionWriter.createNew({ cwd: gitRepoForCreate, env, sessionId: 'session_3' })
    await createdInGit.writer.shutdown()

    chmodSpy.mockRejectedValueOnce(new Error('chmod-fail-open'))
    const opened = await SessionWriter.openExisting({ filePath })
    await opened.appendEvent('evt-no-data')
    await opened.flush()
    await opened.shutdown()

    const anyWriter = writer as any
    anyWriter.closed = true
    await writer.enqueue({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'ignored' } as any)

    anyWriter.closed = false
    anyWriter.queue = Array.from({ length: 1001 }, () => ({
      record: { type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'queued' },
      resolve: () => undefined,
    }))
    await writer.enqueue({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'drop-me' } as any)
    expect(writer.getDroppedCount()).toBeGreaterThan(0)

    anyWriter.draining = Promise.resolve()
    await anyWriter.drain()
    anyWriter.draining = null

    await writer.appendStableMsg({
      id: 'tool-running',
      role: 'tool',
      content: 'running',
      timestamp: new Date(),
      toolInfo: { name: 'Read', status: 'running' },
    } as any)
    await writer.appendHistorySnapshot([{ role: 'assistant', content: [{ type: 'thinking', text: 'skip' }] }] as any)
    await writer.appendEvent('evt-with-data', { ok: true })
    await writer.appendEvent('evt-no-data-2')
    const anyHandle = (writer as any).handle
    const closeSpy = vi.spyOn(anyHandle, 'close').mockRejectedValueOnce(new Error('close-fail'))
    await writer.shutdown()
    closeSpy.mockRestore()
    chmodSpy.mockRestore()

    const { writer: fresh } = await SessionWriter.createNew({
      cwd,
      env,
      sessionId: 'session_2',
      startedAt: '2026-02-02T00:00:00.000Z',
    })
    await (fresh as any).drain()
    await fresh.shutdown()
  })
})
