import type { FileStore } from '../adapters/fs/fileStore.js'
import type { Platform } from '../adapters/fs/configPaths.js'
import { getProjectSettingsLocalPath, getProjectSettingsPath, getUserSettingsPath } from '../adapters/permissions/permissionsStore.js'
import type { HookEventName, HookRuleEntry, HookSource, MergedHooks } from './types.js'

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

function toTimeoutMs(h: any): number | null {
  const ms = typeof h?.timeoutMs === 'number' ? h.timeoutMs : null
  if (ms !== null && Number.isFinite(ms) && ms > 0) return Math.floor(ms)
  const sec = typeof h?.timeout === 'number' ? h.timeout : null
  if (sec !== null && Number.isFinite(sec) && sec > 0) return Math.floor(sec * 1000)
  return null
}

function parseRulesForEvent(args: {
  settings: Record<string, unknown>
  eventName: HookEventName
  source: HookSource
}): HookRuleEntry[] {
  const hooksRoot =
    args.settings.hooks && typeof args.settings.hooks === 'object' && !Array.isArray(args.settings.hooks)
      ? (args.settings.hooks as Record<string, unknown>)
      : null

  const rawRules = hooksRoot?.[args.eventName]
  if (!Array.isArray(rawRules)) return []

  const entries: HookRuleEntry[] = []

  for (const rule of rawRules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue
    const matcherRaw = (rule as any).matcher
    const matcher = typeof matcherRaw === 'string' ? matcherRaw.trim() : ''
    const hooks = (rule as any).hooks
    if (!Array.isArray(hooks)) continue

    for (const hook of hooks) {
      if (!hook || typeof hook !== 'object' || Array.isArray(hook)) continue
      if ((hook as any).type !== 'command') continue
      const command = typeof (hook as any).command === 'string' ? (hook as any).command.trim() : ''
      if (!command) continue
      entries.push({
        source: args.source,
        matcher,
        command,
        timeoutMs: toTimeoutMs(hook),
      })
    }
  }

  return entries
}

function dedupeByCommand(entries: HookRuleEntry[]): HookRuleEntry[] {
  const byCommand = new Map<string, HookRuleEntry>()
  const order: string[] = []

  for (const e of entries) {
    const key = e.command.trim()
    if (!key) continue

    const existing = byCommand.get(key)
    if (!existing) {
      byCommand.set(key, { ...e, command: key })
      order.push(key)
      continue
    }

    // Higher-precedence sources come first; when a higher-precedence entry omits
    // optional fields (like timeout), keep the value from the lower-precedence one.
    if (existing.timeoutMs === null && e.timeoutMs !== null) {
      existing.timeoutMs = e.timeoutMs
    }
  }

  return order.map((key) => byCommand.get(key)!).filter(Boolean)
}

export async function loadMergedHooks(args: {
  fileStore: FileStore
  cwd: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): Promise<MergedHooks> {
  const cwd = args.cwd || process.cwd()
  const filePaths = {
    projectLocal: getProjectSettingsLocalPath(cwd),
    project: getProjectSettingsPath(cwd),
    user: getUserSettingsPath({ cwd, env: args.env, platform: args.platform, homedir: args.homedir }),
  } as const

  const sources: Array<{ source: HookSource; filePath: string }> = [
    { source: 'projectLocal', filePath: filePaths.projectLocal },
    { source: 'project', filePath: filePaths.project },
    { source: 'user', filePath: filePaths.user },
  ]

  const warnings: string[] = []
  const settingsBySource: Partial<Record<HookSource, Record<string, unknown> | null>> = {}

  for (const s of sources) {
    if (!(await args.fileStore.exists(s.filePath))) {
      settingsBySource[s.source] = null
      continue
    }
    try {
      const raw = await args.fileStore.readText(s.filePath)
      const parsed = tryParseJsonRecord(raw)
      if (!parsed) {
        warnings.push(`Invalid JSON in ${s.source} settings (${s.filePath}); treating hooks as empty`)
      }
      settingsBySource[s.source] = parsed
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`Failed to read ${s.source} settings (${s.filePath}): ${msg}`)
      settingsBySource[s.source] = null
    }
  }

  const buildForEvent = (eventName: HookEventName): HookRuleEntry[] => {
    const flat = sources.flatMap(({ source }) => {
      const settings = settingsBySource[source]
      if (!settings) return []
      return parseRulesForEvent({ settings, eventName, source })
    })
    return dedupeByCommand(flat)
  }

  return {
    PreToolUse: buildForEvent('PreToolUse'),
    PermissionRequest: buildForEvent('PermissionRequest'),
    PostToolUse: buildForEvent('PostToolUse'),
    warnings,
  }
}
