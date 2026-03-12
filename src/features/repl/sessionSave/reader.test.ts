import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getArchivedSessionsRoot, getSessionFilePath, getSessionsRoot } from './paths'
import {
  __readerTestOnly,
  findLatestSessionFile,
  findSessionFileBySessionId,
  listRecentSessions,
  readSessionFile,
  readSessionSummary,
  readSessionPreview,
} from './reader'
import type { Msg } from './types'

describe('sessionSave/reader helpers', () => {
  it('covers primitive helper branches', () => {
    expect(__readerTestOnly.isObject(null)).toBe(false)
    expect(__readerTestOnly.isObject({ ok: true })).toBe(true)
    expect(__readerTestOnly.isNonEmptyRecord({})).toBe(false)
    expect(__readerTestOnly.isNonEmptyRecord({ x: 1 })).toBe(true)
    expect(__readerTestOnly.coerceNonEmptyString('  hi  ')).toBe('hi')
    expect(__readerTestOnly.coerceNonEmptyString('   ')).toBeNull()
    expect(__readerTestOnly.coerceNonEmptyString(1 as any)).toBeNull()
  })

  it('covers persisted tool display normalization branches', () => {
    expect(
      __readerTestOnly.detailLinesFromPersistedTool({
        summary: 'done',
        detailLines: ['done', 'line-2'],
      }),
    ).toEqual(['line-2'])
    expect(
      __readerTestOnly.detailLinesFromPersistedTool({
        summary: 'done',
        detailLines: [],
      }),
    ).toEqual([])

    expect(__readerTestOnly.isSearchLikeToolName('Glob')).toBe(true)
    expect(__readerTestOnly.isSearchLikeToolName('Read')).toBe(false)
    expect(__readerTestOnly.hasCompactReadSummary('Read 20 lines')).toBe(true)
    expect(__readerTestOnly.hasCompactReadSummary('Read lines')).toBe(false)
    expect(__readerTestOnly.hasCompactSearchSummary({ toolName: 'Glob', summary: 'Found 2 files' })).toBe(true)
    expect(__readerTestOnly.hasCompactSearchSummary({ toolName: 'Grep', summary: 'Found 3 matches' })).toBe(true)
    expect(__readerTestOnly.hasCompactSearchSummary({ toolName: 'Search', summary: 'Found 5 files' })).toBe(true)
    expect(__readerTestOnly.hasCompactSearchSummary({ toolName: 'Read', summary: 'Found 5 files' })).toBe(false)

    const running = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Bash',
      status: 'running',
      summary: 'running',
      detailLines: ['running', 'line'],
    })
    expect(running.middleLines).toEqual(['line'])

    const compactRead = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Read',
      status: 'completed',
      summary: 'Read 10 lines',
      detailLines: ['Read 10 lines', 'a', 'b'],
    })
    expect(compactRead.middleLines).toEqual([])

    const nonSearch = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Edit',
      status: 'completed',
      summary: 'Edited file',
      detailLines: ['Edited file', 'patch'],
    })
    expect(nonSearch.middleLines).toEqual(['patch'])

    const nonCompactSearch = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Grep',
      status: 'completed',
      summary: '/tmp/a.ts:1:hello',
      detailLines: ['/tmp/a.ts:1:hello', '/tmp/b.ts:2:world'],
    })
    expect(Array.isArray(nonCompactSearch.middleLines)).toBe(true)
    expect(nonCompactSearch.rawResult).toContain('/tmp/a.ts')

    const compactSearch = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Search',
      status: 'completed',
      summary: 'Found 2 files',
      detailLines: ['Found 2 files', '/tmp/a.ts', '/tmp/b.ts'],
    })
    expect(compactSearch.summary).toBe('Found 2 files')
    expect(compactSearch.middleLines).toEqual([])

    const fallbackFormatted = __readerTestOnly.normalizePersistedToolDisplay({
      toolName: 'Search',
      status: 'completed',
      summary: 'fallback-summary',
      detailLines: [],
    })
    expect(fallbackFormatted.summary).toBe('Found 1 files')
    expect(fallbackFormatted.middleLines).toEqual([])
  })

  it('covers message merge/revive helpers', () => {
    const fallbackTs = new Date('2026-02-02T00:00:00.000Z')
    const msg = __readerTestOnly.toToolMsgFromPersisted({
      tool: {
        id: 'tool-x',
        occurredAtMs: 0,
        sequence: 0,
        toolUseId: 'u1',
        toolName: 'Edit',
        status: 'completed',
        summary: 'done',
        input: { a: 1 },
        patchStartLineNumber: 8,
        detailLines: ['done'],
      },
      fallbackTimestamp: fallbackTs,
    })
    expect(msg.timestamp.toISOString()).toBe(fallbackTs.toISOString())
    expect(msg.toolInfo?.patchStartLineNumber).toBe(8)
    const msgNoOptional = __readerTestOnly.toToolMsgFromPersisted({
      tool: {
        id: 'tool-empty',
        occurredAtMs: fallbackTs.getTime(),
        sequence: 1,
        toolName: 'Bash',
        status: 'completed',
        summary: '',
        detailLines: [],
      },
      fallbackTimestamp: fallbackTs,
    })
    expect(msgNoOptional.toolInfo?.toolUseId).toBeUndefined()
    expect(msgNoOptional.toolInfo?.result).toBeUndefined()

    const revived = __readerTestOnly.reviveMsg({ ...(msg as Msg), timestamp: 'bad' as any }, '2026-02-02T01:00:00.000Z')
    expect(revived.timestamp.toISOString()).toBe('2026-02-02T01:00:00.000Z')
    const revivedEpoch = __readerTestOnly.reviveMsg({ ...(msg as Msg), timestamp: 'bad' as any }, 'bad')
    expect(revivedEpoch.timestamp.getTime()).toBe(0)
    const revivedFromRow = __readerTestOnly.reviveMsg({ ...(msg as Msg), timestamp: '2026-02-02T02:00:00.000Z' as any })
    expect(revivedFromRow.timestamp.toISOString()).toBe('2026-02-02T02:00:00.000Z')

    const merged = __readerTestOnly.mergeLegacyToolFieldsIntoPersisted({
      persisted: {
        ...msg,
        content: '',
        toolInfo: { ...msg.toolInfo!, input: {}, result: '', patchStartLineNumber: 0 },
      } as Msg,
      legacy: {
        ...msg,
        id: 'legacy',
        content: 'legacy content',
        toolInfo: {
          ...msg.toolInfo!,
          input: { file_path: 'demo.txt' },
          result: 'legacy result',
          middleLines: ['legacy line'],
          patchStartLineNumber: 10,
        },
      } as Msg,
    })
    expect(merged.content).toBe('legacy content')
    expect(merged.toolInfo?.input).toEqual({ file_path: 'demo.txt' })
    expect(merged.toolInfo?.result).toBe('legacy result')
    expect(merged.toolInfo?.patchStartLineNumber).toBe(10)

    const mergedPersistedWins = __readerTestOnly.mergeLegacyToolFieldsIntoPersisted({
      persisted: {
        ...msg,
        content: 'persisted content',
        toolInfo: {
          ...msg.toolInfo!,
          input: { persisted: true },
          result: 'persisted result',
          middleLines: ['persisted line'],
          patchStartLineNumber: 7,
        },
      } as Msg,
      legacy: {
        ...msg,
        content: 'legacy content 2',
        toolInfo: {
          ...msg.toolInfo!,
          input: { legacy: true },
          result: 'legacy result 2',
          middleLines: ['legacy line 2'],
          patchStartLineNumber: 3,
        },
      } as Msg,
    })
    expect(mergedPersistedWins.content).toBe('persisted content')
    expect(mergedPersistedWins.toolInfo?.input).toEqual({ persisted: true })
    expect(mergedPersistedWins.toolInfo?.result).toBe('persisted result')
    expect(mergedPersistedWins.toolInfo?.middleLines).toEqual(['persisted line'])
    expect(mergedPersistedWins.toolInfo?.patchStartLineNumber).toBe(7)

    const mergedUndefined = __readerTestOnly.mergeLegacyToolFieldsIntoPersisted({
      persisted: {
        ...msg,
        content: undefined as any,
        toolInfo: { ...msg.toolInfo!, input: undefined, result: undefined, middleLines: undefined },
      } as Msg,
      legacy: {
        ...msg,
        content: undefined as any,
        toolInfo: { ...msg.toolInfo!, input: undefined, result: undefined, middleLines: undefined },
      } as Msg,
    })
    expect(mergedUndefined.toolInfo?.input).toBeUndefined()
    expect(mergedUndefined.content).toBeUndefined()
  })

  it('covers metadata/tail/preview helpers', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-helper-'))
    const noMetaFile = path.join(tmp, 'no-meta.jsonl')
    await fs.writeFile(noMetaFile, '{"type":"event","name":"x"}\n', 'utf8')
    await expect(__readerTestOnly.readSessionMetaOnly(noMetaFile)).rejects.toThrow('missing session_meta')

    const sessionFile = path.join(tmp, 'session.jsonl')
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          sessionId: 's1',
          startedAt: '2026-02-02T00:00:00.000Z',
          cwd: tmp,
          provider: 'anthropic',
        }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:01.000Z', name: 'session_rename', data: { label: 'L' } }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:02.000Z',
          name: 'app_turn_started',
          data: { cwd: path.join(tmp, 'nested') },
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:03.000Z',
          name: 'ui_stats',
          data: { uiMsgCount: 3, firstUserPrompt: 'first' },
        }),
        JSON.stringify({
          type: 'ui_msg',
          v: 1,
          ts: '2026-02-02T00:00:04.000Z',
          msg: { id: 'u1', role: 'user', content: 'hello   world' },
        }),
        JSON.stringify({
          type: 'ui_msg',
          v: 1,
          ts: '2026-02-02T00:00:04.500Z',
          msg: { id: 'skip-1', role: 'system', content: 'skip-role' },
        }),
        '{"type":"ui_msg",',
        JSON.stringify({ type: 'ui_msg', v: 1, ts: '2026-02-02T00:00:04.800Z', msg: { id: 'skip-2', role: 'user', content: 1 } }),
        JSON.stringify({
          type: 'ui_msg',
          v: 1,
          ts: '2026-02-02T00:00:05.000Z',
          msg: { id: 'a1', role: 'assistant', content: 'a'.repeat(300) },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const tail = await __readerTestOnly.readTailText(sessionFile, 128)
    expect(typeof tail).toBe('string')
    const summary = await __readerTestOnly.readTailSummaryData(sessionFile)
    expect(summary.messageCount).toBe(3)
    expect(summary.lastUserPrompt).toBe('first')
    expect(summary.label).toBe('L')
    expect(summary.latestTurnCwd).toContain('nested')

    expect(__readerTestOnly.coerceString('  x  ')).toBe('x')
    expect(__readerTestOnly.coerceString('   ')).toBeNull()
    expect(__readerTestOnly.coerceNumber(3)).toBe(3)
    expect(__readerTestOnly.coerceNumber(NaN)).toBeNull()
    expect(__readerTestOnly.toSingleLinePreview('  ', 10)).toBe('')
    expect(__readerTestOnly.toSingleLinePreview('abc', 5)).toBe('abc')
    expect(__readerTestOnly.toSingleLinePreview('abc def ghi', 6)).toBe('abc d…')

    const preview = await readSessionPreview(sessionFile, { maxMessages: 2, maxCharsPerMessage: 10 })
    expect(preview).toHaveLength(2)
    expect(preview[0]?.role).toBe('user')
    expect(preview[1]?.text.endsWith('…')).toBe(true)
  })

  it('covers candidate collection and session listing/search branches', async () => {
    const cwdA = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-cwd-a-'))
    const cwdB = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-cwd-b-'))
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-config-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: configDir }

    const sessionsRoot = getSessionsRoot({ cwd: cwdA, env })
    const archivedRoot = getArchivedSessionsRoot({ cwd: cwdA, env })
    const nowA = new Date('2026-02-03T00:00:00.000Z')
    const nowB = new Date('2026-02-04T00:00:00.000Z')
    const nowArchived = new Date('2026-02-05T00:00:00.000Z')

    const activeAPath = getSessionFilePath({ sessionsRoot, now: nowA, sessionId: 'sid-a' })
    const activeBPath = getSessionFilePath({ sessionsRoot, now: nowB, sessionId: 'sid-b' })
    const archivedPath = getSessionFilePath({ sessionsRoot: archivedRoot, now: nowArchived, sessionId: 'sid-archived' })
    await fs.mkdir(path.dirname(activeAPath), { recursive: true })
    await fs.mkdir(path.dirname(activeBPath), { recursive: true })
    await fs.mkdir(path.dirname(archivedPath), { recursive: true })

    const writeSession = async (filePath: string, sessionId: string, cwd: string, cwdReal?: string) => {
      await fs.writeFile(
        filePath,
        [
          JSON.stringify({
            type: 'session_meta',
            v: 1,
            ts: '2026-02-02T00:00:00.000Z',
            sessionId,
            startedAt: '2026-02-02T00:00:00.000Z',
            cwd,
            ...(cwdReal ? { cwdReal } : {}),
            provider: 'anthropic',
          }),
          JSON.stringify({
            type: 'event',
            v: 1,
            ts: '2026-02-02T00:00:01.000Z',
            name: 'ui_stats',
            data: { uiMsgCount: 1, firstUserPrompt: `${sessionId}-prompt` },
          }),
        ].join('\n') + '\n',
        'utf8',
      )
    }

    await writeSession(activeAPath, 'sid-a', cwdA, await fs.realpath(cwdA).catch(() => undefined))
    await writeSession(activeBPath, 'sid-b', cwdB)
    await writeSession(archivedPath, 'sid-archived', cwdA)
    const brokenPath = getSessionFilePath({ sessionsRoot, now: new Date('2026-02-06T00:00:00.000Z'), sessionId: 'sid-bad' })
    await fs.mkdir(path.dirname(brokenPath), { recursive: true })
    await fs.writeFile(brokenPath, '{"type":"session_meta",', 'utf8')

    await fs.writeFile(path.join(archivedRoot, 'top-level.jsonl'), 'not-json\n', 'utf8')

    const archivedCandidates = await __readerTestOnly.collectSessionCandidates({ root: archivedRoot, archived: true })
    const activeCandidates = await __readerTestOnly.collectSessionCandidates({ root: sessionsRoot, archived: false })
    expect(archivedCandidates.length).toBeGreaterThan(0)
    expect(activeCandidates.length).toBeGreaterThan(0)

    const latestForA = await findLatestSessionFile({ cwd: cwdA, env })
    expect(latestForA).toBe(activeAPath)
    const latestArchivedForA = await findLatestSessionFile({ cwd: cwdA, env, archived: true })
    expect(latestArchivedForA).toBe(archivedPath)

    const byId = await findSessionFileBySessionId({ cwd: cwdA, env, sessionId: 'sid-b' })
    expect(byId).toBe(activeBPath)
    const byIdMissing = await findSessionFileBySessionId({ cwd: cwdA, env, sessionId: '   ' })
    expect(byIdMissing).toBeNull()
    const byIdNotFound = await findSessionFileBySessionId({ cwd: cwdA, env, sessionId: 'nope' })
    expect(byIdNotFound).toBeNull()

    const listedScoped = await listRecentSessions({ cwd: cwdA, env, includeAllProjects: false, limit: 5 })
    expect(listedScoped.some((s) => s.meta.cwd === cwdA)).toBe(true)
    expect(listedScoped.some((s) => s.meta.cwd === cwdB)).toBe(false)

    const listedAll = await listRecentSessions({ cwd: cwdA, env, includeAllProjects: true, limit: 5 })
    expect(listedAll.some((s) => s.meta.cwd === cwdB)).toBe(true)
    expect(listedAll.length).toBeLessThanOrEqual(5)

    const listedArchived = await listRecentSessions({ cwd: cwdA, env, archived: true, includeAllProjects: true })
    expect(listedArchived.some((s) => s.meta.sessionId === 'sid-archived')).toBe(true)
  })

  it('covers catch/fallback branches in reader helpers', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-catch-'))
    const missing = path.join(tmp, 'missing.jsonl')
    expect(await __readerTestOnly.readTailSummaryData(missing)).toEqual({
      messageCount: null,
      lastUserPrompt: null,
      label: null,
      latestTurnCwd: null,
    })
    expect(await readSessionPreview(missing)).toEqual([])
    await expect(readSessionPreview(path.join(tmp, 'bad-file.jsonl'))).resolves.toEqual([])

    const noMeta = path.join(tmp, 'no-meta-session.jsonl')
    await fs.writeFile(noMeta, '{"type":"event","name":"x"}\n', 'utf8')
    await expect(readSessionFile(noMeta)).rejects.toThrow('missing session_meta')

    const withUserMsg = path.join(tmp, 'with-user-msg.jsonl')
    await fs.writeFile(
      withUserMsg,
      [
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          sessionId: 'u-msg',
          startedAt: '2026-02-02T00:00:00.000Z',
          cwd: tmp,
          provider: 'anthropic',
        }),
        JSON.stringify({
          type: 'ui_msg',
          v: 1,
          ts: '2026-02-02T00:00:01.000Z',
          msg: { id: 'u1', role: 'user', content: 'hello', timestamp: '2026-02-02T00:00:01.000Z' },
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const replay = await readSessionFile(withUserMsg)
    expect(replay.messages.some((msg) => msg.role === 'user')).toBe(true)

    const badCwd = path.join(tmp, 'missing-cwd')
    expect(await findLatestSessionFile({ cwd: badCwd, env: { ...process.env, FORMAX_CONFIG_DIR: tmp } })).toBeNull()
    expect(
      await listRecentSessions({
        cwd: badCwd,
        env: { ...process.env, FORMAX_CONFIG_DIR: tmp },
        includeAllProjects: false,
        limit: 2,
      }),
    ).toEqual([])
    expect(
      await findSessionFileBySessionId({
        cwd: badCwd,
        env: { ...process.env, FORMAX_CONFIG_DIR: tmp },
        sessionId: 'x',
        archived: true,
      }),
    ).toBeNull()
  })

  it('covers collectSessionCandidates nested readdir catch paths via mocks', async () => {
    const direntDir = (name: string) =>
      ({
        name,
        isFile: () => false,
        isDirectory: () => true,
      }) as any
    const direntFile = (name: string) =>
      ({
        name,
        isFile: () => true,
        isDirectory: () => false,
      }) as any

    const readdirSpy = vi.spyOn(fs, 'readdir')
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-y')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: true })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-m')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: true })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('03')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-d')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: true })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('03')])
    readdirSpy.mockImplementationOnce(async () => [
      direntFile('ok.jsonl'),
      direntFile('skip.txt'),
      { name: 'not-file', isFile: () => false, isDirectory: () => false } as any,
    ])
    const archived = await __readerTestOnly.collectSessionCandidates({ root: '/x', archived: true })
    expect(archived).toEqual(['/x/2026/02/03/ok.jsonl'])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-y-active')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: false })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-m-active')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: false })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('03')])
    readdirSpy.mockImplementationOnce(async () => {
      throw new Error('fail-d-active')
    })
    await expect(__readerTestOnly.collectSessionCandidates({ root: '/x', archived: false })).resolves.toEqual([])

    readdirSpy.mockReset()
    readdirSpy.mockImplementationOnce(async () => [
      direntDir('2026'),
      direntFile('root-file.txt'),
      { name: 'root-other', isFile: () => false, isDirectory: () => false } as any,
    ])
    readdirSpy.mockImplementationOnce(async () => [
      direntDir('02'),
      direntFile('year-file.txt'),
      { name: 'year-other', isFile: () => false, isDirectory: () => false } as any,
    ])
    readdirSpy.mockImplementationOnce(async () => [
      direntDir('03'),
      direntFile('month-file.txt'),
      { name: 'month-other', isFile: () => false, isDirectory: () => false } as any,
    ])
    readdirSpy.mockImplementationOnce(async () => [
      direntFile('ok2.jsonl'),
      direntFile('skip2.md'),
      { name: 'day-other', isFile: () => false, isDirectory: () => false } as any,
    ])
    const active = await __readerTestOnly.collectSessionCandidates({ root: '/x', archived: false })
    expect(active).toEqual(['/x/2026/02/03/ok2.jsonl'])

    readdirSpy.mockRestore()
  })

  it('covers archived candidate filtering branches with mixed dirent shapes', async () => {
    const direntDir = (name: string) =>
      ({
        name,
        isFile: () => false,
        isDirectory: () => true,
      }) as any
    const direntFile = (name: string) =>
      ({
        name,
        isFile: () => true,
        isDirectory: () => false,
      }) as any
    const direntOther = (name: string) =>
      ({
        name,
        isFile: () => false,
        isDirectory: () => false,
      }) as any

    const readdirSpy = vi.spyOn(fs, 'readdir')
    readdirSpy.mockImplementationOnce(async () => [direntDir('2026'), direntFile('root.log'), direntOther('x')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('02'), direntFile('month.log'), direntOther('m')])
    readdirSpy.mockImplementationOnce(async () => [direntDir('03'), direntFile('day.log'), direntOther('d')])
    readdirSpy.mockImplementationOnce(async () => [direntFile('ok.jsonl'), direntFile('skip.txt'), direntOther('f')])
    const out = await __readerTestOnly.collectSessionCandidates({ root: '/mixed', archived: true })
    expect(out).toEqual(['/mixed/2026/02/03/ok.jsonl'])
    readdirSpy.mockRestore()
  })

  it('includes archived flat root .jsonl files together with dated-tree files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-flat-'))
    try {
      const flat = path.join(tmp, 'flat.jsonl')
      const datedDir = path.join(tmp, '2026', '02', '03')
      const dated = path.join(datedDir, 'nested.jsonl')
      await fs.mkdir(datedDir, { recursive: true })
      await fs.writeFile(flat, 'flat\n', 'utf8')
      await fs.writeFile(dated, 'nested\n', 'utf8')

      const candidates = await __readerTestOnly.collectSessionCandidates({ root: tmp, archived: true })
      expect(candidates).toContain(flat)
      expect(candidates).toContain(dated)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('covers remaining branch edges in reader helpers', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-edges-'))

    expect(
      __readerTestOnly.normalizePersistedToolDisplay({
        toolName: 'Search',
        status: 'error',
        summary: '',
        detailLines: [],
      }).summary,
    ).toBe('Error: (no output)')

    const nonToolMerged = __readerTestOnly.mergeLegacyToolFieldsIntoPersisted({
      persisted: { id: 'p1', role: 'assistant', content: 'x', timestamp: new Date() } as any,
      legacy: { id: 'l1', role: 'tool', content: 'y', timestamp: new Date() } as any,
    })
    expect(nonToolMerged.role).toBe('assistant')
    const missingInfoMerged = __readerTestOnly.mergeLegacyToolFieldsIntoPersisted({
      persisted: { id: 'p2', role: 'tool', content: 'x', timestamp: new Date() } as any,
      legacy: { id: 'l2', role: 'tool', content: 'y', timestamp: new Date() } as any,
    })
    expect(missingInfoMerged.id).toBe('p2')

    const invalidMetaOnly = path.join(tmp, 'invalid-meta-only.jsonl')
    await fs.writeFile(invalidMetaOnly, '\n42\n', 'utf8')
    await expect(__readerTestOnly.readSessionMetaOnly(invalidMetaOnly)).rejects.toThrow('missing session_meta')

    const emptyFile = path.join(tmp, 'empty.jsonl')
    await fs.writeFile(emptyFile, '', 'utf8')
    expect(await __readerTestOnly.readTailText(emptyFile, 100)).toBe('')

    const mixedPreview = path.join(tmp, 'mixed-preview.jsonl')
    await fs.writeFile(
      mixedPreview,
      [
        '1',
        JSON.stringify({ type: 'session_meta', v: 1, ts: '2026-02-02T00:00:00.000Z', sessionId: 'm1', startedAt: '2026-02-02T00:00:00.000Z', cwd: tmp, provider: 'anthropic' }),
        JSON.stringify({ type: 'ui_msg', v: 1, ts: '2026-02-02T00:00:01.000Z', msg: null }),
        JSON.stringify({ type: 'ui_msg', v: 1, ts: '2026-02-02T00:00:02.000Z', msg: { id: 'x', role: 'user', content: '' } }),
        JSON.stringify({ type: 'ui_msg', v: 1, ts: '2026-02-02T00:00:03.000Z', msg: { id: 'y', role: 'assistant', content: 'ok' } }),
      ].join('\n') + '\n',
      'utf8',
    )
    const preview = await readSessionPreview(mixedPreview, { maxMessages: 3 })
    expect(preview).toEqual([{ role: 'assistant', text: 'ok' }])

    const malformedReplay = path.join(tmp, 'malformed-replay.jsonl')
    await fs.writeFile(
      malformedReplay,
      [
        '',
        '1',
        JSON.stringify({ type: 'session_meta', v: 1, ts: '2026-02-02T00:00:00.000Z', sessionId: 'r1', startedAt: '2026-02-02T00:00:00.000Z', cwd: tmp, provider: 'anthropic' }),
        JSON.stringify({ type: 'ui_msg', v: 1, ts: '2026-02-02T00:00:01.000Z', msg: {} }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:02.000Z', name: 'not_app_tool_event', data: {} }),
      ].join('\n') + '\n',
      'utf8',
    )
    const replay = await readSessionFile(malformedReplay)
    expect(replay.messages).toEqual([])

    const unknownTypeReplay = path.join(tmp, 'unknown-type.jsonl')
    await fs.writeFile(
      unknownTypeReplay,
      [
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          sessionId: 'unknown-type',
          startedAt: '2026-02-02T00:00:00.000Z',
          cwd: tmp,
          provider: 'anthropic',
        }),
        JSON.stringify({ type: 'mystery_record', v: 1, ts: '2026-02-02T00:00:01.000Z' }),
      ].join('\n') + '\n',
      'utf8',
    )
    const unknownReplay = await readSessionFile(unknownTypeReplay)
    expect(unknownReplay.meta.sessionId).toBe('unknown-type')

    const duplicatedTool = path.join(tmp, 'dup-tool.jsonl')
    await fs.writeFile(
      duplicatedTool,
      [
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          sessionId: 'dup-tool',
          startedAt: '2026-02-02T00:00:00.000Z',
          cwd: tmp,
          provider: 'anthropic',
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:01.000Z',
          name: 'app_tool_event',
          data: { toolUseId: 'dup-1', toolName: 'Read', phase: 'end', status: 'completed', summary: 'done' },
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:01.500Z',
          name: 'app_tool_event',
          data: { toolName: 'Read', phase: 'start', status: 'running', summary: 'running' },
        }),
        JSON.stringify({
          type: 'ui_msg',
          v: 1,
          ts: '2026-02-02T00:00:02.000Z',
          msg: {
            id: 'tool-dup-1',
            role: 'tool',
            content: 'ui row',
            timestamp: '2026-02-02T00:00:02.000Z',
            toolInfo: { name: 'Read', status: 'completed' },
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const replayDup = await readSessionFile(duplicatedTool)
    expect(replayDup.messages.some((msg) => msg.id === 'tool-dup-1')).toBe(true)
    const replayEventOnly = await readSessionFile(
      await (async () => {
        const p = path.join(tmp, 'event-only.jsonl')
        await fs.writeFile(
          p,
          [
            JSON.stringify({
              type: 'session_meta',
              v: 1,
              ts: '2026-02-02T00:00:00.000Z',
              sessionId: 'event-only',
              startedAt: '2026-02-02T00:00:00.000Z',
              cwd: tmp,
              provider: 'anthropic',
            }),
            JSON.stringify({
              type: 'event',
              v: 1,
              ts: '2026-02-02T00:00:01.000Z',
              name: 'app_tool_event',
              data: { toolUseId: 'evt-only-1', toolName: 'Read', phase: 'end', status: 'completed', summary: 'done' },
            }),
          ].join('\n') + '\n',
          'utf8',
        )
        return p
      })(),
    )
    expect(replayEventOnly.messages.some((msg) => msg.role === 'tool')).toBe(true)

    const summaryBreak = path.join(tmp, 'summary-break.jsonl')
    await fs.writeFile(
      summaryBreak,
      [
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          name: 'ui_stats',
          data: { uiMsgCount: 8, lastUserPrompt: 'fallback-title' },
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:01.000Z',
          name: 'session_rename',
          data: { label: 'L1' },
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:02.000Z',
          name: 'app_turn_started',
          data: { cwd: '/definitely/not/exist' },
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:03.000Z',
          name: 'ui_stats',
          data: { uiMsgCount: 9, firstUserPrompt: 'preferred-title' },
        }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:04.000Z', name: '  ', data: {} }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:05.000Z', name: 'ui_stats', data: 1 }),
        '1',
      ].join('\n') + '\n',
      'utf8',
    )
    const summaryData = await __readerTestOnly.readTailSummaryData(summaryBreak)
    expect(summaryData.messageCount).toBe(9)
    expect(summaryData.lastUserPrompt).toBe('preferred-title')
    expect(summaryData.label).toBe('L1')
    expect(summaryData.latestTurnCwd).toBe('/definitely/not/exist')

    const uiStatsNoBreakFile = path.join(tmp, 'summary-ui-no-break.jsonl')
    await fs.writeFile(
      uiStatsNoBreakFile,
      [
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'session_rename', data: { label: 'R' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:01.000Z', name: 'app_turn_started', data: { cwd: tmp } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:02.000Z', name: 'ui_stats', data: { uiMsgCount: 2, firstUserPrompt: 'first' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:03.000Z', name: 'ui_stats', data: { uiMsgCount: 3, lastUserPrompt: 'second' } }),
      ].join('\n') + '\n',
      'utf8',
    )
    const uiStatsNoBreak = await __readerTestOnly.readTailSummaryData(uiStatsNoBreakFile)
    expect(uiStatsNoBreak.messageCount).toBe(3)
    expect(uiStatsNoBreak.lastUserPrompt).toBe('second')

    const uiStatsBreakByAllSetFile = path.join(tmp, 'summary-ui-break-allset.jsonl')
    await fs.writeFile(
      uiStatsBreakByAllSetFile,
      [
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'ui_stats', data: { uiMsgCount: 7, firstUserPrompt: 'target' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:01.000Z', name: 'session_rename', data: { label: 'L2' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:02.000Z', name: 'app_turn_started', data: { cwd: tmp } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:03.000Z', name: 'ui_stats', data: { uiMsgCount: 8 } }),
      ].join('\n') + '\n',
      'utf8',
    )
    const uiStatsBreakByAllSet = await __readerTestOnly.readTailSummaryData(uiStatsBreakByAllSetFile)
    expect(uiStatsBreakByAllSet.messageCount).toBe(8)

    const appTurnBreakFile = path.join(tmp, 'summary-app-break.jsonl')
    await fs.writeFile(
      appTurnBreakFile,
      [
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'app_turn_started', data: { cwd: tmp } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:01.000Z', name: 'session_rename', data: { label: 'R' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:02.000Z', name: 'ui_stats', data: { uiMsgCount: 1, firstUserPrompt: 'p1' } }),
      ].join('\n') + '\n',
      'utf8',
    )
    const appTurnBreak = await __readerTestOnly.readTailSummaryData(appTurnBreakFile)
    expect(appTurnBreak.latestTurnCwd).toBe(tmp)
    expect(appTurnBreak.label).toBe('R')

    const uiStatsBreakFile = path.join(tmp, 'summary-ui-break.jsonl')
    await fs.writeFile(
      uiStatsBreakFile,
      [
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:00.000Z', name: 'ui_stats', data: { uiMsgCount: 3, firstUserPrompt: 'first' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:01.000Z', name: 'session_rename', data: { label: 'L' } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:02.000Z', name: 'app_turn_started', data: { cwd: tmp } }),
        JSON.stringify({ type: 'event', v: 1, ts: '2026-02-02T00:00:03.000Z', name: 'ui_stats', data: { uiMsgCount: 4, lastUserPrompt: 'second' } }),
      ].join('\n') + '\n',
      'utf8',
    )
    const uiStatsBreak = await __readerTestOnly.readTailSummaryData(uiStatsBreakFile)
    expect(uiStatsBreak.messageCount).toBe(4)
    expect(uiStatsBreak.lastUserPrompt).toBe('second')

    const summaryReadPath = path.join(tmp, 'summary-read.jsonl')
    await fs.writeFile(
      summaryReadPath,
      [
        JSON.stringify({
          type: 'session_meta',
          v: 1,
          ts: '2026-02-02T00:00:00.000Z',
          sessionId: 'summary-read',
          startedAt: '2026-02-02T00:00:00.000Z',
          cwd: tmp,
          cwdReal: '/old/real/path',
          provider: 'anthropic',
        }),
        JSON.stringify({
          type: 'event',
          v: 1,
          ts: '2026-02-02T00:00:01.000Z',
          name: 'app_turn_started',
          data: { cwd: '/definitely/not/exist' },
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const summaryFromFile = await readSessionSummary(summaryReadPath)
    expect(summaryFromFile.meta.cwd).toBe('/definitely/not/exist')
    expect(summaryFromFile.meta.cwdReal).toBeUndefined()

    expect(__readerTestOnly.coerceString(1)).toBeNull()

    const listRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-list-'))
    const env = { ...process.env, FORMAX_CONFIG_DIR: listRoot }
    const cwdForList = await fs.mkdtemp(path.join(os.tmpdir(), 'tmp-reader-list-cwd-'))
    const sessionsRoot = getSessionsRoot({ cwd: cwdForList, env })
    const p1 = getSessionFilePath({ sessionsRoot, now: new Date('2026-02-06T00:00:00.000Z'), sessionId: 'l1' })
    const p2 = getSessionFilePath({ sessionsRoot, now: new Date('2026-02-07T00:00:00.000Z'), sessionId: 'l2' })
    await fs.mkdir(path.dirname(p1), { recursive: true })
    await fs.mkdir(path.dirname(p2), { recursive: true })
    await fs.writeFile(
      p1,
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 'l1',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: cwdForList,
        cwdReal: '/mismatch-real',
        provider: 'anthropic',
      }) + '\n',
      'utf8',
    )
    await fs.writeFile(
      p2,
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 'l2',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: path.join(cwdForList, 'other'),
        provider: 'anthropic',
      }) + '\n',
      'utf8',
    )
    const scoped = await listRecentSessions({
      cwd: cwdForList,
      env,
      includeAllProjects: false,
      limit: 1,
    })
    expect(scoped.length).toBeLessThanOrEqual(1)

    const sameCwdNoReal = getSessionFilePath({ sessionsRoot, now: new Date('2026-02-08T00:00:00.000Z'), sessionId: 'l3' })
    await fs.mkdir(path.dirname(sameCwdNoReal), { recursive: true })
    await fs.writeFile(
      sameCwdNoReal,
      JSON.stringify({
        type: 'session_meta',
        v: 1,
        ts: '2026-02-02T00:00:00.000Z',
        sessionId: 'l3',
        startedAt: '2026-02-02T00:00:00.000Z',
        cwd: cwdForList,
        provider: 'anthropic',
      }) + '\n',
      'utf8',
    )
    const scopedNoMismatch = await listRecentSessions({
      cwd: cwdForList,
      env,
      includeAllProjects: false,
    })
    expect(scopedNoMismatch.some((s) => s.meta.sessionId === 'l3')).toBe(true)

    const limited = await listRecentSessions({
      cwd: cwdForList,
      env,
      includeAllProjects: true,
      limit: 1,
    })
    expect(limited.length).toBe(1)

    const openSpy = vi.spyOn(fs, 'open').mockResolvedValue({
      stat: vi.fn().mockResolvedValue({ size: 0 }),
      read: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('close-fail')),
    } as any)
    await expect(__readerTestOnly.readTailText(path.join(tmp, 'any.jsonl'), 64)).resolves.toBe('')
    openSpy.mockRestore()
  })
})
