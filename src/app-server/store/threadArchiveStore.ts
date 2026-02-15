import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findSessionFileBySessionId,
  getArchivedSessionsRoot,
  getSessionsRoot,
  listRecentSessions,
  type SessionSummary,
} from '../../features/repl/sessionSave/index.js'

export type ThreadArchiveLocateArgs = {
  cwd: string
  sessionId: string
  archived?: boolean
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

export type ThreadArchiveListArgs = {
  cwd: string
  includeAllProjects?: boolean
  limit?: number
  archived?: boolean
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

export type ThreadArchiveMoveArgs = {
  cwd: string
  sessionId: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

export interface ThreadArchiveStore {
  locateThreadFile(args: ThreadArchiveLocateArgs): Promise<string | null>
  listThreads(args: ThreadArchiveListArgs): Promise<SessionSummary[]>
  archiveThread(args: ThreadArchiveMoveArgs): Promise<string>
  unarchiveThread(args: ThreadArchiveMoveArgs): Promise<string>
}

function isSessionFileNameForThread(fileName: string, threadId: string): boolean {
  return fileName.startsWith('session-') && fileName.endsWith(`-${threadId}.jsonl`)
}

function datePartsFromSessionFileName(fileName: string): { year: string; month: string; day: string } | null {
  const match = /^session-(\d{4})-(\d{2})-(\d{2})T/.exec(fileName)
  if (!match) return null
  const [, year, month, day] = match
  return { year, month, day }
}

function nowDateParts(): { year: string; month: string; day: string } {
  const now = new Date()
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, '0'),
    day: String(now.getDate()).padStart(2, '0'),
  }
}

async function canonicalizePath(pathToResolve: string): Promise<string> {
  return fs.realpath(pathToResolve)
}

async function ensureWithinRoot(args: { root: string; filePath: string; context: string }): Promise<void> {
  const [rootReal, fileReal] = await Promise.all([canonicalizePath(args.root), canonicalizePath(args.filePath)])
  if (!fileReal.startsWith(rootReal + path.sep) && fileReal !== rootReal) {
    throw new Error(`${args.context}: file path is outside expected root`)
  }
}

export class FileThreadArchiveStore implements ThreadArchiveStore {
  async locateThreadFile(args: ThreadArchiveLocateArgs): Promise<string | null> {
    return findSessionFileBySessionIdWithScope(args)
  }

  async listThreads(args: ThreadArchiveListArgs): Promise<SessionSummary[]> {
    return listRecentSessions({
      cwd: args.cwd,
      env: args.env,
      platform: args.platform,
      homedir: args.homedir,
      includeAllProjects: args.includeAllProjects,
      limit: args.limit,
      archived: args.archived,
    })
  }

  async archiveThread(args: ThreadArchiveMoveArgs): Promise<string> {
    const source = await findSessionFileBySessionIdWithScope({
      ...args,
      archived: false,
    })
    if (!source) throw new Error(`Thread not found: ${args.sessionId}`)

    const sourceRoot = getSessionsRoot(args)
    await ensureWithinRoot({ root: sourceRoot, filePath: source, context: 'thread/archive' })
    const sourceFileName = path.basename(source)
    if (!isSessionFileNameForThread(sourceFileName, args.sessionId)) {
      throw new Error(`thread/archive: invalid session file name for thread ${args.sessionId}`)
    }

    const archivedRoot = getArchivedSessionsRoot(args)
    await fs.mkdir(archivedRoot, { recursive: true })
    const destination = path.join(archivedRoot, sourceFileName)
    const destinationExists = await fs
      .stat(destination)
      .then(() => true)
      .catch(() => false)
    if (destinationExists) {
      throw new Error(`thread/archive: archived file already exists for thread ${args.sessionId}`)
    }
    await fs.rename(source, destination)
    return destination
  }

  async unarchiveThread(args: ThreadArchiveMoveArgs): Promise<string> {
    const source = await findSessionFileBySessionIdWithScope({
      ...args,
      archived: true,
    })
    if (!source) throw new Error(`Thread not found: ${args.sessionId}`)

    const archivedRoot = getArchivedSessionsRoot(args)
    await ensureWithinRoot({ root: archivedRoot, filePath: source, context: 'thread/unarchive' })
    const sourceFileName = path.basename(source)
    if (!isSessionFileNameForThread(sourceFileName, args.sessionId)) {
      throw new Error(`thread/unarchive: invalid session file name for thread ${args.sessionId}`)
    }

    const sessionsRoot = getSessionsRoot(args)
    const dateParts = datePartsFromSessionFileName(sourceFileName) ?? nowDateParts()
    const destinationDir = path.join(sessionsRoot, dateParts.year, dateParts.month, dateParts.day)
    await fs.mkdir(destinationDir, { recursive: true })
    const destination = path.join(destinationDir, sourceFileName)
    const destinationExists = await fs
      .stat(destination)
      .then(() => true)
      .catch(() => false)
    if (destinationExists) {
      throw new Error(`thread/unarchive: active file already exists for thread ${args.sessionId}`)
    }
    await fs.rename(source, destination)
    return destination
  }
}

async function findSessionFileBySessionIdWithScope(args: ThreadArchiveLocateArgs): Promise<string | null> {
  return findSessionFileBySessionId({
    cwd: args.cwd,
    sessionId: args.sessionId,
    env: args.env,
    platform: args.platform,
    homedir: args.homedir,
    archived: args.archived,
  })
}
