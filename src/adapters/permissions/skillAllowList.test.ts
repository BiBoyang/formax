import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../fs/nodeFileStore.js'
import { buildSkillPermissionKey, getProjectSettingsLocalPath, loadProjectSkillAllowList, persistProjectSkillAllow } from './skillAllowList.js'

describe('skill allowList (repo settings.local.json)', () => {
  it('buildSkillPermissionKey normalizes empty input', () => {
    expect(buildSkillPermissionKey('frontend-design')).toBe('Skill(frontend-design)')
    expect(buildSkillPermissionKey('   ')).toBe('Skill()')
    expect(buildSkillPermissionKey('')).toBe('Skill()')
    expect(buildSkillPermissionKey(null as any)).toBe('Skill()')
    expect(buildSkillPermissionKey(undefined as any)).toBe('Skill()')
  })

  it('returns empty set when settings.local.json is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-allow-empty-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const allow = await loadProjectSkillAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists allow key and loads it back', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-allow-write-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      await persistProjectSkillAllow({ fileStore: store, cwd: projectDir, key })

      const filePath = getProjectSettingsLocalPath(projectDir)
      expect(await store.exists(filePath)).toBe(true)

      const allow = await loadProjectSkillAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow).sort()).toEqual([key])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses projectRoot when called from a subdirectory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-allow-subdir-'))
    try {
      const store = createNodeFileStore()
      const projectRoot = path.join(dir, 'repo')
      await fs.mkdir(path.join(projectRoot, '.formax'), { recursive: true })

      const nestedCwd = path.join(projectRoot, 'src', 'nested')
      await fs.mkdir(nestedCwd, { recursive: true })

      const key = buildSkillPermissionKey('frontend-design')
      await persistProjectSkillAllow({ fileStore: store, cwd: nestedCwd, key })

      const filePath = getProjectSettingsLocalPath(nestedCwd)
      expect(filePath).toBe(path.join(projectRoot, '.formax', 'settings.local.json'))
      expect(await store.exists(filePath)).toBe(true)

      const allow = await loadProjectSkillAllowList({ fileStore: store, cwd: nestedCwd })
      expect(Array.from(allow).sort()).toEqual([key])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated keys when updating settings.local.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-allow-preserve-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeJsonAtomic(filePath, {
        version: 1,
        env: { SOME_FLAG: '1' },
        permissions: { allow: ['OtherTool(x)'] },
      })

      const key = buildSkillPermissionKey('frontend-design')
      await persistProjectSkillAllow({ fileStore: store, cwd: projectDir, key })

      const parsed = JSON.parse(await store.readText(filePath))
      expect(parsed.env).toEqual({ SOME_FLAG: '1' })
      expect(parsed.permissions.allow).toEqual(['OtherTool(x)', key].sort())
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats invalid settings.local.json as empty (conservative)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-skill-allow-badjson-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeTextAtomic(filePath, '{oops\n')

      const allow = await loadProjectSkillAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
