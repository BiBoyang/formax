import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { configShow } from '../config/show.js'
import { loadRuntimeConfig } from '../../env/config.js'
import { loadPolicyRules } from '../policy/store.js'
import { createStatusSnapshot } from './status.js'
import { createDebugBundle } from './debugBundle.js'

describe('createDebugBundle', () => {
  it('redacts secrets from captured auth.json', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-debug-bundle-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const logsDir = path.join(dir, 'logs')
      const apiKey = 'sk-doctor-secret'

      await fs.mkdir(projectDir, { recursive: true })
      await store.writeJsonAtomic(
        path.join(globalConfigDir, 'auth.json'),
        { version: 1, providers: { anthropic: { default: { apiKey } } } },
        { mode: 0o600 },
      )

      const env = {
        FORMAX_CONFIG_DIR: globalConfigDir,
        FORMAX_LOGS_DIR: logsDir,
        FORMAX_SUBAGENTS_DIR: path.join(dir, 'subagents'),
        FORMAX_PLAN_DIR: path.join(dir, 'plans'),
        FORMAX_BASE_URL: 'https://api.anthropic.com/v1',
      } as any

      const [shown, runtime, policy] = await Promise.all([
        configShow({ fileStore: store, cwd: projectDir, env, platform: 'linux', homedir: dir }),
        loadRuntimeConfig(env, projectDir, { fileStore: store, platform: 'linux', homedir: dir }),
        loadPolicyRules({ fileStore: store, cwd: projectDir, env, platform: 'linux', homedir: dir }),
      ])

      const status = createStatusSnapshot({
        version: '0.0.0',
        cwd: projectDir,
        runtime: {
          llm: {
            provider: runtime.llm.provider,
            baseUrl: runtime.llm.baseUrl,
            model: runtime.llm.model,
            timeoutMs: runtime.llm.timeoutMs,
            apiKey: runtime.llm.apiKey,
          },
          paths: runtime.paths,
          ui: runtime.ui,
        },
        shown,
        workspaceRoots: [projectDir],
      })

      const doctor = { version: '0.0.0', cwd: projectDir, checks: [], warnings: [] }

      const res = await createDebugBundle({
        fileStore: store,
        bundleDir: path.join(logsDir, 'doctor-bundle-test'),
        version: '0.0.0',
        cwd: projectDir,
        platform: 'linux',
        nodeVersion: 'v-test',
        shown,
        status,
        doctor,
        policy,
      })

      const bundledAuth = await store.readText(path.join(res.bundleDir, 'config', 'auth.json'))
      expect(bundledAuth).not.toContain(apiKey)
      expect(bundledAuth).toContain('<redacted>')

      const manifestRaw = await store.readText(path.join(res.bundleDir, 'manifest.json'))
      const manifest = JSON.parse(manifestRaw)
      expect(manifest.schemaVersion).toBe(1)
      expect(Array.isArray(manifest.files)).toBe(true)
      expect(manifest.files.some((f: any) => f.bundlePath === 'config/auth.json')).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('captures audit log with redaction when present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-debug-bundle-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const logsDir = path.join(dir, 'logs')

      await fs.mkdir(projectDir, { recursive: true })
      await store.writeTextAtomic(
        path.join(logsDir, 'audit.ndjson'),
        JSON.stringify({ schemaVersion: 1, kind: 'test', token: 'sk-super-secret' }) + '\n',
        { mode: 0o600 },
      )

      const env = {
        FORMAX_CONFIG_DIR: globalConfigDir,
        FORMAX_LOGS_DIR: logsDir,
        FORMAX_SUBAGENTS_DIR: path.join(dir, 'subagents'),
        FORMAX_PLAN_DIR: path.join(dir, 'plans'),
        FORMAX_BASE_URL: 'https://api.anthropic.com/v1',
      } as any

      const [shown, runtime, policy] = await Promise.all([
        configShow({ fileStore: store, cwd: projectDir, env, platform: 'linux', homedir: dir }),
        loadRuntimeConfig(env, projectDir, { fileStore: store, platform: 'linux', homedir: dir }),
        loadPolicyRules({ fileStore: store, cwd: projectDir, env, platform: 'linux', homedir: dir }),
      ])

      const status = createStatusSnapshot({
        version: '0.0.0',
        cwd: projectDir,
        runtime: {
          llm: {
            provider: runtime.llm.provider,
            baseUrl: runtime.llm.baseUrl,
            model: runtime.llm.model,
            timeoutMs: runtime.llm.timeoutMs,
            apiKey: runtime.llm.apiKey,
          },
          paths: runtime.paths,
          ui: runtime.ui,
        },
        shown,
        workspaceRoots: [projectDir],
      })

      const doctor = { version: '0.0.0', cwd: projectDir, checks: [], warnings: [] }

      const res = await createDebugBundle({
        fileStore: store,
        bundleDir: path.join(logsDir, 'doctor-bundle-audit-test'),
        version: '0.0.0',
        cwd: projectDir,
        platform: 'linux',
        nodeVersion: 'v-test',
        shown,
        status,
        doctor,
        policy,
        logsDir,
      })

      const bundledAudit = await store.readText(path.join(res.bundleDir, 'logs', 'audit.ndjson'))
      expect(bundledAudit).toContain('sk-<redacted>')
      expect(bundledAudit).not.toContain('sk-super-secret')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
