import os from 'node:os'
import path from 'node:path'
import { getConfigPaths } from '../../../adapters/fs/configPaths.js'

type SessionPathArgs = {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}

type SessionPathResolvedArgs = {
  cwd: string
  env: NodeJS.ProcessEnv
  platform: string
  homedir: string
}

function normalizeOptionalPath(inputPath: string | undefined, args: SessionPathResolvedArgs): string | null {
  const raw = String(inputPath ?? '').trim()
  if (!raw || raw === 'undefined' || raw === 'null') return null
  if (raw === '~') return args.homedir
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(args.homedir, raw.slice(2))
  return path.resolve(args.cwd, raw)
}

function resolveSessionPathArgs(args: SessionPathArgs): SessionPathResolvedArgs {
  return {
    cwd: args.cwd,
    env: args.env ?? process.env,
    platform: args.platform ?? process.platform,
    homedir: args.homedir ?? os.homedir(),
  }
}

function resolveSessionConfigRoot(args: SessionPathResolvedArgs): string {
  const explicitConfigDir = normalizeOptionalPath(args.env.FORMAX_CONFIG_DIR, args)
  if (explicitConfigDir) {
    const configPaths = getConfigPaths(args)
    return path.resolve(args.cwd, configPaths.globalConfigDir)
  }

  const vitestSessionConfigDir = normalizeOptionalPath(args.env.FORMAX_VITEST_SESSION_CONFIG_DIR, args)
  if (vitestSessionConfigDir) {
    return vitestSessionConfigDir
  }

  const configPaths = getConfigPaths(args)
  return path.resolve(args.cwd, configPaths.globalConfigDir)
}

export function getSessionsRoot(args: SessionPathArgs): string {
  const resolvedArgs = resolveSessionPathArgs(args)
  return path.join(resolveSessionConfigRoot(resolvedArgs), 'sessions')
}

export function getArchivedSessionsRoot(args: SessionPathArgs): string {
  const resolvedArgs = resolveSessionPathArgs(args)
  return path.join(resolveSessionConfigRoot(resolvedArgs), 'archived_sessions')
}

export function getSessionFilePath(args: { sessionsRoot: string; now: Date; sessionId: string }): string {
  const year = String(args.now.getFullYear())
  const month = String(args.now.getMonth() + 1).padStart(2, '0')
  const day = String(args.now.getDate()).padStart(2, '0')
  const stamp = args.now.toISOString().replace(/:/g, '-').replace(/\..+$/, 'Z')
  return path.join(args.sessionsRoot, year, month, day, `session-${stamp}-${args.sessionId}.jsonl`)
}
