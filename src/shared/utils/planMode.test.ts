import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { buildExitedPlanModeSystemReminder, buildPlanModeSystemReminder, formatPlanPathForDisplay, isSameFilePath, normalizePathForCompare } from './planMode'

describe('planMode', () => {
  it('formatPlanPathForDisplay delegates to paths formatter', () => {
    const home = os.homedir()
    const input = path.join(home, '.formax', 'plan.md')
    expect(formatPlanPathForDisplay(input)).toBe('~/.formax/plan.md')
  })

  it('normalizePathForCompare and isSameFilePath delegate to paths helpers', () => {
    const cwd = '/tmp'
    const a = '/tmp/a/../b.txt'
    const b = '/tmp/b.txt'
    expect(normalizePathForCompare(a, cwd)).toBe(normalizePathForCompare(b, cwd))
    expect(isSameFilePath(a, b, cwd)).toBe(true)
  })

  it('buildPlanModeSystemReminder includes correct allowance when planPath is empty', () => {
    const out = buildPlanModeSystemReminder(null)
    expect(out).toContain('<system-reminder>')
    expect(out).toContain('Plan mode is active.')
    expect(out).toContain('MUST NOT make any edits')
    expect(out).not.toContain('Plan File Info:')
  })

  it('buildPlanModeSystemReminder includes plan path info when planPath is provided', () => {
    const out = buildPlanModeSystemReminder('/x/plan.md')
    expect(out).toContain('<system-reminder>')
    expect(out).toContain('Plan File Info:')
    expect(out).toContain('A plan file already exists at /x/plan.md.')
    expect(out).toContain('only file you are allowed to edit')
  })

  it('buildExitedPlanModeSystemReminder includes plan path only when provided', () => {
    expect(buildExitedPlanModeSystemReminder(null)).toContain('You have exited plan mode.')
    expect(buildExitedPlanModeSystemReminder(null)).not.toContain('The plan file is located at')

    expect(buildExitedPlanModeSystemReminder('/x/plan.md')).toContain('You have exited plan mode.')
    expect(buildExitedPlanModeSystemReminder('/x/plan.md')).toContain('The plan file is located at /x/plan.md')
  })
})

