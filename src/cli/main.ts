import os from 'node:os'
import type { FileStore } from '../adapters/fs/fileStore.js'
import { checkWritableDir } from '../adapters/fs/checkWritableDir.js'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { getConfigPaths } from '../adapters/fs/configPaths.js'
import { testSetupConnection } from '../adapters/setup/connectionTest.js'
import { authDelete, authList, authSet } from '../core/auth/index.js'
import type { ProviderId } from '../core/config/schema.js'
import { ProviderIdSchema } from '../core/config/schema.js'
import { configMigrate } from '../core/config/migrate.js'
import { configShow } from '../core/config/show.js'
import { runDoctor } from '../core/diagnostics/doctor.js'
import { formatDoctorHuman } from '../core/diagnostics/format.js'
import type { ConnectionTestResult } from '../core/setup/types.js'
import { loadRuntimeConfig } from '../env/config.js'
import { parseCliArgs } from './args.js'
import { ExitCode } from './exitCodes.js'
import { formatCliHelp } from './help.js'
import type { JsonEnvelope } from './json.js'
import { toJson } from './json.js'
import pkg from '../../package.json'

export type CliDispatchResult =
  | { kind: 'repl' }
  | { kind: 'handled'; exitCode: number; stdout: string; stderr: string }

type ConnectionTester = (args: { provider: ProviderId; baseUrl: string; apiKey: string }) => Promise<ConnectionTestResult>

function okJson(command: string, data: unknown, warnings: string[] = [], meta?: Record<string, unknown>): string {
  const envelope: JsonEnvelope = {
    schemaVersion: 1,
    command,
    ok: true,
    data,
    warnings: warnings.length ? warnings : undefined,
    meta,
  }
  return toJson(envelope)
}

function errJson(command: string, message: string, warnings: string[] = [], meta?: Record<string, unknown>): string {
  const envelope: JsonEnvelope = {
    schemaVersion: 1,
    command,
    ok: false,
    error: { message },
    warnings: warnings.length ? warnings : undefined,
    meta,
  }
  return toJson(envelope)
}

