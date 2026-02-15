import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { getConfigPaths } from '../adapters/fs/configPaths.js'
import { dispatchCli } from './main.js'
import pkg from '../../package.json'

describe('dispatchCli', () => {
  it('prints version for --version', async () => {
    const res = await dispatchCli(['--version'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe(`${(pkg as any).version}\n`)
  })

  it('prints version JSON for "version --json"', async () => {
    const res = await dispatchCli(['version', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('version')
    expect(parsed.data?.version).toBe((pkg as any).version)
  })

  it('falls back to repl with no args', async () => {
    const res = await dispatchCli([])
    expect(res.kind).toBe('repl')
  })

  it('dispatches app-server subcommand', async () => {
    const res = await dispatchCli(['app-server'])
    expect(res.kind).toBe('app-server')
  })

  it('dispatches serve subcommand with defaults', async () => {
    const res = await dispatchCli(['serve'])
    expect(res.kind).toBe('serve')
    if (res.kind !== 'serve') return
    expect(res.options).toEqual({
      host: '127.0.0.1',
      port: 3777,
      allowedOrigins: [],
    })
  })

  it('dispatches serve subcommand with custom args', async () => {
    const res = await dispatchCli([
      'serve',
      '--host',
      '0.0.0.0',
      '--port',
      '4088',
      '--token',
      'abc123',
      '--allow-origin',
      'http://localhost:5173',
    ])
    expect(res.kind).toBe('serve')
    if (res.kind !== 'serve') return
    expect(res.options).toEqual({
      host: '0.0.0.0',
      port: 4088,
      token: 'abc123',
      allowedOrigins: ['http://localhost:5173'],
    })
  })

  it('returns serve command help', async () => {
    const res = await dispatchCli(['serve', '--help'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Formax Serve')
    expect(res.stdout).toContain('formax serve')
  })

  it('returns serve command help when --help and --json are both passed', async () => {
    const res = await dispatchCli(['serve', '--help', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Formax Serve')
  })

  it('dispatches web subcommand with defaults', async () => {
    const res = await dispatchCli(['web'])
    expect(res.kind).toBe('web')
    if (res.kind !== 'web') return
    expect(res.options).toEqual({
      host: '127.0.0.1',
      uiPort: 3781,
      bridgePort: 3777,
    })
  })

  it('dispatches web subcommand with custom ports', async () => {
    const res = await dispatchCli(['web', '--host', '0.0.0.0', '--ui-port', '4080', '--bridge-port', '4077'])
    expect(res.kind).toBe('web')
    if (res.kind !== 'web') return
    expect(res.options).toEqual({
      host: '0.0.0.0',
      uiPort: 4080,
      bridgePort: 4077,
    })
  })

  it('returns web command help', async () => {
    const res = await dispatchCli(['web', '--help'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Formax Web UI')
    expect(res.stdout).toContain('formax web')
  })

  it('returns web command help when --help and --json are both passed', async () => {
    const res = await dispatchCli(['web', '--help', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Formax Web UI')
  })

  it('shows help for --help', async () => {
    const res = await dispatchCli(['--help'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout.includes('Usage:')).toBe(true)
    expect(res.stdout.includes('Exit codes:')).toBe(true)
  })

  it('shows help for "help" subcommand', async () => {
    const res = await dispatchCli(['help'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout.includes('Usage:')).toBe(true)
  })

  it('doctor --bundle --bundle-tar includes archive path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-bundle-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const logsDir = path.join(dir, 'logs')
      const apiKey = 'sk-doctor-bundle-secret'

      await fs.mkdir(projectDir, { recursive: true })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: { anthropic: { default: { apiKey } } },
      })

      const env = {
        FORMAX_CONFIG_DIR: globalConfigDir,
        FORMAX_LOGS_DIR: logsDir,
        FORMAX_SUBAGENTS_DIR: path.join(dir, 'subagents'),
        FORMAX_PLAN_DIR: path.join(dir, 'plans'),
        FORMAX_BASE_URL: 'https://api.anthropic.com/v1',
      } as any

      const tarGz = async ({ outPath }: { sourceDir: string; outPath: string }) => {
        await fs.mkdir(path.dirname(outPath), { recursive: true })
        await fs.writeFile(outPath, 'fake', 'utf8')
      }

      const res = await dispatchCli(['doctor', '--bundle', '--bundle-tar'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
        tarGz,
        testConnection: async () => ({ ok: true, models: ['m1'] } as any),
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Debug bundle:')
      expect(res.stdout).toContain('Debug bundle archive:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns status output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-status-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await dispatchCli(['status'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Formax v')
      expect(res.stdout).toContain('LLM:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('status --json does not leak apiKey', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-status-json-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-status-secret'

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey },
          },
        },
      })

      const res = await dispatchCli(['status', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return

      expect(res.exitCode).toBe(0)
      expect(res.stdout.includes(apiKey)).toBe(false)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.command).toBe('status')
      expect(parsed.ok).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns usage error for missing subcommand', async () => {
    const res = await dispatchCli(['config'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    expect(res.stderr.includes('Usage:')).toBe(true)
  })

  it('returns usage error for unknown command', async () => {
    const res = await dispatchCli(['wat'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    expect(res.stderr.includes('Unknown command.')).toBe(true)
  })

  it('returns JSON error envelope for unknown command with --json', async () => {
    const res = await dispatchCli(['wat', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('unknown')
  })

  it('returns usage error for invalid web command args', async () => {
    const res = await dispatchCli(['web', '--ui-port', 'abc'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toContain('Invalid --ui-port')
  })

  it('returns usage error for invalid serve command args', async () => {
    const res = await dispatchCli(['serve', '--port', 'abc'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    expect(res.stderr).toContain('Invalid --port')
  })

  it('setup triggers repl', async () => {
    const res = await dispatchCli(['setup'])
    expect(res.kind).toBe('repl')
  })

  it('returns usage error for setup --json', async () => {
    const res = await dispatchCli(['setup', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('setup')
    expect(String(parsed?.error?.message || '')).toContain('--json is not supported')
  })

  it('config show --json does not leak apiKey', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-show-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-secret-cli'

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey },
          },
        },
      })

      const res = await dispatchCli(['config', 'show', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return

      expect(res.exitCode).toBe(0)
      expect(res.stdout.includes(apiKey)).toBe(false)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.command).toBe('config show')
      expect(parsed.ok).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('config migrate no-ops when legacy dir equals global dir', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-migrate-noop-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(projectDir, { recursive: true })

      const legacyDir = path.join(homedir, '.config', 'formax')
      const env = { FORMAX_CONFIG_DIR: legacyDir } as any

      const res = await dispatchCli(['config', 'migrate'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Nothing to migrate.')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('config migrate reports copied/skipped/missing (human)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-migrate-mixed-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const projectDir = path.join(dir, 'repo')
      const globalConfigDir = path.join(dir, 'global')

      await fs.mkdir(projectDir, { recursive: true })

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any
      const paths = getConfigPaths({ cwd: projectDir, homedir, platform: 'linux', env })

      await store.writeTextAtomic(paths.legacyConfigPath, '{"version":1}\n')
      await store.writeTextAtomic(paths.legacyAuthPath, '{"version":1}\n')
      await store.writeTextAtomic(paths.globalConfigPath, '{"version":1,"ui":{}}\n')
      await fs.rm(paths.globalAuthPath, { force: true })
      expect(await store.exists(paths.globalAuthPath)).toBe(false)

      const humanRes = await dispatchCli(['config', 'migrate'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir,
        platform: 'linux',
      })

      expect(humanRes.kind).toBe('handled')
      if (humanRes.kind !== 'handled') return
      expect(humanRes.exitCode).toBe(0)
      expect(humanRes.stdout).toContain('Migration:')
      expect(humanRes.stdout).toContain('- config: skipped')
      expect(humanRes.stdout).toContain('- auth: copied')
      expect(humanRes.stdout).toContain('- rules: missing')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('config migrate reports copied/skipped/missing (--json)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-migrate-mixed-json-'))
    try {
      const store = createNodeFileStore()
      const homedir = path.join(dir, 'home')
      const projectDir = path.join(dir, 'repo')
      const globalConfigDir = path.join(dir, 'global')

      await fs.mkdir(projectDir, { recursive: true })

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any
      const paths = getConfigPaths({ cwd: projectDir, homedir, platform: 'linux', env })

      await store.writeTextAtomic(paths.legacyConfigPath, '{"version":1}\n')
      await store.writeTextAtomic(paths.legacyAuthPath, '{"version":1}\n')
      await store.writeTextAtomic(paths.globalConfigPath, '{"version":1,"ui":{}}\n')
      await fs.rm(paths.globalAuthPath, { force: true })

      const jsonRes = await dispatchCli(['config', 'migrate', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir,
        platform: 'linux',
      })

      expect(jsonRes.kind).toBe('handled')
      if (jsonRes.kind !== 'handled') return
      expect(jsonRes.exitCode).toBe(0)
      const parsed = JSON.parse(jsonRes.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('config migrate')
      expect(parsed?.data?.actions?.map((a: any) => a.status)).toEqual(['skipped', 'copied', 'missing'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns usage error for unknown config subcommand', async () => {
    const res = await dispatchCli(['config', 'wat', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('config')
    expect(parsed?.error?.message).toBe('Unknown subcommand')
  })

  it('returns usage error for missing auth subcommand', async () => {
    const res = await dispatchCli(['auth', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('auth')
    expect(parsed?.error?.message).toBe('Missing subcommand')
  })

  it('returns usage error for unknown auth subcommand', async () => {
    const res = await dispatchCli(['auth', 'wat', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('auth')
    expect(parsed?.error?.message).toBe('Unknown subcommand')
  })

  it('auth set/list/delete works and does not leak apiKey', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-auth-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-auth-cli'

      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any

      const setRes = await dispatchCli(['auth', 'set', 'anthropic', 'default', apiKey, '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(setRes.kind).toBe('handled')
      if (setRes.kind !== 'handled') return
      expect(setRes.exitCode).toBe(0)
      expect(setRes.stdout.includes(apiKey)).toBe(false)

      const listRes = await dispatchCli(['auth', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const listParsed = JSON.parse(listRes.stdout)
      const items = listParsed?.data?.items
      expect(Array.isArray(items)).toBe(true)
      expect(items).toContainEqual({ provider: 'anthropic', authRef: 'default' })

      const delRes = await dispatchCli(['auth', 'delete', 'anthropic', 'default', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })

      expect(delRes.kind).toBe('handled')
      if (delRes.kind !== 'handled') return
      const delParsed = JSON.parse(delRes.stdout)
      expect(delParsed?.data?.deleted).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('doctor --json reports failing checks when config is incomplete', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-missing-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')

      const res = await dispatchCli(['doctor', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_LOGS_DIR: path.join(dir, 'logs'),
          FORMAX_SUBAGENTS_DIR: path.join(dir, 'subagents'),
          FORMAX_PLAN_DIR: path.join(dir, 'plans'),
        } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: true, models: [] }),
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('doctor')
      expect(Array.isArray(parsed?.data?.checks)).toBe(true)
      expect(parsed.data.checks.some((c: any) => c.status === 'fail')).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('doctor passes when auth/model/baseUrl are configured and connectivity succeeds', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-ok-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const apiKey = 'sk-doctor-secret'

      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: { anthropic: { default: { apiKey } } },
      })

      const res = await dispatchCli(['doctor', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: {
          FORMAX_CONFIG_DIR: globalConfigDir,
          FORMAX_BASE_URL: 'https://api.anthropic.com/v1',
          FORMAX_LOGS_DIR: path.join(dir, 'logs'),
          FORMAX_SUBAGENTS_DIR: path.join(dir, 'subagents'),
          FORMAX_PLAN_DIR: path.join(dir, 'plans'),
        } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: true, models: ['m1'] }),
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)
      expect(res.stdout.includes(apiKey)).toBe(false)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('doctor')
      expect(parsed.data.checks.some((c: any) => c.status === 'fail')).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy list --json returns empty rules when files are missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-list-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await dispatchCli(['policy', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('policy list')
      expect(Array.isArray(parsed?.data?.rules)).toBe(true)
      expect(parsed.data.rules).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy explain --json returns matched rule and decision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-explain-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            reason: 'dangerous',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const res = await dispatchCli(['policy', 'explain', '--action', 'bash.exec', '--cmd', 'rm -rf /', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('policy explain')
      expect(parsed.data.decision).toBe('deny')
      expect(parsed.data.matchedRule.ruleId).toBe('deny-rm')
      expect(parsed.data.matchedRule.reason).toBe('dangerous')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy test exits non-zero when decision is not allow', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-test-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const res = await dispatchCli(['policy', 'test', '--bash', 'rm -rf /', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)

      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.command).toBe('policy test')
      expect(parsed.data.decision).toBe('deny')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy explain returns usage error when required args are missing', async () => {
    const res = await dispatchCli(['policy', 'explain', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(2)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('policy explain')
  })

  it('policy disable updates the matched rule', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-disable-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const disableRes = await dispatchCli(['policy', 'disable', 'deny-rm', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(disableRes.kind).toBe('handled')
      if (disableRes.kind !== 'handled') return
      expect(disableRes.exitCode).toBe(0)

      const disableAgainRes = await dispatchCli(['policy', 'disable', 'deny-rm', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(disableAgainRes.kind).toBe('handled')
      if (disableAgainRes.kind !== 'handled') return
      expect(disableAgainRes.exitCode).toBe(0)

      const listRes = await dispatchCli(['policy', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const parsed = JSON.parse(listRes.stdout)
      const rule = (parsed?.data?.rules || []).find((r: any) => r.ruleId === 'deny-rm')
      expect(rule).toBeTruthy()
      expect(rule.enabled).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy disable returns error when ruleId is not found', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-disable-missing-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const res = await dispatchCli(['policy', 'disable', 'nope', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)
      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(false)
      expect(parsed.command).toBe('policy disable')
      expect(parsed?.error?.message).toBe('Rule not found: nope')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy disable updates project-only rules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-disable-project-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'project',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const disableRes = await dispatchCli(['policy', 'disable', 'deny-rm', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(disableRes.kind).toBe('handled')
      if (disableRes.kind !== 'handled') return
      expect(disableRes.exitCode).toBe(0)

      const listRes = await dispatchCli(['policy', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const parsed = JSON.parse(listRes.stdout)
      const rule = (parsed?.data?.rules || []).find((r: any) => r.ruleId === 'deny-rm')
      expect(rule?.scope).toBe('project')
      expect(rule?.enabled).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy delete removes the matched rule', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-delete-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const deleteRes = await dispatchCli(['policy', 'delete', 'deny-rm', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(deleteRes.kind).toBe('handled')
      if (deleteRes.kind !== 'handled') return
      expect(deleteRes.exitCode).toBe(0)

      const listRes = await dispatchCli(['policy', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const parsed = JSON.parse(listRes.stdout)
      expect((parsed?.data?.rules || []).some((r: any) => r.ruleId === 'deny-rm')).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy delete returns error when ruleId is not found', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-delete-missing-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const res = await dispatchCli(['policy', 'delete', 'nope', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)
      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(false)
      expect(parsed.command).toBe('policy delete')
      expect(parsed?.error?.message).toBe('Rule not found: nope')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy delete removes project-only rules', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-delete-project-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'project',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const deleteRes = await dispatchCli(['policy', 'delete', 'deny-rm', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(deleteRes.kind).toBe('handled')
      if (deleteRes.kind !== 'handled') return
      expect(deleteRes.exitCode).toBe(0)

      const listRes = await dispatchCli(['policy', 'list', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })

      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      const parsed = JSON.parse(listRes.stdout)
      expect((parsed?.data?.rules || []).some((r: any) => r.ruleId === 'deny-rm')).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
