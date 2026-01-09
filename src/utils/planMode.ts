import os from 'node:os'
import path from 'node:path'

export function formatPlanPathForDisplay(filePath: string): string {
  const raw = String(filePath || '')
  if (!raw) return raw

  const home = os.homedir()
  if (home && (raw === home || raw.startsWith(home + path.sep))) {
    return `~${raw.slice(home.length)}`
  }

  return raw
}

export function buildPlanModeSystemReminder(planPath: string): string {
  const p = String(planPath || '')
  return (
    '<system-reminder>\n' +
    "Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system.\n\n" +
    '## Plan File Info:\n' +
    `A plan file already exists at ${p}. You can read it and make incremental edits using the Edit tool.\n` +
    'You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.\n' +
    '</system-reminder>'
  )
}

export function buildExitedPlanModeSystemReminder(planPath: string | null): string {
  const p = planPath ? String(planPath) : ''
  return (
    '<system-reminder>\n' +
    '## Exited Plan Mode\n\n' +
    'You have exited plan mode. You can now make edits, run tools, and take actions.' +
    (p ? ` The plan file is located at ${p} if you need to reference it.` : '') +
    '\n</system-reminder>'
  )
}

