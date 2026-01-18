import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../fs/nodeFileStore.js'
import {
  deletePermissionRule,
  deleteWorkspaceDirectory,
  getProjectSettingsLocalPath,
  getProjectSettingsPath,
  getUserSettingsPath,
  loadMergedPermissions,
  loadProjectPermissionsAllowList,
  persistPermissionRule,
  persistProjectPermissionAllow,
  persistWorkspaceDirectory,
} from './permissionsStore.js'

describe('permissions store (repo settings.local.json)', () => {
  it('returns empty set when settings.local.json is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-empty-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists allow key and loads it back', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-write-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const key = 'Skill(frontend-design)'
      await persistProjectPermissionAllow({ fileStore: store, cwd: projectDir, key })

      const filePath = getProjectSettingsLocalPath(projectDir)
      expect(await store.exists(filePath)).toBe(true)

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow).sort()).toEqual([key])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses projectRoot when called from a subdirectory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-subdir-'))
    try {
      const store = createNodeFileStore()
      const projectRoot = path.join(dir, 'repo')
      await fs.mkdir(path.join(projectRoot, '.formax'), { recursive: true })

      const nestedCwd = path.join(projectRoot, 'src', 'nested')
      await fs.mkdir(nestedCwd, { recursive: true })

      const key = 'Skill(frontend-design)'
      await persistProjectPermissionAllow({ fileStore: store, cwd: nestedCwd, key })

      const filePath = getProjectSettingsLocalPath(nestedCwd)
      expect(filePath).toBe(path.join(projectRoot, '.formax', 'settings.local.json'))
      expect(await store.exists(filePath)).toBe(true)

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: nestedCwd })
      expect(Array.from(allow).sort()).toEqual([key])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated keys when updating settings.local.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-preserve-'))
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

      const key = 'Skill(frontend-design)'
      await persistProjectPermissionAllow({ fileStore: store, cwd: projectDir, key })

      const parsed = JSON.parse(await store.readText(filePath))
      expect(parsed.env).toEqual({ SOME_FLAG: '1' })
      expect(parsed.permissions.allow).toEqual(['OtherTool(x)', key].sort())
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats invalid settings.local.json as empty (conservative)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-badjson-'))
    try {
      const store = createNodeFileStore()
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const filePath = getProjectSettingsLocalPath(projectDir)
      await store.writeTextAtomic(filePath, '{oops\n')

      const allow = await loadProjectPermissionsAllowList({ fileStore: store, cwd: projectDir })
      expect(Array.from(allow)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('permissions store (merged user/project settings)', () => {
  it('merges allow/ask/deny with projectLocal > project > user precedence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-merge-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const projectRoot = path.join(dir, 'repo')
      const nestedCwd = path.join(projectRoot, 'src', 'nested')

      await fs.mkdir(path.join(homedir, '.formax'), { recursive: true })
      await fs.mkdir(path.join(projectRoot, '.formax'), { recursive: true })
      await fs.mkdir(nestedCwd, { recursive: true })

      await store.writeJsonAtomic(getUserSettingsPath({ cwd: nestedCwd, env: {}, homedir }), {
        version: 1,
        env: { SOME_FLAG: '1' },
        permissions: {
          allow: ['Bash(ls:*)', 'Skill(frontend-design)'],
          ask: ['Skill(frontend-design)'],
          deny: ['WebFetch'],
          workspace: { additionalDirectories: ['/tmp/user'] },
        },
      })

      await store.writeJsonAtomic(getProjectSettingsPath(nestedCwd), {
        version: 1,
        permissions: {
          allow: ['Bash(ls:*)', 'Bash(cd:*)'],
          deny: ['WebFetch'],
          workspace: { additionalDirectories: ['/tmp/project'] },
        },
      })

      await store.writeJsonAtomic(getProjectSettingsLocalPath(nestedCwd), {
        version: 1,
        permissions: {
          allow: ['Bash(ls:*)', 'Bash(rm:*)'],
        },
      })

      const merged = await loadMergedPermissions({ fileStore: store, cwd: nestedCwd, env: {}, homedir })

      const allowByRule = new Map(merged.allow.map((e) => [e.rule, e]))
      expect(allowByRule.get('Bash(ls:*)')?.scope).toBe('projectLocal')
      expect(allowByRule.get('Bash(cd:*)')?.scope).toBe('project')
      expect(allowByRule.get('Skill(frontend-design)')?.scope).toBe('user')
      expect(Array.from(allowByRule.keys()).sort()).toEqual(
        ['Bash(ls:*)', 'Bash(rm:*)', 'Bash(cd:*)', 'Skill(frontend-design)'].sort(),
      )

      expect(merged.ask.map((e) => e.rule)).toEqual(['Skill(frontend-design)'])
      expect(merged.deny.map((e) => e.rule)).toEqual(['WebFetch'])

      expect(merged.workspace.additionalDirectories.map((e) => e.dir)).toEqual(['/tmp/project', '/tmp/user'])
      expect(merged.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists and deletes ask rules at user scope, preserving other fields', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-user-write-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const cwd = path.join(dir, 'repo')
      await fs.mkdir(path.join(homedir, '.formax'), { recursive: true })
      await fs.mkdir(path.join(cwd, '.formax'), { recursive: true })

      const userPath = getUserSettingsPath({ cwd, env: {}, homedir })
      await store.writeJsonAtomic(userPath, {
        version: 1,
        env: { SOME_FLAG: '1' },
        permissions: { allow: ['OtherTool(x)'] },
      })

      await persistPermissionRule({
        fileStore: store,
        cwd,
        scope: 'user',
        kind: 'ask',
        rule: 'Bash(ls:*)',
        env: {},
        homedir,
      })

      const parsedAfterAdd = JSON.parse(await store.readText(userPath))
      expect(parsedAfterAdd.env).toEqual({ SOME_FLAG: '1' })
      expect(parsedAfterAdd.permissions.allow).toEqual(['OtherTool(x)'])
      expect(parsedAfterAdd.permissions.ask).toEqual(['Bash(ls:*)'])

      await deletePermissionRule({
        fileStore: store,
        cwd,
        scope: 'user',
        kind: 'ask',
        rule: 'Bash(ls:*)',
        env: {},
        homedir,
      })

      const parsedAfterDelete = JSON.parse(await store.readText(userPath))
      expect(parsedAfterDelete.permissions.ask).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('persists and deletes workspace additional directories at projectLocal scope', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-permissions-workspace-'))
    try {
      const store = createNodeFileStore()
      const projectRoot = path.join(dir, 'repo')
      await fs.mkdir(path.join(projectRoot, '.formax'), { recursive: true })

      await persistWorkspaceDirectory({
        fileStore: store,
        cwd: projectRoot,
        scope: 'projectLocal',
        dir: '/tmp/a',
      })
      await persistWorkspaceDirectory({
        fileStore: store,
        cwd: projectRoot,
        scope: 'projectLocal',
        dir: '/tmp/b',
      })

      const filePath = getProjectSettingsLocalPath(projectRoot)
      const parsed = JSON.parse(await store.readText(filePath))
      expect(parsed.permissions.workspace.additionalDirectories).toEqual(['/tmp/a', '/tmp/b'])

      await deleteWorkspaceDirectory({
        fileStore: store,
        cwd: projectRoot,
        scope: 'projectLocal',
        dir: '/tmp/a',
      })

      const parsedAfterDelete = JSON.parse(await store.readText(filePath))
      expect(parsedAfterDelete.permissions.workspace.additionalDirectories).toEqual(['/tmp/b'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
