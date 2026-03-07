import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { getConfigPaths } from '../../config/configPaths'

const AUTO_MEMORY_PROJECT_SEGMENT_MAX = 200

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function hashAutoMemoryProjectPath(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 12)
}

function encodeAutoMemoryProjectSegment(projectPath: string): string {
  const sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-')
  const suffix = hashAutoMemoryProjectPath(projectPath)
  const maxBaseLength = Math.max(1, AUTO_MEMORY_PROJECT_SEGMENT_MAX - suffix.length - 1)
  const base = sanitized.slice(0, maxBaseLength)
  return `${base}-${suffix}`
}

export function buildAutoMemoryDirectoryPath(args?: {
  cwd?: string
  configDir?: string
  resolveRealPath?: (cwd: string) => string
}): string {
  const rawCwd = (args?.cwd || process.cwd()).trim() || process.cwd()
  const resolvedCwd = path.resolve(rawCwd)
  const canonicalCwd = args?.resolveRealPath
    ? safeCall(() => args.resolveRealPath!(resolvedCwd), resolvedCwd)
    : safeCall(() => fs.realpathSync.native(resolvedCwd), resolvedCwd)

  const homeDir = os.homedir()
  const defaultConfigDir = getConfigPaths({
    cwd: canonicalCwd,
    env: process.env,
    homedir: homeDir,
  }).globalConfigDir
  const configDir = (args?.configDir || defaultConfigDir).trim() || defaultConfigDir
  const projectSegment = encodeAutoMemoryProjectSegment(canonicalCwd)
  return (path.join(configDir, 'projects', projectSegment, 'memory') + path.sep).normalize('NFC')
}