function formatConfigShowHuman(res: Awaited<ReturnType<typeof configShow>>): string {
  const lines: string[] = []
  lines.push(`Global config dir: ${res.paths.globalConfigDir}`)
  lines.push(`Project config dir: ${res.paths.projectConfigDir}`)
  lines.push(`Legacy config dir: ${res.paths.legacyConfigDir}`)
  lines.push('')

  lines.push('Loaded:')
  lines.push(`- global config: ${res.files.globalConfigLoaded ? 'yes' : 'no'} (${res.paths.globalConfigPath})`)
  lines.push(`- project config: ${res.files.projectConfigLoaded ? 'yes' : 'no'} (${res.paths.projectConfigPath})`)
  lines.push(`- auth store: ${res.files.authStoreLoaded ? 'yes' : 'no'} (${res.paths.globalAuthPath})`)
  lines.push(`- global rules: ${res.files.globalRulesLoaded ? 'yes' : 'no'} (${res.paths.globalRulesPath})`)
  lines.push(`- project rules: ${res.files.projectRulesLoaded ? 'yes' : 'no'} (${res.paths.projectRulesPath})`)
  lines.push('')

  lines.push('Effective config:')
  lines.push(`- llm.provider: ${res.config.llm.provider} (source: ${res.sources['llm.provider'] ?? 'unknown'})`)
  lines.push(`- llm.baseUrl: ${res.config.llm.baseUrl} (source: ${res.sources['llm.baseUrl'] ?? 'unknown'})`)
  lines.push(`- llm.model: ${res.config.llm.model} (source: ${res.sources['llm.model'] ?? 'unknown'})`)
  lines.push(`- llm.timeoutMs: ${res.config.llm.timeoutMs} (source: ${res.sources['llm.timeoutMs'] ?? 'unknown'})`)
  lines.push(`- llm.authRef: ${res.config.llm.authRef} (source: ${res.sources['llm.authRef'] ?? 'unknown'})`)
  lines.push(`- ui.promptProfile: ${res.config.ui.promptProfile} (source: ${res.sources['ui.promptProfile'] ?? 'unknown'})`)
  lines.push(`- ui.assistantTextMode: ${res.config.ui.assistantTextMode} (source: ${res.sources['ui.assistantTextMode'] ?? 'unknown'})`)
  lines.push(`- paths.logsDir: ${res.config.paths.logsDir} (source: ${res.sources['paths.logsDir'] ?? 'unknown'})`)
  lines.push(`- paths.subagentsDir: ${res.config.paths.subagentsDir} (source: ${res.sources['paths.subagentsDir'] ?? 'unknown'})`)
  lines.push(`- paths.planDir: ${res.config.paths.planDir} (source: ${res.sources['paths.planDir'] ?? 'unknown'})`)
  lines.push('')

  lines.push('Auth:')
  if (!res.auth) lines.push('- none')
  else {
    lines.push(`- provider: ${res.auth.provider}`)
    lines.push(`- authRef: ${res.auth.authRef}`)
    lines.push(`- source: ${res.auth.source}`)
  }

  if (res.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of res.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n') + '\n'
}

function formatConfigMigrateHuman(res: Awaited<ReturnType<typeof configMigrate>>): string {
  const lines: string[] = []
  lines.push(`Legacy config dir: ${res.paths.legacyConfigDir}`)
  lines.push(`Global config dir: ${res.paths.globalConfigDir}`)
  lines.push('')

  if (!res.actions.length) {
    lines.push('Nothing to migrate.')
  } else {
    lines.push('Migration:')
    for (const action of res.actions) {
      lines.push(`- ${action.label}: ${action.status}`)
      if (action.status === 'copied') lines.push(`  ${action.fromPath} -> ${action.toPath}`)
      if (action.status === 'skipped') lines.push(`  exists: ${action.toPath}`)
      if (action.status === 'missing') lines.push(`  missing: ${action.fromPath}`)
      if (action.status === 'error') lines.push(`  error: ${action.error || 'unknown'}`)
    }
  }

  if (res.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of res.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n') + '\n'
}

function formatStatusHuman(args: { version: string; cwd: string; res: Awaited<ReturnType<typeof configShow>> }): string {
  const { res } = args
  const lines: string[] = []
  lines.push(`Formax v${args.version}`)
  lines.push(`CWD: ${args.cwd}`)
  lines.push('')

  lines.push('LLM:')
  lines.push(`- provider: ${res.config.llm.provider} (source: ${res.sources['llm.provider'] ?? 'unknown'})`)
  lines.push(`- baseUrl: ${res.config.llm.baseUrl} (source: ${res.sources['llm.baseUrl'] ?? 'unknown'})`)
  lines.push(`- model: ${res.config.llm.model} (source: ${res.sources['llm.model'] ?? 'unknown'})`)
  lines.push(`- timeoutMs: ${res.config.llm.timeoutMs} (source: ${res.sources['llm.timeoutMs'] ?? 'unknown'})`)
  lines.push('')

  lines.push('Auth:')
  if (!res.auth) lines.push('- present: no')
  else {
    lines.push('- present: yes')
    lines.push(`- provider: ${res.auth.provider}`)
    lines.push(`- authRef: ${res.auth.authRef}`)
    lines.push(`- source: ${res.auth.source}`)
  }
  lines.push('')

  lines.push('Config dirs:')
  lines.push(`- global: ${res.paths.globalConfigDir}`)
  lines.push(`- project: ${res.paths.projectConfigDir}`)
  lines.push(`- legacy: ${res.paths.legacyConfigDir}`)

  if (res.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of res.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n') + '\n'
}

function formatAuthListHuman(res: Awaited<ReturnType<typeof authList>>): string {
  if (!res.items.length) return `No auth entries found (${res.authPath}).\n`

  const lines: string[] = []
  lines.push(`Auth store: ${res.authPath}`)
  for (const item of res.items) lines.push(`- ${item.provider}:${item.authRef}`)
  if (res.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of res.warnings) lines.push(`- ${w}`)
  }
  return lines.join('\n') + '\n'
}

function normalizeProvider(raw: string): ProviderId {
  const res = ProviderIdSchema.safeParse(String(raw || '').trim())
  if (!res.success) throw new Error(`Invalid provider: ${raw}`)
  return res.data
}

function ensureFileStore(args: { fileStore?: FileStore }): FileStore {
  return args.fileStore ?? createNodeFileStore()
}

export async function dispatchCli(
  argv: string[],
  opts: {
    env?: NodeJS.ProcessEnv
    cwd?: string
    fileStore?: FileStore
    homedir?: string
    platform?: string
    testConnection?: ConnectionTester
  } = {},
): Promise<CliDispatchResult> {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  const platform = opts.platform ?? process.platform
  const homedir = opts.homedir ?? os.homedir()
  const store = ensureFileStore({ fileStore: opts.fileStore })

  const parsed = parseCliArgs(argv)
  const args = parsed.positionals
  const flags = parsed.flags

  if (flags.help) {
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatCliHelp(), stderr: '' }
  }

  if (args.length === 0 || args[0] === 'repl') return { kind: 'repl' }

  if (args[0] === 'help') {
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatCliHelp(), stderr: '' }
  }

  const unimplemented = (command: string): CliDispatchResult => {
    const message = `Command "${command}" is not implemented yet.`
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Error, stdout: errJson(command, message), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Error, stdout: message + '\n', stderr: '' }
  }

  if (args[0] === 'status') {
    const res = await configShow({ fileStore: store, cwd, env, platform, homedir })
    const version = String((pkg as any)?.version || 'unknown')
    const { warnings, ...data } = res

    if (flags.json) {
      return {
        kind: 'handled',
        exitCode: ExitCode.Ok,
        stdout: okJson('status', { version, cwd, ...data }, warnings),
        stderr: '',
      }
    }

    return {
      kind: 'handled',
      exitCode: ExitCode.Ok,
      stdout: formatStatusHuman({ version, cwd, res }),
      stderr: '',
    }
  }
  if (args[0] === 'doctor') {
    const version = String((pkg as any)?.version || 'unknown')
    const testConnection = opts.testConnection ?? testSetupConnection

    const [shown, runtime] = await Promise.all([
      configShow({ fileStore: store, cwd, env, platform, homedir }),
      loadRuntimeConfig(env, cwd, { fileStore: store, platform, homedir }),
    ])

    const report = await runDoctor({
      version,
      cwd,
      provider: shown.config.llm.provider,
      runtime: {
        llm: { apiKey: runtime.llm.apiKey, baseUrl: runtime.llm.baseUrl, model: runtime.llm.model },
        paths: runtime.paths,
      },
      config: { paths: shown.paths, files: shown.files },
      warnings: shown.warnings,
      testConnection,
      checkWritableDir,
    })

    const failed = report.checks.some((c) => c.status === 'fail')
    const data = { version: report.version, cwd: report.cwd, checks: report.checks }

    if (flags.json) {
      return {
        kind: 'handled',
        exitCode: failed ? ExitCode.Error : ExitCode.Ok,
        stdout: okJson('doctor', data, report.warnings),
        stderr: '',
      }
    }

    return {
      kind: 'handled',
      exitCode: failed ? ExitCode.Error : ExitCode.Ok,
      stdout: formatDoctorHuman({ version: report.version, cwd: report.cwd, checks: report.checks, warnings: report.warnings }) + '\n',
      stderr: '',
    }
  }
  if (args[0] === 'setup') {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('setup', '--json is not supported for interactive setup'), stderr: '' }
    process.env.FORMAX_FORCE_SETUP = '1'
    return { kind: 'repl' }
  }
  if (args[0] === 'policy') return unimplemented('policy')

  if (args[0] === 'config' && !args[1]) {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('config', 'Missing subcommand'), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (args[0] === 'config' && args[1] === 'show') {
    const res = await configShow({ fileStore: store, cwd, env, platform, homedir })
    if (flags.json) {
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('config show', res, res.warnings), stderr: '' }
    }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatConfigShowHuman(res), stderr: '' }
  }

  if (args[0] === 'config' && args[1] === 'migrate') {
    const res = await configMigrate({ fileStore: store, cwd, env, platform, homedir })
    if (flags.json) {
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('config migrate', res, res.warnings), stderr: '' }
    }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatConfigMigrateHuman(res), stderr: '' }
  }

  if (args[0] === 'config') {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('config', 'Unknown subcommand'), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (args[0] === 'auth' && !args[1]) {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('auth', 'Missing subcommand'), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (args[0] === 'auth' && args[1] === 'list') {
    const paths = getConfigPaths({ cwd, env, platform, homedir })
    const res = await authList({ fileStore: store, authPath: paths.globalAuthPath })
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('auth list', res, res.warnings), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatAuthListHuman(res), stderr: '' }
  }

  if (args[0] === 'auth' && args[1] === 'set') {
    try {
      const provider = normalizeProvider(args[2])
      const authRef = args[3]
      const apiKey = args[4]
      const paths = getConfigPaths({ cwd, env, platform, homedir })
      const res = await authSet({ fileStore: store, authPath: paths.globalAuthPath, provider, authRef, apiKey })
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('auth set', res, res.warnings), stderr: '' }
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: `Saved ${res.provider}:${res.authRef} to ${res.authPath}\n`, stderr: '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('auth set', message), stderr: '' }
      return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: `Error: ${message}\n` + formatCliHelp() }
    }
  }

  if (args[0] === 'auth' && args[1] === 'delete') {
    try {
      const provider = normalizeProvider(args[2])
      const authRef = args[3]
      const paths = getConfigPaths({ cwd, env, platform, homedir })
      const res = await authDelete({ fileStore: store, authPath: paths.globalAuthPath, provider, authRef })
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('auth delete', res, res.warnings), stderr: '' }
      return {
        kind: 'handled',
        exitCode: ExitCode.Ok,
        stdout: res.deleted ? `Deleted ${res.provider}:${res.authRef}\n` : `Not found: ${res.provider}:${res.authRef}\n`,
        stderr: '',
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('auth delete', message), stderr: '' }
      return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: `Error: ${message}\n` + formatCliHelp() }
    }
  }

  if (args[0] === 'auth') {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('auth', 'Unknown subcommand'), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (flags.json) {
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('unknown', 'Unknown command'), stderr: '' }
  }
  return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: `Unknown command.\n\n` + formatCliHelp() }
}
