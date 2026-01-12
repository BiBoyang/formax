import { formatPathForDisplay, isSameFilePath as isSameFilePathUtil, normalizePathForCompare as normalizePathForCompareUtil } from './paths'

export function formatPlanPathForDisplay(filePath: string): string {
  return formatPathForDisplay(filePath)
}

export function normalizePathForCompare(rawPath: string, cwd: string = process.cwd()): string {
  return normalizePathForCompareUtil(rawPath, cwd)
}

export function isSameFilePath(a: string, b: string, cwd: string = process.cwd()): boolean {
  return isSameFilePathUtil(a, b, cwd)
}

export function buildPlanModeSystemReminder(planPath: string | null): string {
  const p = String(planPath || '')
  if (!p) {
    return (
      '<system-reminder>\n' +
      "Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system.\n\n" +
      'Focus on analysis and proposing a plan. Ask questions when needed. Do not start implementation until the user approves.\n' +
      '</system-reminder>'
    )
  }

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
