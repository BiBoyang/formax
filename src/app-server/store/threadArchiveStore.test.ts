import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    sessionsRoot: '',
    archivedRoot: '',
    findImpl: (async () => null) as (args: any) => Promise<string | null>,
    listResult: [] as any[],
    listLastArgs: null as any,
  },
}))

vi.mock('../../features/repl/sessionSave/index.js', () => ({
  findSessionFileBySessionId: (args: any) => state.findImpl(args),
  getArchivedSessionsRoot: () => state.archivedRoot,
  getSessionsRoot: () => state.sessionsRoot,
  listRecentSessions: async (args: any) => {
    state.listLastArgs = args
    return state.listResult
  },
}))

import { FileThreadArchiveStore } from './threadArchiveStore.js'

async function writeFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, 'x', 'utf8')
}

describe('FileThreadArchiveStore', () => {
  let tmpRoot = ''
  let sessionsRoot = ''
  let archivedRoot = ''
  let store: FileThreadArchiveStore

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'thread-archive-store-'))
    sessionsRoot = path.join(tmpRoot, 'sessions')
    archivedRoot = path.join(tmpRoot, 'archived')
    state.sessionsRoot = sessionsRoot
    state.archivedRoot = archivedRoot
    state.findImpl = async () => null
    state.listResult = []
    state.listLastArgs = null
    store = new FileThreadArchiveStore()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('locates and lists thread metadata through delegated session APIs', async () => {
    state.findImpl = async () => '/tmp/found.jsonl'
    state.listResult = [{ id: 's1' }]

    const located = await store.locateThreadFile({ cwd: '/repo', sessionId: 's1', archived: true })
    expect(located).toBe('/tmp/found.jsonl')

    const listed = await store.listThreads({ cwd: '/repo', includeAllProjects: true, limit: 10, archived: false })
    expect(listed).toEqual([{ id: 's1' }])
    expect(state.listLastArgs).toMatchObject({
      cwd: '/repo',
      includeAllProjects: true,
      limit: 10,
      archived: false,
    })
  })

  it('archives a thread file into archived root', async () => {
    const sessionId = 'thread-1'
    const source = path.join(sessionsRoot, '2026', '02', '27', `session-2026-02-27T10-20-30-${sessionId}.jsonl`)
    await writeFile(source)
    state.findImpl = async (args) => (args.archived ? null : source)

    const destination = await store.archiveThread({ cwd: '/repo', sessionId })
    expect(destination).toBe(path.join(archivedRoot, path.basename(source)))
    await expect(fs.stat(destination)).resolves.toBeDefined()
    await expect(fs.stat(source)).rejects.toThrow()
  })

  it('throws on archive when source is missing, invalid, outside root, or destination exists', async () => {
    const sessionId = 'thread-1'
    await expect(store.archiveThread({ cwd: '/repo', sessionId })).rejects.toThrow(`Thread not found: ${sessionId}`)

    const invalidName = path.join(sessionsRoot, 'bad-name.jsonl')
    await writeFile(invalidName)
    state.findImpl = async () => invalidName
    await expect(store.archiveThread({ cwd: '/repo', sessionId })).rejects.toThrow('thread/archive: invalid session file name')

    const outside = path.join(tmpRoot, `session-2026-02-27T10-20-30-${sessionId}.jsonl`)
    await writeFile(outside)
    state.findImpl = async () => outside
    await expect(store.archiveThread({ cwd: '/repo', sessionId })).rejects.toThrow('thread/archive: file path is outside expected root')

    const source = path.join(sessionsRoot, '2026', '02', '27', `session-2026-02-27T10-20-30-${sessionId}.jsonl`)
    const destination = path.join(archivedRoot, path.basename(source))
    await writeFile(source)
    await writeFile(destination)
    state.findImpl = async () => source
    await expect(store.archiveThread({ cwd: '/repo', sessionId })).rejects.toThrow(
      `thread/archive: archived file already exists for thread ${sessionId}`,
    )
  })

  it('unarchives a thread file into active sessions root and keeps date path', async () => {
    const sessionId = 'thread-2'
    const sourceFile = `session-2026-03-01T09-08-07-${sessionId}.jsonl`
    const source = path.join(archivedRoot, sourceFile)
    await writeFile(source)
    state.findImpl = async (args) => (args.archived ? source : null)

    const destination = await store.unarchiveThread({ cwd: '/repo', sessionId })
    expect(destination).toBe(path.join(sessionsRoot, '2026', '03', '01', sourceFile))
    await expect(fs.stat(destination)).resolves.toBeDefined()
    await expect(fs.stat(source)).rejects.toThrow()
  })

  it('uses current date fallback when session filename lacks YYYY-MM-DD prefix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'))

    const sessionId = 'thread-3'
    const sourceFile = `session-bad-date-${sessionId}.jsonl`
    const source = path.join(archivedRoot, sourceFile)
    await writeFile(source)
    state.findImpl = async () => source

    const destination = await store.unarchiveThread({ cwd: '/repo', sessionId })
    expect(destination).toBe(path.join(sessionsRoot, '2026', '04', '05', sourceFile))
  })

  it('throws on unarchive when source is missing, invalid, outside root, or destination exists', async () => {
    const sessionId = 'thread-4'
    await expect(store.unarchiveThread({ cwd: '/repo', sessionId })).rejects.toThrow(`Thread not found: ${sessionId}`)

    const invalidName = path.join(archivedRoot, 'bad-name.jsonl')
    await writeFile(invalidName)
    state.findImpl = async () => invalidName
    await expect(store.unarchiveThread({ cwd: '/repo', sessionId })).rejects.toThrow('thread/unarchive: invalid session file name')

    const outside = path.join(tmpRoot, `session-2026-02-27T10-20-30-${sessionId}.jsonl`)
    await writeFile(outside)
    state.findImpl = async () => outside
    await expect(store.unarchiveThread({ cwd: '/repo', sessionId })).rejects.toThrow(
      'thread/unarchive: file path is outside expected root',
    )

    const source = path.join(archivedRoot, `session-2026-02-27T10-20-30-${sessionId}.jsonl`)
    const destination = path.join(sessionsRoot, '2026', '02', '27', path.basename(source))
    await writeFile(source)
    await writeFile(destination)
    state.findImpl = async () => source
    await expect(store.unarchiveThread({ cwd: '/repo', sessionId })).rejects.toThrow(
      `thread/unarchive: active file already exists for thread ${sessionId}`,
    )
  })
})
