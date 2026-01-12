import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore'
import { loadPolicyRules, savePolicyRules } from './store.js'

describe('policy rules store', () => {
  it('returns empty rules when files are missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-store-empty-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await loadPolicyRules({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.globalRules).toBeNull()
      expect(res.projectRules).toBeNull()
      expect(res.mergedRules).toEqual([])
      expect(res.warnings).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('warns and ignores invalid JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-store-badjson-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeTextAtomic(path.join(globalConfigDir, 'rules.json'), '{oops\n')

      const res = await loadPolicyRules({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.globalRules).toBeNull()
      expect(res.mergedRules).toEqual([])
      expect(res.warnings.some((w) => w.includes('global rules'))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('merges project rules before global rules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-store-precedence-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'g1',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'fs.read', path: 'src/' },
          },
        ],
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'p1',
            createdAt: '2026-01-02T00:00:00Z',
            scope: 'project',
            decision: 'deny',
            match: { kind: 'fs.read', path: 'src/secret' },
          },
        ],
      })

      const res = await loadPolicyRules({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.mergedRules.map((r) => r.ruleId)).toEqual(['p1', 'g1'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('normalizes scopes based on the containing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-store-scope-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'p1',
            createdAt: '2026-01-02T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'fs.read', path: 'src/secret' },
          },
        ],
      })

      const res = await loadPolicyRules({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.projectRules?.rules[0]?.scope).toBe('project')
      expect(res.warnings.some((w) => w.includes('normalized'))).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('saves and loads a rules file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-policy-store-roundtrip-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      await savePolicyRules({
        fileStore: store,
        scope: 'project',
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
        rules: [
          {
            ruleId: 'r1',
            enabled: true,
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'project',
            decision: 'allow',
            reason: 'ok',
            template: '',
            match: { kind: 'fs.read', path: 'src/' },
          },
        ],
      })

      const res = await loadPolicyRules({
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        platform: 'linux',
        homedir: '/home/alice',
      })

      expect(res.projectRules?.rules[0]?.ruleId).toBe('r1')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

