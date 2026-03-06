import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { SkillToolHandler } from './handler'
import { SkillToolPresenter } from './presenter'
import { baseSpec } from './spec'
import { getConfigPaths } from '../../../adapters/fs/configPaths'
import { createSkillStore } from '../../../features/skills/SkillStore'
import { truncateByCharBudget } from '../../../shared/invokables/charBudget'

const DEFAULT_SKILL_TOOL_CHAR_BUDGET = 15000
const AVAILABLE_SKILLS_MARKER = '<available_skills>\n\n</available_skills>'

type BuildSkillToolSpecOptions = {
  includeAvailableSkillsInDescription?: boolean
}

function getSkillToolCharBudget(): number {
  const raw = String(process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET || '').trim()
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SKILL_TOOL_CHAR_BUDGET
  return n
}

type AvailableSkillMeta = {
  name: string
  scope: string
  description: string
}

function listAvailableSkillsForCwd(cwd: string): AvailableSkillMeta[] {
  const configPaths = getConfigPaths({ cwd, env: process.env })
  const store = createSkillStore({ cwd, globalConfigDir: configPaths.globalConfigDir })
  return store
    .list()
    .filter((s) => !s.disableModelInvocation)
    .map((s) => ({
      name: s.name,
      scope: s.scope,
      description: s.description,
    }))
}

function buildAvailableSkillsSection(cwd: string): string {
  const entries = listAvailableSkillsForCwd(cwd).map((s) => {
    const scopedDescription = `${s.description} (${s.scope})`
    return [
      '<skill>',
      '<name>',
      escapeXml(s.name),
      '</name>',
      '<description>',
      escapeXml(scopedDescription),
      '</description>',
      '<location>',
      'managed',
      '</location>',
      '</skill>',
      '',
    ].join('\n')
  })

  if (entries.length === 0) return ''

  const { kept, truncated } = truncateByCharBudget(entries, getSkillToolCharBudget())
  const out = kept.join('')
  if (!truncated) return out
  return `${out}<truncated>true</truncated>\n`
}

function injectAvailableSkills(desc: string, skillsSection: string): string {
  if (!skillsSection.trim()) return desc
  return desc.replace(AVAILABLE_SKILLS_MARKER, `<available_skills>\n${skillsSection}</available_skills>`)
}

function escapeXml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function buildSkillToolSpecForCwd(cwd: string): ToolDefinition {
  return buildSkillToolSpecForCwdWithOptions(cwd, {})
}

export function buildSkillToolSpecForCwdWithOptions(cwd: string, options: BuildSkillToolSpecOptions): ToolDefinition {
  const includeAvailableSkillsInDescription = options.includeAvailableSkillsInDescription !== false
  const description = includeAvailableSkillsInDescription
    ? injectAvailableSkills(baseSpec.description, buildAvailableSkillsSection(cwd))
    : baseSpec.description

  return {
    name: 'Skill',
    description,
    input_schema: baseSpec.input_schema,
  }
}

export function buildAvailableSkillsSystemReminderText(cwd: string): string | null {
  const entries = listAvailableSkillsForCwd(cwd).map(
    (skill) =>
      `- ${sanitizeSystemReminderText(skill.name)}: ${sanitizeSystemReminderText(skill.description)}\n`,
  )
  if (entries.length === 0) return null

  const { kept, truncated } = truncateByCharBudget(entries, getSkillToolCharBudget())
  const bulletList = kept.join('')
  if (!bulletList.trim()) return null

  const truncatedSuffix = truncated ? '- ... (some skills omitted due prompt size limits)\n' : ''

  return (
    '<system-reminder>\n' +
    'The following skills are available for use with the Skill tool:\n\n' +
    `${bulletList}${truncatedSuffix}` +
    '</system-reminder>'
  )
}

function sanitizeSystemReminderText(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const spec: ToolDefinition = buildSkillToolSpecForCwd(process.cwd())

export const skillToolModule: ToolModule = {
  name: 'Skill',
  handler: SkillToolHandler,
  presenter: SkillToolPresenter,
  spec,
}
