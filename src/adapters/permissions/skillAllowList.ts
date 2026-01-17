import path from 'node:path'
import type { FileStore } from '../fs/fileStore.js'
import { resolveFormaxProjectRoot } from '../fs/projectRoot.js'

export type SkillAllowList = {
  version: 1
  permissions: {
    allow: string[]
  }
}

export function buildSkillPermissionKey(skillName: string): string {
  const name = String(skillName || '').trim()
  return `Skill(${name})`
}

export function getProjectSettingsLocalPath(cwd: string): string {
  const projectRoot = resolveFormaxProjectRoot(cwd || process.cwd())
  return path.join(projectRoot, '.formax', 'settings.local.json')
}

function parseAllowListJson(raw: string): string[] {
  const text = String(raw || '').trim()
  if (!text) return []

  const parsed = JSON.parse(text) as any
  const allow = parsed?.permissions?.allow
  if (!Array.isArray(allow)) return []
  return allow.map((v) => String(v)).filter((v) => v.trim().length > 0)
}

function tryParseSettingsJson(raw: string): Record<string, unknown> | null {
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

export async function loadProjectSkillAllowList(args: {
  fileStore: FileStore
  cwd: string
}): Promise<Set<string>> {
  const filePath = getProjectSettingsLocalPath(args.cwd)
  if (!(await args.fileStore.exists(filePath))) return new Set()

  try {
    const raw = await args.fileStore.readText(filePath)
    return new Set(parseAllowListJson(raw))
  } catch {
    // If the settings file is unreadable/corrupt, behave conservatively:
    // treat it as empty (so we prompt again) instead of silently allowing.
    return new Set()
  }
}

export async function persistProjectSkillAllow(args: {
  fileStore: FileStore
  cwd: string
  key: string
}): Promise<void> {
  const filePath = getProjectSettingsLocalPath(args.cwd)
  const existingAllow = await loadProjectSkillAllowList({ fileStore: args.fileStore, cwd: args.cwd })
  if (existingAllow.has(args.key)) return

  const nextAllow = Array.from(new Set([...existingAllow, args.key])).sort((a, b) => a.localeCompare(b))

  // Preserve any other settings keys (e.g. env, other permissions) if the file already exists.
  let existingSettings: Record<string, unknown> | null = null
  if (await args.fileStore.exists(filePath)) {
    try {
      existingSettings = tryParseSettingsJson(await args.fileStore.readText(filePath))
    } catch {
      existingSettings = null
    }
  }

  const existingPermissions =
    existingSettings && typeof existingSettings.permissions === 'object' && existingSettings.permissions
      ? (existingSettings.permissions as Record<string, unknown>)
      : null

  const next: Record<string, unknown> = {
    ...(existingSettings ?? {}),
    version: 1,
    permissions: {
      ...(existingPermissions ?? {}),
      allow: nextAllow,
    },
  }

  await args.fileStore.writeJsonAtomic(filePath, next, { pretty: true, trailingNewline: true })
}
