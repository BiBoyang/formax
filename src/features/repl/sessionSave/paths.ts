import os from 'node:os'
import path from 'node:path'
import { getConfigPaths } from '../../../adapters/fs/configPaths.js'

export function getSessionsRoot(args: {
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: string
  homedir?: string
}): string {
  const env = args.env ?? process.env
  const platform = args.platform ?? process.platform
  const homedir = args.homedir ?? os.homedir()
  const configPaths = getConfigPaths({ cwd: args.cwd, env, platform, homedir })
  const globalConfigDir = path.resolve(args.cwd, configPaths.globalConfigDir)
  return path.join(globalConfigDir, 'sessions')
}

export function getSessionFilePath(args: { sessionsRoot: string; now: Date; sessionId: string }): string {
  const year = String(args.now.getFullYear())
  const month = String(args.now.getMonth() + 1).padStart(2, '0')
  const day = String(args.now.getDate()).padStart(2, '0')
  const stamp = args.now.toISOString().replace(/:/g, '-').replace(/\..+$/, 'Z')
  return path.join(args.sessionsRoot, year, month, day, `session-${stamp}-${args.sessionId}.jsonl`)
}

