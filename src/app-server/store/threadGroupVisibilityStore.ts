import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'

type VisibilityScope = {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

type PersistedVisibilityState = {
  version: 1
  hiddenGroupCwds: string[]
  updatedAt: string
}

export interface ThreadGroupVisibilityStore {
  listHiddenGroups(args: VisibilityScope): Promise<string[]>
  markGroupHidden(args: VisibilityScope & { groupCwd: string }): Promise<string[]>
}

const PERSISTED_STATE_VERSION = 1

function emptyState(): PersistedVisibilityState {
  return {
    version: PERSISTED_STATE_VERSION,
    hiddenGroupCwds: [],
    updatedAt: new Date(0).toISOString(),
  }
}

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd)
}

function normalizeHiddenGroupCwds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const deduped = new Set<string>()
  for (const row of value) {
    if (typeof row !== 'string') continue
    const trimmed = row.trim()
    if (!trimmed) continue
    deduped.add(normalizeCwd(trimmed))
  }
  return Array.from(deduped).sort((a, b) => a.localeCompare(b))
}

function resolveVisibilityFilePath(args: VisibilityScope): string {
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir ?? os.homedir()
  const configPaths = getConfigPaths({
    cwd: args.cwd,
    env,
    platform,
    homedir,
  })
  const globalConfigDir = path.resolve(args.cwd, configPaths.globalConfigDir)
  return path.join(globalConfigDir, 'web-reference-react', 'thread-group-visibility.json')
}

async function readPersistedState(filePath: string): Promise<PersistedVisibilityState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return emptyState()
    return {
      version: PERSISTED_STATE_VERSION,
      hiddenGroupCwds: normalizeHiddenGroupCwds(parsed.hiddenGroupCwds),
      updatedAt:
        typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim()
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return emptyState()
    }
    return emptyState()
  }
}

async function writePersistedState(filePath: string, state: PersistedVisibilityState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export class FileThreadGroupVisibilityStore implements ThreadGroupVisibilityStore {
  async listHiddenGroups(args: VisibilityScope): Promise<string[]> {
    const filePath = resolveVisibilityFilePath(args)
    const state = await readPersistedState(filePath)
    return state.hiddenGroupCwds
  }

  async markGroupHidden(args: VisibilityScope & { groupCwd: string }): Promise<string[]> {
    const filePath = resolveVisibilityFilePath(args)
    const state = await readPersistedState(filePath)
    const deduped = new Set(state.hiddenGroupCwds)
    deduped.add(normalizeCwd(args.groupCwd))
    const hiddenGroupCwds = Array.from(deduped).sort((a, b) => a.localeCompare(b))
    await writePersistedState(filePath, {
      version: PERSISTED_STATE_VERSION,
      hiddenGroupCwds,
      updatedAt: new Date().toISOString(),
    })
    return hiddenGroupCwds
  }
}
