import type { ProviderId } from '../config/schema.js'
import { ErrorCode } from '../errors/codes.js'
import type { ErrorCode as ErrorCodeValue } from '../errors/codes.js'
import type { ConnectionTestResult } from '../setup/types.js'

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail'

export type DoctorCheck = {
  id: string
  status: DoctorCheckStatus
  title: string
  message: string
  hint?: string
  code?: ErrorCodeValue
}

export type DoctorReport = {
  version: string
  cwd: string
  checks: DoctorCheck[]
  warnings: string[]
}

export type DoctorConfigContext = {
  paths: {
    globalConfigDir: string
    legacyConfigDir: string
    projectConfigDir: string
    globalConfigPath: string
    globalAuthPath: string
    globalRulesPath: string
    projectConfigPath: string
    projectRulesPath: string
  }
  files: {
    globalConfigLoaded: boolean
    projectConfigLoaded: boolean
    authStoreLoaded: boolean
    globalRulesLoaded: boolean
    projectRulesLoaded: boolean
  }
}

export type ConnectionTester = (args: { provider: ProviderId; baseUrl: string; apiKey: string }) => Promise<ConnectionTestResult>
export type WritableDirChecker = (dirPath: string) => Promise<{ ok: true } | { ok: false; error: string }>

function findWarning(warnings: string[], needle: string): string | null {
  for (const w of warnings) {
    if (w.includes(needle)) return w
  }
  return null
}

function pushConfigFileCheck(args: {
  checks: DoctorCheck[]
  warnings: string[]
  id: string
  title: string
  filePath: string
  loaded: boolean
  missingHint: string
}): void {
  if (args.loaded) {
    args.checks.push({ id: args.id, status: 'pass', title: args.title, message: args.filePath })
    return
  }

  const warning = findWarning(args.warnings, args.filePath)
  if (warning) {
    args.checks.push({
      id: args.id,
      status: 'warn',
      title: args.title,
      message: warning,
      hint: args.missingHint,
    })
    return
  }

  args.checks.push({
    id: args.id,
    status: 'warn',
    title: args.title,
    message: `Not found: ${args.filePath}`,
    hint: args.missingHint,
  })
}

function buildWritableDirHint(args: { id: string; error: string }): string {
  const error = String(args.error || 'unknown error')

  const mapping: Record<string, { envVar: string; configKey?: string }> = {
    'paths.logsDir': { envVar: 'FORMAX_LOGS_DIR', configKey: 'paths.logsDir' },
    'paths.subagentsDir': { envVar: 'FORMAX_SUBAGENTS_DIR', configKey: 'paths.subagentsDir' },
    'paths.planDir': { envVar: 'FORMAX_PLAN_DIR', configKey: 'paths.planDir' },
    'paths.configDir': { envVar: 'FORMAX_CONFIG_DIR' },
  }

  const entry = mapping[args.id]
  const envVar = entry?.envVar ?? 'FORMAX_*'
  const configKey = entry?.configKey

  const steps: string[] = []
  steps.push(`Permission error: ${error}`)
  steps.push(`Pick a writable path and set ${envVar}.`)
  if (configKey) steps.push(`Or set ${configKey} in config.json.`)
  return steps.join(' ')
}

