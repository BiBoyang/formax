import type { FileStore } from '../fs/fileStore.js'
import { getProjectSettingsLocalPath, loadProjectPermissionsAllowList, persistProjectPermissionAllow } from './permissionsStore.js'

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

export { getProjectSettingsLocalPath }

export async function loadProjectSkillAllowList(args: {
  fileStore: FileStore
  cwd: string
}): Promise<Set<string>> {
  return loadProjectPermissionsAllowList(args)
}

export async function persistProjectSkillAllow(args: {
  fileStore: FileStore
  cwd: string
  key: string
}): Promise<void> {
  await persistProjectPermissionAllow(args)
}
