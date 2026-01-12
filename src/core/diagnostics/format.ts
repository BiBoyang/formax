import type { DoctorCheck } from './doctor.js'

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

