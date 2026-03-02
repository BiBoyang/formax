import { describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { getConfigPaths } from '../../adapters/fs/configPaths.js'
import { __mainTestOnly, dispatchCli } from './main.js'
import pkg from '../../../package.json'

describe('dispatchCli', () => {
  it('prints version for --version', async () => {
    const res = await dispatchCli(['--version'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe(`${(pkg as any).version}\n`)
  })

  it('prints version JSON for --version --json', async () => {
    const res = await dispatchCli(['--version', '--json'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    const parsed = JSON.parse(res.stdout)
    expect(parsed.command).toBe('version')
    expect(parsed.data?.version).toBe((pkg as any).version)
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

  it('prints version for "version"', async () => {
    const res = await dispatchCli(['version'])
    expect(res.kind).toBe('handled')
    if (res.kind !== 'handled') return
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe(`${(pkg as any).version}\n`)
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

  it('returns usage json for serve/web when --json is used', async () => {
    const serveRes = await dispatchCli(['serve', '--json'])
    expect(serveRes.kind).toBe('handled')
    if (serveRes.kind !== 'handled') return
    expect(serveRes.exitCode).toBe(2)
    expect(JSON.parse(serveRes.stdout).ok).toBe(false)

    const webRes = await dispatchCli(['web', '--json'])
    expect(webRes.kind).toBe('handled')
    if (webRes.kind !== 'handled') return
    expect(webRes.exitCode).toBe(2)
    expect(JSON.parse(webRes.stdout).ok).toBe(false)
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

  it('doctor human output without bundle and with failing checks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-human-fail-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await dispatchCli(['doctor'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: false, code: 'X' as any, message: 'x' }),
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)
      expect(res.stdout).not.toContain('Debug bundle:')
      expect(res.stdout).not.toContain('Debug bundle archive:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('doctor --bundle --bundle-tar reports archive failure in warnings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-tar-fail-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await dispatchCli(['doctor', '--bundle', '--bundle-tar', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: true, models: ['x'] as any }),
        tarGz: async () => {
          throw new Error('tar-failed')
        },
      })
      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)
      const parsed = JSON.parse(res.stdout)
      expect(parsed.ok).toBe(true)
      expect(parsed.warnings.join('\n')).toContain('Failed to create bundle archive: tar-failed')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('doctor --bundle succeeds without tar archive output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-bundle-no-tar-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })

      const res = await dispatchCli(['doctor', '--bundle'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: true, models: ['x'] as any }),
      })
      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.stdout).toContain('Debug bundle:')
      expect(res.stdout).not.toContain('Debug bundle archive:')
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

  it('covers policy human-path usage and explain/test text output', async () => {
    const missing = await dispatchCli(['policy'])
    expect(missing.kind).toBe('handled')
    if (missing.kind !== 'handled') return
    expect(missing.exitCode).toBe(2)
    expect(missing.stderr).toContain('Usage:')

    const explainMissing = await dispatchCli(['policy', 'explain'])
    expect(explainMissing.kind).toBe('handled')
    if (explainMissing.kind !== 'handled') return
    expect(explainMissing.exitCode).toBe(2)
    expect(explainMissing.stderr).toContain('Error:')

    const testMissing = await dispatchCli(['policy', 'test'])
    expect(testMissing.kind).toBe('handled')
    if (testMissing.kind !== 'handled') return
    expect(testMissing.exitCode).toBe(2)
    expect(testMissing.stderr).toContain('Error:')

    const testMissingJson = await dispatchCli(['policy', 'test', '--json'])
    expect(testMissingJson.kind).toBe('handled')
    if (testMissingJson.kind !== 'handled') return
    expect(testMissingJson.exitCode).toBe(2)
    expect(JSON.parse(testMissingJson.stdout).ok).toBe(false)

    const missingJson = await dispatchCli(['policy', '--json'])
    expect(missingJson.kind).toBe('handled')
    if (missingJson.kind !== 'handled') return
    expect(missingJson.exitCode).toBe(2)
    expect(JSON.parse(missingJson.stdout).ok).toBe(false)

    const unknownPolicyHuman = await dispatchCli(['policy', 'unknown'])
    expect(unknownPolicyHuman.kind).toBe('handled')
    if (unknownPolicyHuman.kind !== 'handled') return
    expect(unknownPolicyHuman.exitCode).toBe(2)
    expect(unknownPolicyHuman.stderr).toContain('Usage:')
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

  it('covers policy list/explain/test/disable/delete human output paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-human-'))
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
            ruleId: 'allow-ls',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'bash.exec', commandPrefix: 'ls' },
          },
          {
            ruleId: 'deny-rm',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const listRes = await dispatchCli(['policy', 'list'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(listRes.kind).toBe('handled')
      if (listRes.kind !== 'handled') return
      expect(listRes.stdout).toContain('Rules:')

      const explainRes = await dispatchCli(['policy', 'explain', '--action', 'bash.exec', '--cmd', 'ls -la'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(explainRes.kind).toBe('handled')
      if (explainRes.kind !== 'handled') return
      expect(explainRes.stdout).toContain('Decision:')

      const testRes = await dispatchCli(['policy', 'test', '--bash', 'ls -la'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(testRes.kind).toBe('handled')
      if (testRes.kind !== 'handled') return
      expect(testRes.exitCode).toBe(0)

      const disableMissingIdRes = await dispatchCli(['policy', 'disable'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(disableMissingIdRes.kind).toBe('handled')
      if (disableMissingIdRes.kind !== 'handled') return
      expect(disableMissingIdRes.exitCode).toBe(2)

      const disableMissingIdJsonRes = await dispatchCli(['policy', 'disable', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(disableMissingIdJsonRes.kind).toBe('handled')
      if (disableMissingIdJsonRes.kind !== 'handled') return
      expect(disableMissingIdJsonRes.exitCode).toBe(2)
      expect(JSON.parse(disableMissingIdJsonRes.stdout).ok).toBe(false)

      const disableHumanRes = await dispatchCli(['policy', 'disable', 'deny-rm'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(disableHumanRes.kind).toBe('handled')
      if (disableHumanRes.kind !== 'handled') return
      expect(disableHumanRes.stdout).toContain('Disabled deny-rm')

      const deleteRes = await dispatchCli(['policy', 'delete', 'allow-ls'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(deleteRes.kind).toBe('handled')
      if (deleteRes.kind !== 'handled') return
      expect(deleteRes.stdout).toContain('Deleted allow-ls')

      const unknownPolicyJson = await dispatchCli(['policy', 'unknown', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(unknownPolicyJson.kind).toBe('handled')
      if (unknownPolicyJson.kind !== 'handled') return
      expect(unknownPolicyJson.exitCode).toBe(2)
      expect(JSON.parse(unknownPolicyJson.stdout).ok).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy disable handles rules with omitted arrays and write failures', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-disable-edge-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), { version: 1 })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), { version: 1 })

      const noRulesRes = await dispatchCli(['policy', 'disable', 'missing', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(noRulesRes.kind).toBe('handled')
      if (noRulesRes.kind !== 'handled') return
      expect(noRulesRes.exitCode).toBe(1)

      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'already-disabled',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'project',
            decision: 'deny',
            enabled: false,
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })
      const alreadyDisabled = await dispatchCli(['policy', 'disable', 'already-disabled', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(alreadyDisabled.kind).toBe('handled')
      if (alreadyDisabled.kind !== 'handled') return
      expect(alreadyDisabled.exitCode).toBe(0)

      await fs.writeFile(path.join(projectDir, '.formax', 'rules.json'), '{not-json', 'utf8')
      const withWarning = await dispatchCli(['policy', 'disable', 'missing'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(withWarning.kind).toBe('handled')
      if (withWarning.kind !== 'handled') return
      expect(withWarning.stderr).toContain('Rule not found')

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'to-fail-save',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'deny',
            match: { kind: 'bash.exec', commandPrefix: 'rm' },
          },
        ],
      })

      const failingStore: any = { ...store, writeJsonAtomic: async () => { throw new Error('write-failed') } }
      const failJson = await dispatchCli(['policy', 'disable', 'to-fail-save', '--json'], {
        fileStore: failingStore,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(failJson.kind).toBe('handled')
      if (failJson.kind !== 'handled') return
      expect(failJson.exitCode).toBe(1)
      expect(JSON.parse(failJson.stdout).ok).toBe(false)

      const failHuman = await dispatchCli(['policy', 'disable', 'to-fail-save'], {
        fileStore: failingStore,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(failHuman.kind).toBe('handled')
      if (failHuman.kind !== 'handled') return
      expect(failHuman.exitCode).toBe(1)
      expect(failHuman.stderr).toContain('write-failed')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('covers auth human-path list/set/delete and usage errors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-auth-human-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any

      const listEmpty = await dispatchCli(['auth', 'list'], { fileStore: store, cwd: projectDir, env, homedir: dir, platform: 'linux' })
      expect(listEmpty.kind).toBe('handled')
      if (listEmpty.kind !== 'handled') return
      expect(listEmpty.stdout).toContain('No auth entries found')

      const setOk = await dispatchCli(['auth', 'set', 'anthropic', 'default', 'sk-1'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(setOk.kind).toBe('handled')
      if (setOk.kind !== 'handled') return
      expect(setOk.stdout).toContain('Saved anthropic:default')

      const deleteNotFound = await dispatchCli(['auth', 'delete', 'anthropic', 'missing'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(deleteNotFound.kind).toBe('handled')
      if (deleteNotFound.kind !== 'handled') return
      expect(deleteNotFound.stdout).toContain('Not found: anthropic:missing')

      const deleteOk = await dispatchCli(['auth', 'delete', 'anthropic', 'default'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(deleteOk.kind).toBe('handled')
      if (deleteOk.kind !== 'handled') return
      expect(deleteOk.stdout).toContain('Deleted anthropic:default')

      const setBad = await dispatchCli(['auth', 'set', 'bad-provider', 'default', 'x'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(setBad.kind).toBe('handled')
      if (setBad.kind !== 'handled') return
      expect(setBad.exitCode).toBe(2)
      expect(setBad.stderr).toContain('Error:')

      const setBadJson = await dispatchCli(['auth', 'set', 'bad-provider', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(setBadJson.kind).toBe('handled')
      if (setBadJson.kind !== 'handled') return
      expect(setBadJson.exitCode).toBe(2)
      expect(JSON.parse(setBadJson.stdout).ok).toBe(false)

      const setMissingArgs = await dispatchCli(['auth', 'set'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(setMissingArgs.kind).toBe('handled')
      if (setMissingArgs.kind !== 'handled') return
      expect(setMissingArgs.exitCode).toBe(2)
      expect(setMissingArgs.stderr).toContain('Error:')

      const deleteMissingArgsJson = await dispatchCli(['auth', 'delete', 'bad-provider', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(deleteMissingArgsJson.kind).toBe('handled')
      if (deleteMissingArgsJson.kind !== 'handled') return
      expect(deleteMissingArgsJson.exitCode).toBe(2)
      expect(JSON.parse(deleteMissingArgsJson.stdout).ok).toBe(false)

      const authMissingSub = await dispatchCli(['auth'], { fileStore: store, cwd: projectDir, env, homedir: dir, platform: 'linux' })
      expect(authMissingSub.kind).toBe('handled')
      if (authMissingSub.kind !== 'handled') return
      expect(authMissingSub.exitCode).toBe(2)
      expect(authMissingSub.stderr).toContain('Usage:')

      const authUnknownSub = await dispatchCli(['auth', 'unknown'], { fileStore: store, cwd: projectDir, env, homedir: dir, platform: 'linux' })
      expect(authUnknownSub.kind).toBe('handled')
      if (authUnknownSub.kind !== 'handled') return
      expect(authUnknownSub.exitCode).toBe(2)
      expect(authUnknownSub.stderr).toContain('Usage:')

      const authUnknownJson = await dispatchCli(['auth', 'unknown', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(authUnknownJson.kind).toBe('handled')
      if (authUnknownJson.kind !== 'handled') return
      expect(authUnknownJson.exitCode).toBe(2)
      expect(JSON.parse(authUnknownJson.stdout).ok).toBe(false)

      const configMissingJson = await dispatchCli(['config', '--json'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(configMissingJson.kind).toBe('handled')
      if (configMissingJson.kind !== 'handled') return
      expect(configMissingJson.exitCode).toBe(2)
      expect(JSON.parse(configMissingJson.stdout).ok).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('doctor --bundle human output includes write-failure warning', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-doctor-bundle-write-fail-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const logsAsFile = path.join(dir, 'logs-as-file')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(logsAsFile, 'x', 'utf8')

      const res = await dispatchCli(['doctor', '--bundle'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir, FORMAX_LOGS_DIR: logsAsFile } as any,
        homedir: dir,
        platform: 'linux',
        testConnection: async () => ({ ok: true, models: ['x'] as any }),
        tarGz: async () => undefined,
      })

      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(1)
      expect(res.stdout).toContain('Failed to write debug bundle:')
      expect(res.stdout).not.toContain('Debug bundle archive:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('policy disable human output prints warnings section when load has warnings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-policy-disable-warn-human-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(path.join(projectDir, '.formax'), { recursive: true })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'rules.json'), {
        version: 1,
        rules: [
          {
            ruleId: 'global-keep',
            createdAt: '2026-01-01T00:00:00Z',
            scope: 'global',
            decision: 'allow',
            match: { kind: 'bash.exec', commandPrefix: 'ls' },
          },
        ],
      })

      await fs.writeFile(path.join(projectDir, '.formax', 'rules.json'), '{broken-json', 'utf8')

      const res = await dispatchCli(['policy', 'disable', 'global-keep'], {
        fileStore: store,
        cwd: projectDir,
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
        homedir: dir,
        platform: 'linux',
      })
      expect(res.kind).toBe('handled')
      if (res.kind !== 'handled') return
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Disabled global-keep')
      expect(res.stdout).toContain('Warnings:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('covers config/auth human fallback branches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formax-cli-config-auth-fallback-'))
    try {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await fs.mkdir(globalConfigDir, { recursive: true })
      await fs.mkdir(projectDir, { recursive: true })
      const env = { FORMAX_CONFIG_DIR: globalConfigDir } as any

      const showHuman = await dispatchCli(['config', 'show'], { fileStore: store, cwd: projectDir, env, homedir: dir, platform: 'linux' })
      expect(showHuman.kind).toBe('handled')
      if (showHuman.kind !== 'handled') return
      expect(showHuman.exitCode).toBe(0)
      expect(showHuman.stdout).toContain('Global config dir:')

      const configUnknownHuman = await dispatchCli(['config', 'unknown'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(configUnknownHuman.kind).toBe('handled')
      if (configUnknownHuman.kind !== 'handled') return
      expect(configUnknownHuman.exitCode).toBe(2)
      expect(configUnknownHuman.stderr).toContain('Usage:')

      const authDeleteHumanError = await dispatchCli(['auth', 'delete', 'bad-provider'], {
        fileStore: store,
        cwd: projectDir,
        env,
        homedir: dir,
        platform: 'linux',
      })
      expect(authDeleteHumanError.kind).toBe('handled')
      if (authDeleteHumanError.kind !== 'handled') return
      expect(authDeleteHumanError.exitCode).toBe(2)
      expect(authDeleteHumanError.stderr).toContain('Error:')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('__mainTestOnly helpers', () => {
  it('formats ok/err json envelopes', () => {
    expect(__mainTestOnly.toOptionalWarnings([])).toBeUndefined()
    expect(__mainTestOnly.toOptionalWarnings(['w'])).toEqual(['w'])
    expect(__mainTestOnly.formatUnknownError(new Error('boom'))).toBe('boom')
    expect(__mainTestOnly.formatUnknownError('boom')).toBe('boom')
    expect(__mainTestOnly.getCliVersion({ version: '1.2.3' })).toBe('1.2.3')
    expect(__mainTestOnly.getCliVersion({})).toBe('unknown')
    const fakeConnection = async () => ({ ok: true, models: [] } as any)
    expect(__mainTestOnly.resolveTestConnection(fakeConnection)).toBe(fakeConnection)
    expect(typeof __mainTestOnly.resolveTestConnection(undefined)).toBe('function')
    const fakeTar = async () => {}
    expect(__mainTestOnly.resolveTarGz(fakeTar)).toBe(fakeTar)
    expect(typeof __mainTestOnly.resolveTarGz(undefined)).toBe('function')

    const ok = JSON.parse(__mainTestOnly.okJson('cmd', { a: 1 }))
    expect(ok.ok).toBe(true)
    expect(ok.command).toBe('cmd')
    expect(ok.warnings).toBeUndefined()
    const okWithWarnings = JSON.parse(__mainTestOnly.okJson('cmd', { a: 1 }, ['w']))
    expect(okWithWarnings.warnings).toEqual(['w'])

    const err = JSON.parse(__mainTestOnly.errJson('cmd', 'boom', ['w1'], { m: 1 }))
    expect(err.ok).toBe(false)
    expect(err.error.message).toBe('boom')
    expect(err.warnings).toEqual(['w1'])
    expect(err.meta).toEqual({ m: 1 })
  })

  it('formats config show/migrate/auth list human outputs across branches', () => {
    const showNoAuth = __mainTestOnly.formatConfigShowHuman({
      paths: {
        globalConfigDir: '/g',
        projectConfigDir: '/p',
        legacyConfigDir: '/l',
        globalConfigPath: '/g/config.json',
        projectConfigPath: '/p/.formax/config.json',
        globalAuthPath: '/g/auth.json',
        globalRulesPath: '/g/rules.json',
        projectRulesPath: '/p/.formax/rules.json',
      },
      files: {
        globalConfigLoaded: false,
        projectConfigLoaded: false,
        authStoreLoaded: false,
        globalRulesLoaded: false,
        projectRulesLoaded: false,
      },
      config: {
        llm: { provider: 'anthropic', baseUrl: 'u', model: 'm', timeoutMs: 1, authRef: 'default' },
        ui: { promptProfile: 'lite', assistantTextMode: 'buffered' },
        paths: { logsDir: '/logs', subagentsDir: '/agents', planDir: '/plans' },
      },
      sources: {},
      auth: null,
      warnings: [],
    } as any)
    expect(showNoAuth).toContain('Auth:')
    expect(showNoAuth).toContain('- none')
    expect(showNoAuth).not.toContain('Warnings:')

    const showWithAuth = __mainTestOnly.formatConfigShowHuman({
      paths: {
        globalConfigDir: '/g',
        projectConfigDir: '/p',
        legacyConfigDir: '/l',
        globalConfigPath: '/g/config.json',
        projectConfigPath: '/p/.formax/config.json',
        globalAuthPath: '/g/auth.json',
        globalRulesPath: '/g/rules.json',
        projectRulesPath: '/p/.formax/rules.json',
      },
      files: {
        globalConfigLoaded: true,
        projectConfigLoaded: true,
        authStoreLoaded: true,
        globalRulesLoaded: true,
        projectRulesLoaded: true,
      },
      config: {
        llm: { provider: 'anthropic', baseUrl: 'u', model: 'm', timeoutMs: 1, authRef: 'default' },
        ui: { promptProfile: 'lite', assistantTextMode: 'buffered' },
        paths: { logsDir: '/logs', subagentsDir: '/agents', planDir: '/plans' },
      },
      sources: { 'llm.provider': 'env' },
      auth: { provider: 'anthropic', authRef: 'default', source: 'auth-store' },
      warnings: ['warn'],
    } as any)
    expect(showWithAuth).toContain('provider: anthropic')
    expect(showWithAuth).toContain('Warnings:')

    const migrateNoActions = __mainTestOnly.formatConfigMigrateHuman({
      paths: { legacyConfigDir: '/l', globalConfigDir: '/g' },
      actions: [],
      warnings: [],
    } as any)
    expect(migrateNoActions).toContain('Nothing to migrate.')

    const migrateWithActions = __mainTestOnly.formatConfigMigrateHuman({
      paths: { legacyConfigDir: '/l', globalConfigDir: '/g' },
      actions: [
        { label: 'a', status: 'copied', fromPath: '/a', toPath: '/b' },
        { label: 'b', status: 'skipped', toPath: '/b' },
        { label: 'c', status: 'missing', fromPath: '/c' },
        { label: 'd', status: 'error', error: 'boom' },
        { label: 'e', status: 'error' },
      ],
      warnings: ['w'],
    } as any)
    expect(migrateWithActions).toContain('/a -> /b')
    expect(migrateWithActions).toContain('exists: /b')
    expect(migrateWithActions).toContain('missing: /c')
    expect(migrateWithActions).toContain('error: boom')

    const authEmpty = __mainTestOnly.formatAuthListHuman({ items: [], authPath: '/a', warnings: [] } as any)
    expect(authEmpty).toContain('No auth entries found')
    const authWithItems = __mainTestOnly.formatAuthListHuman({
      items: [{ provider: 'anthropic', authRef: 'default' }],
      authPath: '/a',
      warnings: ['w'],
    } as any)
    expect(authWithItems).toContain('anthropic:default')
    expect(authWithItems).toContain('Warnings:')
    const authWithItemsNoWarnings = __mainTestOnly.formatAuthListHuman({
      items: [{ provider: 'openai', authRef: 'team' }],
      authPath: '/a',
      warnings: [],
    } as any)
    expect(authWithItemsNoWarnings).toContain('openai:team')
    expect(authWithItemsNoWarnings).not.toContain('Warnings:')
  })

  it('covers provider/flag/policy-arg parsing helpers', () => {
    expect(__mainTestOnly.normalizeProvider('openai')).toBe('openai')
    expect(() => __mainTestOnly.normalizeProvider(undefined as any)).toThrow(/invalid provider/i)
    expect(() => __mainTestOnly.normalizeProvider('bad')).toThrow(/invalid provider/i)
    expect(__mainTestOnly.ensureFileStore({ fileStore: { x: 1 } as any })).toEqual({ x: 1 })
    expect(__mainTestOnly.getFlagValue(['--x', '1'], '--x')).toBe('1')
    expect(__mainTestOnly.getFlagValue(['--x'], '--x')).toBeNull()
    expect(__mainTestOnly.getFlagValue([], '--x')).toBeNull()

    expect(__mainTestOnly.parsePolicyActionFromArgs([])).toEqual({ error: 'Missing --action' })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'invalid'])).toEqual({ error: 'Invalid --action: invalid' })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'bash.exec'])).toEqual({
      error: 'Missing --cmd for bash.exec',
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'bash.exec', '--cmd', 'ls'])).toEqual({
      action: { kind: 'bash.exec', command: 'ls' },
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'fs.read'])).toEqual({ error: 'Missing --path for fs.read' })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'fs.read', '--path', '/tmp/a'])).toEqual({
      action: { kind: 'fs.read', path: '/tmp/a' },
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'fs.write'])).toEqual({
      error: 'Missing --path for fs.write',
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'fs.write', '--path', '/tmp/a'])).toEqual({
      action: { kind: 'fs.write', path: '/tmp/a' },
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'net.fetch'])).toEqual({
      error: 'Missing --url for net.fetch',
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'net.fetch', '--url', 'https://x'])).toEqual({
      action: { kind: 'net.fetch', url: 'https://x' },
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'net.search'])).toEqual({
      error: 'Missing --query for net.search',
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'net.search', '--query', 'hello'])).toEqual({
      action: { kind: 'net.search', query: 'hello' },
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'tool.install'])).toEqual({
      error: 'Missing --tool for tool.install',
    })
    expect(__mainTestOnly.parsePolicyActionFromArgs(['--action', 'tool.install', '--tool', 'jq'])).toEqual({
      action: { kind: 'tool.install', tool: 'jq' },
    })
  })

  it('formats policy list/explain and mutates rules helpers', () => {
    const listed = __mainTestOnly.formatPolicyListHuman({
      paths: { globalRulesPath: '/g', projectRulesPath: '/p' },
      globalRulesLoaded: true,
      projectRulesLoaded: false,
      rules: [
        { ruleId: 'r1', scope: 'global', decision: 'allow', match: { any: true }, enabled: false, reason: 'test' },
        { scope: 'project', decision: 'ask', match: { any: false } },
      ],
      warnings: ['w'],
    } as any)
    expect(listed).toContain('[disabled]')
    expect(listed).toContain('— test')
    expect(listed).toContain('Warnings:')

    const listedEmpty = __mainTestOnly.formatPolicyListHuman({
      paths: { globalRulesPath: '/g', projectRulesPath: '/p' },
      globalRulesLoaded: false,
      projectRulesLoaded: true,
      rules: [],
      warnings: [],
    } as any)
    expect(listedEmpty).toContain('Rules: 0')

    const explained = __mainTestOnly.formatPolicyExplainHuman({
      action: { kind: 'fs.read', path: '/a' },
      decision: 'deny',
      matchedRule: { ruleId: 'r1', scope: 'global', decision: 'deny', reason: 'why' },
      suggestions: ['s1'],
      warnings: ['w'],
    } as any)
    expect(explained).toContain('Matched rule:')
    expect(explained).toContain('Suggestions:')
    expect(explained).toContain('Warnings:')

    const explainedMinimal = __mainTestOnly.formatPolicyExplainHuman({
      action: { kind: 'fs.read', path: '/a' },
      decision: 'allow',
      suggestions: [],
      warnings: [],
    } as any)
    expect(explainedMinimal).not.toContain('Matched rule:')

    const rules = [
      { ruleId: 'r1', enabled: true },
      { ruleId: 'r2', enabled: false },
      { ruleId: 'r3' },
    ] as any
    const disabled = __mainTestOnly.setRuleEnabled(rules, 'r1', false)
    expect(disabled.changedCount).toBe(1)
    expect((disabled.rules[0] as any).enabled).toBe(false)
    const noChange = __mainTestOnly.setRuleEnabled(rules, 'r2', false)
    expect(noChange.changedCount).toBe(0)
    const changedFromDefault = __mainTestOnly.setRuleEnabled(rules, 'r3', false)
    expect(changedFromDefault.changedCount).toBe(1)
    const deleted = __mainTestOnly.deleteRule(rules, 'r1')
    expect(deleted.changedCount).toBe(1)
    const deletedNone = __mainTestOnly.deleteRule(rules, 'missing')
    expect(deletedNone.changedCount).toBe(0)
    expect(__mainTestOnly.getPolicyInputRules(undefined)).toEqual([])
    expect(__mainTestOnly.getPolicyInputRules(null)).toEqual([])
    expect(__mainTestOnly.getPolicyInputRules({ rules: [{ ruleId: 'x' } as any] })).toEqual([{ ruleId: 'x' }])
  })
})
