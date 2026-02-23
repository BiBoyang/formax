import os from 'node:os'
import path from 'node:path'
import type { FileStore } from '../adapters/fs/fileStore.js'
import { checkWritableDir } from '../adapters/fs/checkWritableDir.js'
import { createNodeFileStore } from '../adapters/fs/nodeFileStore.js'
import { testSetupConnection } from '../adapters/setup/connectionTest.js'
import { authDelete, authList, authSet } from '../core/auth/index.js'
import type { ProviderId } from '../core/config/schema.js'
import { ProviderIdSchema } from '../core/config/schema.js'
import { configMigrate } from '../core/config/migrate.js'
import { configShow } from '../core/config/show.js'
import { createDebugBundle } from '../core/diagnostics/debugBundle.js'
import { runDoctor } from '../core/diagnostics/doctor.js'
import { formatDoctorHuman, formatStatusHuman } from '../core/diagnostics/format.js'
import { createStatusSnapshot } from '../core/diagnostics/status.js'
import { createTarGz } from '../adapters/diagnostics/nodeArchive.js'
import { detectWorkspaceRoots } from '../adapters/fs/workspaceRoots.js'
import { explainPolicy } from '../core/policy/engine.js'
import type { PolicyRule } from '../core/policy/schema.js'
import { loadPolicyRules, savePolicyRules } from '../core/policy/store.js'
import type { PolicyAction } from '../core/policy/types.js'
import type { ConnectionTestResult } from '../core/setup/types.js'
import { loadRuntimeConfig } from '../env/config.js'
import { getConfigPaths } from '../env/configPaths.js'
import { parseCliArgs } from './args.js'
import { ExitCode } from './exitCodes.js'
import { formatCliHelp } from './help.js'
import type { JsonEnvelope } from './json.js'
import { toJson } from './json.js'
import { formatServeCommandHelp, parseServeCommandArgs, type ServeCommandOptions } from '../serve/command.js'
import { formatWebCommandHelp, parseWebCommandArgs } from '../web/command.js'
import pkg from '../../package.json'

export type CliDispatchResult =
  | { kind: 'repl' }
  | { kind: 'app-server' }
  | { kind: 'serve'; options: ServeCommandOptions }
  | { kind: 'web'; options: { host: string; uiPort: number; bridgePort: number } }
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

function getFlagValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag)
  if (idx < 0) return null
  const value = args[idx + 1]
  return value == null ? null : String(value)
}

function parsePolicyActionFromArgs(args: string[]): { action: PolicyAction } | { error: string } {
  const kind = getFlagValue(args, '--action')
  if (!kind) return { error: 'Missing --action' }

  switch (kind) {
    case 'bash.exec': {
      const cmd = getFlagValue(args, '--cmd')
      if (!cmd) return { error: 'Missing --cmd for bash.exec' }
      return { action: { kind: 'bash.exec', command: cmd } }
    }
    case 'fs.read': {
      const path = getFlagValue(args, '--path')
      if (!path) return { error: 'Missing --path for fs.read' }
      return { action: { kind: 'fs.read', path } }
    }
    case 'fs.write': {
      const path = getFlagValue(args, '--path')
      if (!path) return { error: 'Missing --path for fs.write' }
      return { action: { kind: 'fs.write', path } }
    }
    case 'net.fetch': {
      const url = getFlagValue(args, '--url')
      if (!url) return { error: 'Missing --url for net.fetch' }
      return { action: { kind: 'net.fetch', url } }
    }
    case 'net.search': {
      const query = getFlagValue(args, '--query')
      if (!query) return { error: 'Missing --query for net.search' }
      return { action: { kind: 'net.search', query } }
    }
    case 'tool.install': {
      const tool = getFlagValue(args, '--tool')
      if (!tool) return { error: 'Missing --tool for tool.install' }
      return { action: { kind: 'tool.install', tool } }
    }
    default:
      return { error: `Invalid --action: ${kind}` }
  }
}