export async function runDoctor(args: {
  version: string
  cwd: string
  provider: ProviderId
  runtime: {
    llm: { apiKey: string; baseUrl: string; model: string }
    paths: { logsDir: string; subagentsDir: string; planDir: string }
  }
  config?: DoctorConfigContext
  warnings?: string[]
  testConnection: ConnectionTester
  checkWritableDir: WritableDirChecker
}): Promise<DoctorReport> {
  const warnings = [...(args.warnings ?? [])]
  const checks: DoctorCheck[] = []

  if (!args.runtime.llm.apiKey) {
    checks.push({
      id: 'auth.apiKey',
      status: 'fail',
      title: 'API key configured',
      message: 'No API key is configured.',
      hint: 'Run `formax setup`, or write it to auth.json, or set ANTHROPIC_API_KEY2.',
      code: ErrorCode.SetupRequired,
    })
  } else {
    checks.push({ id: 'auth.apiKey', status: 'pass', title: 'API key configured', message: 'API key is present (redacted).' })
  }

  if (!args.runtime.llm.baseUrl.trim()) {
    checks.push({
      id: 'llm.baseUrl',
      status: 'fail',
      title: 'Base URL configured',
      message: 'No base URL is configured.',
      hint: 'Run `formax setup` or set ANTHROPIC_BASE_URL2.',
      code: ErrorCode.SetupRequired,
    })
  } else {
    checks.push({ id: 'llm.baseUrl', status: 'pass', title: 'Base URL configured', message: args.runtime.llm.baseUrl })
  }

  if (!args.runtime.llm.model.trim()) {
    checks.push({
      id: 'llm.model',
      status: 'fail',
      title: 'Model configured',
      message: 'No model is configured.',
      hint: 'Run `formax setup` or set it in config.json (llm.model).',
      code: ErrorCode.SetupRequired,
    })
  } else {
    checks.push({ id: 'llm.model', status: 'pass', title: 'Model configured', message: args.runtime.llm.model })
  }

  if (args.runtime.llm.apiKey && args.runtime.llm.baseUrl.trim()) {
    const res = await args.testConnection({
      provider: args.provider,
      baseUrl: args.runtime.llm.baseUrl,
      apiKey: args.runtime.llm.apiKey,
    })
    if (res.ok === true) {
      checks.push({ id: 'llm.connectivity', status: 'pass', title: 'API connectivity', message: 'Connection test succeeded.' })
    } else {
      checks.push({
        id: 'llm.connectivity',
        status: 'fail',
        title: 'API connectivity',
        message: `Connection test failed (${res.code}): ${res.message}`,
        hint: 'Double-check base URL and credentials, then run `formax setup` to update.',
        code: res.code,
      })
    }
  } else {
    checks.push({
      id: 'llm.connectivity',
      status: 'warn',
      title: 'API connectivity',
      message: 'Skipped (missing API key or base URL).',
    })
  }

  for (const [id, title, dir] of [
    ['paths.logsDir', 'Logs directory writable', args.runtime.paths.logsDir],
    ['paths.subagentsDir', 'Subagents directory writable', args.runtime.paths.subagentsDir],
    ['paths.planDir', 'Plan directory writable', args.runtime.paths.planDir],
  ] as const) {
    const checked = await args.checkWritableDir(dir)
    if (checked.ok === true) checks.push({ id, status: 'pass', title, message: dir })
    else checks.push({ id, status: 'fail', title, message: dir, hint: buildWritableDirHint({ id, error: checked.error }), code: ErrorCode.FsPermission })
  }

  if (args.config) {
    const { files, paths } = args.config
    pushConfigFileCheck({
      checks,
      warnings,
      id: 'config.global',
      title: 'Global config readable',
      filePath: paths.globalConfigPath,
      loaded: files.globalConfigLoaded,
      missingHint: 'Run `formax setup` (recommended) or create the file by hand.',
    })

    pushConfigFileCheck({
      checks,
      warnings,
      id: 'config.project',
      title: 'Project config readable',
      filePath: paths.projectConfigPath,
      loaded: files.projectConfigLoaded,
      missingHint: 'Optional. Create .formax/config.json if you need per-repo config.',
    })

    pushConfigFileCheck({
      checks,
      warnings,
      id: 'auth.store',
      title: 'Auth store readable',
      filePath: paths.globalAuthPath,
      loaded: files.authStoreLoaded,
      missingHint: 'Run `formax setup` or set ANTHROPIC_API_KEY2.',
    })

    pushConfigFileCheck({
      checks,
      warnings,
      id: 'rules.global',
      title: 'Global rules readable',
      filePath: paths.globalRulesPath,
      loaded: files.globalRulesLoaded,
      missingHint: 'Optional. Create rules.json if you want custom policies.',
    })

    pushConfigFileCheck({
      checks,
      warnings,
      id: 'rules.project',
      title: 'Project rules readable',
      filePath: paths.projectRulesPath,
      loaded: files.projectRulesLoaded,
      missingHint: 'Optional. Create .formax/rules.json if you want per-repo policies.',
    })

    const configDirCheck = await args.checkWritableDir(paths.globalConfigDir)
    if (configDirCheck.ok === true) {
      checks.push({
        id: 'paths.configDir',
        status: 'pass',
        title: 'Config directory writable',
        message: paths.globalConfigDir,
      })
    } else {
      checks.push({
        id: 'paths.configDir',
        status: 'fail',
        title: 'Config directory writable',
        message: paths.globalConfigDir,
        hint: buildWritableDirHint({ id: 'paths.configDir', error: configDirCheck.error }),
        code: ErrorCode.FsPermission,
      })
    }
  } else {
    checks.push({
      id: 'config.files',
      status: 'warn',
      title: 'Config files inspected',
      message: 'Skipped (no config context provided).',
      hint: 'Run `formax doctor` for a full diagnostic report.',
    })
  }

  return { version: args.version, cwd: args.cwd, checks, warnings }
}
