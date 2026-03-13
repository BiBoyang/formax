import type { DoctorCheck } from './doctor.js'
import type { StatusSnapshot } from './status.js'

export function formatDoctorHuman(args: { version: string; cwd: string; checks: DoctorCheck[]; warnings: string[] }): string {
  const failed = args.checks.filter((c) => c.status === 'fail').length
  const warned = args.checks.filter((c) => c.status === 'warn').length
  const passed = args.checks.filter((c) => c.status === 'pass').length

  const lines: string[] = []
  lines.push(`Formax v${args.version}`)
  lines.push(`CWD: ${args.cwd}`)
  lines.push('')
  lines.push(`Doctor: ${passed} passed · ${warned} warnings · ${failed} failed`)
  lines.push('')

  for (const c of args.checks) {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'
    lines.push(`${icon} ${c.title}`)
    lines.push(`  ${c.message}`)
    if (c.hint) lines.push(`  Hint: ${c.hint}`)
    lines.push('')
  }

  if (args.warnings.length) {
    lines.push('Warnings:')
    for (const w of args.warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  return lines.join('\n')
}

export function formatStatusHuman(snapshot: StatusSnapshot): string {
  const lines: string[] = []
  lines.push(`Formax v${snapshot.version}`)
  lines.push(`CWD: ${snapshot.cwd}`)

  if (snapshot.workspaceRoots.length) {
    lines.push('')
    lines.push('Workspace roots:')
    for (const root of snapshot.workspaceRoots) lines.push(`- ${root}`)
  }

  lines.push('')
  lines.push('LLM:')
  lines.push(`- provider: ${snapshot.runtime.llm.provider}`)
  lines.push(`- baseUrl: ${snapshot.runtime.llm.baseUrl}`)
  lines.push(`- model: ${snapshot.runtime.llm.model}`)
  lines.push(`- timeoutMs: ${snapshot.runtime.llm.timeoutMs}`)
  lines.push(`- apiKeyPresent: ${snapshot.runtime.llm.apiKeyPresent ? 'yes' : 'no'}`)

  lines.push('')
  lines.push('Paths:')
  lines.push(`- logsDir: ${snapshot.runtime.paths.logsDir}`)
  lines.push(`- subagentsDir: ${snapshot.runtime.paths.subagentsDir}`)
  lines.push(`- planDir: ${snapshot.runtime.paths.planDir}`)

  lines.push('')
  lines.push('UI:')
  lines.push(`- assistantTextMode: ${snapshot.runtime.ui.assistantTextMode}`)

  if (snapshot.config) {
    const { auth, files, paths, sources } = snapshot.config

    lines.push('')
    lines.push('Config dirs:')
    lines.push(`- global: ${paths.globalConfigDir}`)
    lines.push(`- project: ${paths.projectConfigDir}`)
    lines.push(`- legacy: ${paths.legacyConfigDir}`)

    lines.push('')
    lines.push('Loaded:')
    lines.push(`- global config: ${files.globalConfigLoaded ? 'yes' : 'no'} (${paths.globalConfigPath})`)
    lines.push(`- project config: ${files.projectConfigLoaded ? 'yes' : 'no'} (${paths.projectConfigPath})`)
    lines.push(`- auth store: ${files.authStoreLoaded ? 'yes' : 'no'} (${paths.globalAuthPath})`)
    lines.push(`- global rules: ${files.globalRulesLoaded ? 'yes' : 'no'} (${paths.globalRulesPath})`)
    lines.push(`- project rules: ${files.projectRulesLoaded ? 'yes' : 'no'} (${paths.projectRulesPath})`)

    if (Object.keys(sources).length) {
      lines.push('')
      lines.push('Sources:')
      for (const key of [
        'llm.provider',
        'llm.baseUrl',
        'llm.model',
        'llm.defaultTier',
        'llm.timeoutMs',
        'llm.authRef',
        'ui.assistantTextMode',
        'paths.logsDir',
        'paths.subagentsDir',
        'paths.planDir',
      ] as const) {
        const source = sources[key]
        if (source) lines.push(`- ${key}: ${source}`)
      }
    }

    lines.push('')
    lines.push('Auth:')
    if (!auth) lines.push('- present: no')
    else {
      lines.push('- present: yes')
      lines.push(`- provider: ${auth.provider}`)
      lines.push(`- authRef: ${auth.authRef}`)
      lines.push(`- source: ${auth.source}`)
    }
  }

  if (snapshot.policySummary) {
    lines.push('')
    lines.push('Policy:')
    lines.push(snapshot.policySummary)
  }

  if (snapshot.warnings.length) {
    lines.push('')
    lines.push('Warnings:')
    for (const w of snapshot.warnings) lines.push(`- ${w}`)
  }

  return lines.join('\n')
}
