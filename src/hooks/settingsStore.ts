import type { FileStore } from '../adapters/fs/fileStore.js'
import { getProjectSettingsLocalPath, getProjectSettingsPath, getUserSettingsPath } from '../adapters/permissions/permissionsStore.js'
import type { Platform } from '../adapters/fs/configPaths.js'
import type { HookEventName, HookSource } from './types.js'

function tryParseJsonRecord(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

async function loadSettingsRecord(args: {
  fileStore: FileStore
  filePath: string
}): Promise<Record<string, unknown> | null> {
  if (!(await args.fileStore.exists(args.filePath))) return null
  try {
    return tryParseJsonRecord(await args.fileStore.readText(args.filePath))
  } catch {
    return null
  }
}

function getOrInitHooksRoot(settings: Record<string, unknown> | null): Record<string, unknown> {
  const hooks =
    settings && typeof settings.hooks === 'object' && settings.hooks && !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : null
  return { ...(hooks ?? {}) }
}

function getOrInitEventRules(hooksRoot: Record<string, unknown>, eventName: HookEventName): any[] {
  const raw = hooksRoot[eventName]
  if (Array.isArray(raw)) return [...raw]
  return []
}

function normalizeMatcher(raw: string): string {
  return String(raw ?? '').trim()
}

function normalizeCommand(raw: string): string {
  return String(raw ?? '').trim()
}

function getSettingsPathForSource(args: {
  source: HookSource
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): string {
  if (args.source === 'projectLocal') return getProjectSettingsLocalPath(args.cwd)
  if (args.source === 'project') return getProjectSettingsPath(args.cwd)
  return getUserSettingsPath({ cwd: args.cwd, env: args.env, platform: args.platform, homedir: args.homedir })
}

function writeSettingsRecord(args: {
  existingSettings: Record<string, unknown> | null
  hooksRoot: Record<string, unknown>
}): Record<string, unknown> {
  return {
    ...(args.existingSettings ?? {}),
    version: 1,
    hooks: args.hooksRoot,
  }
}

export async function persistHookCommand(args: {
  fileStore: FileStore
  cwd: string
  source: HookSource
  eventName: HookEventName
  matcher: string
  command: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const cwd = args.cwd || process.cwd()
  const filePath = getSettingsPathForSource({ source: args.source, cwd, env: args.env, platform: args.platform, homedir: args.homedir })

  const matcher = normalizeMatcher(args.matcher)
  const command = normalizeCommand(args.command)
  if (!command) return

  const existingSettings = await loadSettingsRecord({ fileStore: args.fileStore, filePath })
  const hooksRoot = getOrInitHooksRoot(existingSettings)
  const rules = getOrInitEventRules(hooksRoot, args.eventName)

  let ruleIndex = rules.findIndex((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false
    return normalizeMatcher((r as any).matcher) === matcher
  })

  if (ruleIndex === -1) {
    rules.push({ matcher, hooks: [{ type: 'command', command }] })
    ruleIndex = rules.length - 1
  } else {
    const rule = rules[ruleIndex]
    const rawHooks = rule && typeof rule === 'object' && !Array.isArray(rule) ? (rule as any).hooks : null
    const nextHooks = Array.isArray(rawHooks) ? [...rawHooks] : []
    const exists = nextHooks.some((h) => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) return false
      if ((h as any).type !== 'command') return false
      return normalizeCommand((h as any).command) === command
    })
    if (exists) return
    nextHooks.push({ type: 'command', command })
    rules[ruleIndex] = { ...(rule as any), matcher, hooks: nextHooks }
  }

  hooksRoot[args.eventName] = rules
  const out = writeSettingsRecord({ existingSettings, hooksRoot })
  await args.fileStore.writeJsonAtomic(filePath, out, { pretty: true, trailingNewline: true })
}

export async function deleteHookCommand(args: {
  fileStore: FileStore
  cwd: string
  source: HookSource
  eventName: HookEventName
  matcher: string
  command: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<void> {
  const cwd = args.cwd || process.cwd()
  const filePath = getSettingsPathForSource({ source: args.source, cwd, env: args.env, platform: args.platform, homedir: args.homedir })
  const matcher = normalizeMatcher(args.matcher)
  const command = normalizeCommand(args.command)
  if (!command) return

  const existingSettings = await loadSettingsRecord({ fileStore: args.fileStore, filePath })
  if (!existingSettings) return

  const hooksRoot = getOrInitHooksRoot(existingSettings)
  const rules = getOrInitEventRules(hooksRoot, args.eventName)

  const nextRules: any[] = []
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      nextRules.push(rule)
      continue
    }
    if (normalizeMatcher((rule as any).matcher) !== matcher) {
      nextRules.push(rule)
      continue
    }

    const rawHooks = (rule as any).hooks
    const list = Array.isArray(rawHooks) ? rawHooks : []
    const nextHooks = list.filter((h: any) => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) return true
      if (h.type !== 'command') return true
      return normalizeCommand(h.command) !== command
    })

    if (nextHooks.length === 0) continue
    nextRules.push({ ...(rule as any), matcher, hooks: nextHooks })
  }

  if (nextRules.length === 0) delete hooksRoot[args.eventName]
  else hooksRoot[args.eventName] = nextRules

  const out = writeSettingsRecord({ existingSettings, hooksRoot })
  await args.fileStore.writeJsonAtomic(filePath, out, { pretty: true, trailingNewline: true })
}