function formatPolicyListHuman(args: {
  paths: { globalRulesPath: string; projectRulesPath: string }
  globalRulesLoaded: boolean
  projectRulesLoaded: boolean
  rules: PolicyRule[]
  warnings: string[]
}): string {
  const lines: string[] = []
  lines.push(`Global rules: ${args.globalRulesLoaded ? 'loaded' : 'missing'} (${args.paths.globalRulesPath})`)
  lines.push(`Project rules: ${args.projectRulesLoaded ? 'loaded' : 'missing'} (${args.paths.projectRulesPath})`)
  lines.push(`Rules: ${args.rules.length}`)

  if (args.rules.length) {
    lines.push('')
    for (const rule of args.rules) {
      const enabled = rule.enabled ?? true
      const disabled = enabled ? '' : ' [disabled]'
      const reason = rule.reason ? ` — ${rule.reason}` : ''
      lines.push(`- ${rule.ruleId ?? '(missing ruleId)'} (${rule.scope}) ${rule.decision}${disabled}${reason}`)
      lines.push(`  match: ${JSON.stringify(rule.match)}`)
    }
  }

  if (args.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of args.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n') + '\n'
}

function formatPolicyExplainHuman(args: { action: PolicyAction; decision: string; matchedRule?: any; suggestions: string[]; warnings: string[] }): string {
  const lines: string[] = []
  lines.push(`Decision: ${args.decision}`)
  lines.push(`Action: ${JSON.stringify(args.action)}`)

  if (args.matchedRule) {
    lines.push('')
    lines.push('Matched rule:')
    lines.push(`- ruleId: ${args.matchedRule.ruleId}`)
    lines.push(`  scope: ${args.matchedRule.scope}`)
    lines.push(`  decision: ${args.matchedRule.decision}`)
    if (args.matchedRule.reason) lines.push(`  reason: ${args.matchedRule.reason}`)
  }

  if (args.suggestions.length) {
    lines.push('')
    lines.push('Suggestions:')
    for (const s of args.suggestions) lines.push(`- ${s}`)
  }

  if (args.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of args.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n') + '\n'
}

function setRuleEnabled(rules: PolicyRule[], ruleId: string, enabled: boolean): { rules: PolicyRule[]; changedCount: number } {
  let changedCount = 0
  const updated = rules.map((rule) => {
    if (rule.ruleId !== ruleId) return rule
    if ((rule.enabled ?? true) === enabled) return rule
    changedCount += 1
    return { ...rule, enabled }
  })
  return { rules: updated, changedCount }
}

function deleteRule(rules: PolicyRule[], ruleId: string): { rules: PolicyRule[]; changedCount: number } {
  const next = rules.filter((r) => r.ruleId !== ruleId)
  return { rules: next, changedCount: rules.length - next.length }
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
    tarGz?: (args: { sourceDir: string; outPath: string }) => Promise<void>
  } = {},
): Promise<CliDispatchResult> {
  const env = opts.env ?? process.env
  const cwd = opts.cwd ?? process.cwd()
  const platform = opts.platform ?? process.platform
  const homedir = opts.homedir ?? os.homedir()
  const store = ensureFileStore({ fileStore: opts.fileStore })
  const configPaths = getConfigPaths({ cwd, env, platform, homedir })

  const parsed = parseCliArgs(argv)
  const args = parsed.positionals
  const flags = parsed.flags

  if (flags.version) {
    const version = String((pkg as any)?.version || 'unknown')
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('version', { version }), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: version + '\n', stderr: '' }
  }

  if (flags.help && args[0] !== 'web' && args[0] !== 'serve') {
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatCliHelp(), stderr: '' }
  }

  if (args.length === 0 || args[0] === 'repl') return { kind: 'repl' }
  if (args[0] === 'serve') {
    if (flags.help) {
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatServeCommandHelp(), stderr: '' }
    }

    if (flags.json) {
      return {
        kind: 'handled',
        exitCode: ExitCode.Usage,
        stdout: errJson('serve', '--json is not supported for this command'),
        stderr: '',
      }
    }

    const parsedServe = parseServeCommandArgs(args.slice(1))
    if (!parsedServe.ok) {
      const parseError = parsedServe as { ok: false; message: string }
      if (parseError.message === '__HELP__') {
        return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatServeCommandHelp(), stderr: '' }
      }
      return {
        kind: 'handled',
        exitCode: ExitCode.Usage,
        stdout: '',
        stderr: `${parseError.message}\n\n${formatServeCommandHelp()}`,
      }
    }

    return { kind: 'serve', options: parsedServe.options }
  }
  if (args[0] === 'web') {
    if (flags.help) {
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatWebCommandHelp(), stderr: '' }
    }

    if (flags.json) {
      return {
        kind: 'handled',
        exitCode: ExitCode.Usage,
        stdout: errJson('web', '--json is not supported for this command'),
        stderr: '',
      }
    }

    const parsedWeb = parseWebCommandArgs(args.slice(1))
    if (!parsedWeb.ok) {
      const parseError = parsedWeb as { ok: false; message: string }
      if (parseError.message === '__HELP__') {
        return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatWebCommandHelp(), stderr: '' }
      }
      return {
        kind: 'handled',
        exitCode: ExitCode.Usage,
        stdout: '',
        stderr: `${parseError.message}\n\n${formatWebCommandHelp()}`,
      }
    }

    return { kind: 'web', options: parsedWeb.options }
  }
  if (args[0] === 'app-server') return { kind: 'app-server' }

  if (args[0] === 'help') {
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatCliHelp(), stderr: '' }
  }

  if (args[0] === 'version') {
    const version = String((pkg as any)?.version || 'unknown')
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('version', { version }), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: version + '\n', stderr: '' }
  }

  const unimplemented = (command: string): CliDispatchResult => {
    const message = `Command "${command}" is not implemented yet.`
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Error, stdout: errJson(command, message), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Error, stdout: message + '\n', stderr: '' }
  }

  if (args[0] === 'status') {
    const version = String((pkg as any)?.version || 'unknown')
    const [shown, runtime, roots] = await Promise.all([
      configShow({ fileStore: store, paths: configPaths, cwd, env, platform, homedir }),
      loadRuntimeConfig(env, cwd, { fileStore: store, platform, homedir }),
      detectWorkspaceRoots({ fileStore: store, cwd }),
    ])

    const baseSnapshot = createStatusSnapshot({
      version,
      cwd,
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
      workspaceRoots: roots.workspaceRoots,
    })
    const snapshot = { ...baseSnapshot, warnings: [...baseSnapshot.warnings, ...roots.warnings] }
    const { warnings, ...data } = snapshot

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
      stdout: formatStatusHuman(snapshot) + '\n',
      stderr: '',
    }
  }
  if (args[0] === 'doctor') {
    const version = String((pkg as any)?.version || 'unknown')
    const testConnection = opts.testConnection ?? testSetupConnection
    const wantsBundle = flags.bundle
    const wantsBundleTar = flags.bundleTar

    const [shown, runtime, roots] = await Promise.all([
      configShow({ fileStore: store, paths: configPaths, cwd, env, platform, homedir }),
      loadRuntimeConfig(env, cwd, { fileStore: store, platform, homedir }),
      detectWorkspaceRoots({ fileStore: store, cwd }),
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

    let bundle: { dir: string; manifestPath: string; archivePath?: string } | null = null
    const bundleWarnings: string[] = []

    if (wantsBundle) {
      try {
        const policy = await loadPolicyRules({ fileStore: store, cwd, env, platform, homedir })
        const baseStatus = createStatusSnapshot({
          version,
          cwd,
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
          workspaceRoots: roots.workspaceRoots,
        })
        const status = { ...baseStatus, warnings: [...baseStatus.warnings, ...roots.warnings] }

        const createdAt = new Date().toISOString()
        const safeStamp = createdAt.replace(/[:.]/g, '-')
        const bundleDir = path.join(runtime.paths.logsDir, 'bundles', `doctor-bundle-${safeStamp}`)
        const res = await createDebugBundle({
          fileStore: store,
          bundleDir,
          version,
          cwd,
          platform,
          nodeVersion: process.version,
          shown,
          status,
          doctor: report,
          policy,
          logsDir: runtime.paths.logsDir,
        })

        bundle = { dir: res.bundleDir, manifestPath: res.manifestPath }
        bundleWarnings.push(...res.warnings)

        if (wantsBundleTar) {
          try {
            const archivePath = `${bundleDir}.tgz`
            const tarImpl = opts.tarGz ?? createTarGz
            await tarImpl({ sourceDir: bundleDir, outPath: archivePath })
            bundle.archivePath = archivePath
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            bundleWarnings.push(`Failed to create bundle archive: ${msg}`)
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        bundleWarnings.push(`Failed to write debug bundle: ${msg}`)
      }
    }

    const data = {
      version: report.version,
      cwd: report.cwd,
      checks: report.checks,
      ...(bundle ? { bundle } : {}),
    }

    if (flags.json) {
      return {
        kind: 'handled',
        exitCode: failed ? ExitCode.Error : ExitCode.Ok,
        stdout: okJson('doctor', data, [...report.warnings, ...bundleWarnings]),
        stderr: '',
      }
    }

    return {
      kind: 'handled',
      exitCode: failed ? ExitCode.Error : ExitCode.Ok,
      stdout:
        formatDoctorHuman({
          version: report.version,
          cwd: report.cwd,
          checks: report.checks,
          warnings: [...report.warnings, ...bundleWarnings],
        }) +
        (bundle ? `\nDebug bundle: ${bundle.dir}\n` : '') +
        (bundle?.archivePath ? `Debug bundle archive: ${bundle.archivePath}\n` : '') +
        '\n',
      stderr: '',
    }
  }
  if (args[0] === 'setup') {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('setup', '--json is not supported for interactive setup'), stderr: '' }
    return { kind: 'repl' }
  }
  if (args[0] === 'policy') {
    const sub = args[1]
    if (!sub) {
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('policy', 'Missing subcommand'), stderr: '' }
      return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
    }

    if (sub === 'list') {
      const res = await loadPolicyRules({ fileStore: store, cwd, env, platform, homedir })
      const data = { paths: res.paths, rules: res.mergedRules }
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('policy list', data, res.warnings), stderr: '' }
      return {
        kind: 'handled',
        exitCode: ExitCode.Ok,
        stdout: formatPolicyListHuman({
          paths: res.paths,
          globalRulesLoaded: Boolean(res.globalRules),
          projectRulesLoaded: Boolean(res.projectRules),
          rules: res.mergedRules,
          warnings: res.warnings,
        }),
        stderr: '',
      }
    }

    if (sub === 'explain') {
      const parsedAction = parsePolicyActionFromArgs(args)
      if ('error' in parsedAction) {
        if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('policy explain', parsedAction.error), stderr: '' }
        return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: `Error: ${parsedAction.error}\n\n` + formatCliHelp() }
      }

      const res = await loadPolicyRules({ fileStore: store, cwd, env, platform, homedir })
      const explained = explainPolicy({ action: parsedAction.action, rules: res.mergedRules })
      const data = { action: parsedAction.action, ...explained }
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('policy explain', data, res.warnings), stderr: '' }
      return {
        kind: 'handled',
        exitCode: ExitCode.Ok,
        stdout: formatPolicyExplainHuman({
          action: parsedAction.action,
          decision: explained.decision,
          matchedRule: explained.matchedRule,
          suggestions: explained.suggestions,
          warnings: res.warnings,
        }),
        stderr: '',
      }
    }

    if (sub === 'test') {
      const bash = getFlagValue(args, '--bash')
      const parsedAction = bash ? ({ action: { kind: 'bash.exec', command: bash } } as const) : parsePolicyActionFromArgs(args)

      if ('error' in parsedAction) {
        if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('policy test', parsedAction.error), stderr: '' }
        return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: `Error: ${parsedAction.error}\n\n` + formatCliHelp() }
      }

      const res = await loadPolicyRules({ fileStore: store, cwd, env, platform, homedir })
      const explained = explainPolicy({ action: parsedAction.action, rules: res.mergedRules })
      const data = { action: parsedAction.action, ...explained }
      const exitCode = explained.decision === 'allow' ? ExitCode.Ok : ExitCode.Error
      if (flags.json) return { kind: 'handled', exitCode, stdout: okJson('policy test', data, res.warnings), stderr: '' }
      return {
        kind: 'handled',
        exitCode,
        stdout: formatPolicyExplainHuman({
          action: parsedAction.action,
          decision: explained.decision,
          matchedRule: explained.matchedRule,
          suggestions: explained.suggestions,
          warnings: res.warnings,
        }),
        stderr: '',
      }
    }

	    if (sub === 'disable' || sub === 'delete') {
	      const ruleId = args[2]
	      if (!ruleId) {
	        if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson(`policy ${sub}`, 'Missing ruleId'), stderr: '' }
	        return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
	      }

	      const loaded = await loadPolicyRules({ fileStore: store, cwd, env, platform, homedir })
	      const updates: { scope: 'global' | 'project'; filePath: string; changedCount: number }[] = []

	      try {
	        if (loaded.projectRules) {
	          const inputRules = loaded.projectRules.rules ?? []
	          const hadRule = inputRules.some((r) => r.ruleId === ruleId)
	          const changed =
	            sub === 'disable' ? setRuleEnabled(inputRules, ruleId, false) : deleteRule(inputRules, ruleId)
	          if (changed.changedCount > 0) {
	            const saved = await savePolicyRules({
	              fileStore: store,
	              scope: 'project',
	              rules: changed.rules,
	              cwd,
	              env,
	              platform,
	              homedir,
	            })
	            updates.push({ scope: 'project', filePath: saved.filePath, changedCount: changed.changedCount })
	          } else if (sub === 'disable' && hadRule) {
	            updates.push({ scope: 'project', filePath: loaded.paths.projectRulesPath, changedCount: 0 })
	          }
	        }

	        if (loaded.globalRules) {
	          const inputRules = loaded.globalRules.rules ?? []
	          const hadRule = inputRules.some((r) => r.ruleId === ruleId)
	          const changed =
	            sub === 'disable' ? setRuleEnabled(inputRules, ruleId, false) : deleteRule(inputRules, ruleId)
	          if (changed.changedCount > 0) {
	            const saved = await savePolicyRules({
	              fileStore: store,
	              scope: 'global',
	              rules: changed.rules,
	              cwd,
	              env,
	              platform,
	              homedir,
	            })
	            updates.push({ scope: 'global', filePath: saved.filePath, changedCount: changed.changedCount })
	          } else if (sub === 'disable' && hadRule) {
	            updates.push({ scope: 'global', filePath: loaded.paths.globalRulesPath, changedCount: 0 })
	          }
	        }
	      } catch (err) {
	        const message = err instanceof Error ? err.message : String(err)
	        if (flags.json) return { kind: 'handled', exitCode: ExitCode.Error, stdout: errJson(`policy ${sub}`, message, loaded.warnings), stderr: '' }
        return { kind: 'handled', exitCode: ExitCode.Error, stdout: '', stderr: `Error: ${message}\n` }
      }

      if (!updates.length) {
        const message = `Rule not found: ${ruleId}`
        if (flags.json) return { kind: 'handled', exitCode: ExitCode.Error, stdout: errJson(`policy ${sub}`, message, loaded.warnings), stderr: '' }
        return { kind: 'handled', exitCode: ExitCode.Error, stdout: '', stderr: `Error: ${message}\n` }
      }

      const data = { ruleId, updates }
      if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson(`policy ${sub}`, data, loaded.warnings), stderr: '' }

      const lines: string[] = []
      lines.push(`${sub === 'disable' ? 'Disabled' : 'Deleted'} ${ruleId}`)
      for (const u of updates) lines.push(`- ${u.scope}: ${u.changedCount} (${u.filePath})`)
      if (loaded.warnings.length) {
        lines.push('')
        lines.push('Warnings:')
        for (const w of loaded.warnings) lines.push(`- ${w}`)
      }
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: lines.join('\n') + '\n', stderr: '' }
    }

    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('policy', `Unknown subcommand: ${sub}`), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (args[0] === 'config' && !args[1]) {
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Usage, stdout: errJson('config', 'Missing subcommand'), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Usage, stdout: '', stderr: formatCliHelp() }
  }

  if (args[0] === 'config' && args[1] === 'show') {
    const res = await configShow({ fileStore: store, paths: configPaths, cwd, env, platform, homedir })
    if (flags.json) {
      return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('config show', res, res.warnings), stderr: '' }
    }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatConfigShowHuman(res), stderr: '' }
  }

  if (args[0] === 'config' && args[1] === 'migrate') {
    const res = await configMigrate({ fileStore: store, paths: configPaths, cwd, env, platform, homedir })
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
    const res = await authList({ fileStore: store, authPath: configPaths.globalAuthPath })
    if (flags.json) return { kind: 'handled', exitCode: ExitCode.Ok, stdout: okJson('auth list', res, res.warnings), stderr: '' }
    return { kind: 'handled', exitCode: ExitCode.Ok, stdout: formatAuthListHuman(res), stderr: '' }
  }

  if (args[0] === 'auth' && args[1] === 'set') {
    try {
      const provider = normalizeProvider(args[2])
      const authRef = args[3]
      const apiKey = args[4]
      const res = await authSet({ fileStore: store, authPath: configPaths.globalAuthPath, provider, authRef, apiKey })
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
      const res = await authDelete({ fileStore: store, authPath: configPaths.globalAuthPath, provider, authRef })
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
