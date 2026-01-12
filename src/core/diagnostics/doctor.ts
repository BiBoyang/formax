import type { ProviderId } from '../config/schema.js'
import type { ConnectionTestResult } from '../setup/types.js'

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail'

export type DoctorCheck = {
  id: string
  status: DoctorCheckStatus
  title: string
  message: string
  hint?: string
}

export type DoctorReport = {
  version: string
  cwd: string
  checks: DoctorCheck[]
  warnings: string[]
}

export type ConnectionTester = (args: { provider: ProviderId; baseUrl: string; apiKey: string }) => Promise<ConnectionTestResult>
export type WritableDirChecker = (dirPath: string) => Promise<{ ok: true } | { ok: false; error: string }>

export async function runDoctor(args: {
  version: string
  cwd: string
  provider: ProviderId
  runtime: {
    llm: { apiKey: string; baseUrl: string; model: string }
    paths: { logsDir: string; subagentsDir: string; planDir: string }
  }
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
    else checks.push({ id, status: 'fail', title, message: dir, hint: checked.error })
  }

  return { version: args.version, cwd: args.cwd, checks, warnings }
}

