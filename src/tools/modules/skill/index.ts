import type { ToolModule } from '../../registry'
import type { ToolDefinition } from '../../types'
import { SkillToolHandler } from './handler'
import { SkillToolPresenter } from './presenter'
import { baseSpec } from './spec'
import { getConfigPaths } from '../../../adapters/fs/configPaths'
import { createSkillStore } from '../../../skills/SkillStore'
import { truncateByCharBudget } from '../../../invokables/charBudget'

const DEFAULT_SKILL_TOOL_CHAR_BUDGET = 15000

function getSkillToolCharBudget(): number {
  const raw = String(process.env.FORMAX_SKILL_TOOL_CHAR_BUDGET || '').trim()
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SKILL_TOOL_CHAR_BUDGET
  return n
}

function buildAvailableSkillsSection(cwd: string): string {
  const configPaths = getConfigPaths({ cwd, env: process.env })
  const store = createSkillStore({ cwd, globalConfigDir: configPaths.globalConfigDir })
  const entries = store
    .list()
    .filter((s) => !s.disableModelInvocation)
    .map((s) => {
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
  const marker = '<available_skills>\n\n</available_skills>'
  if (!desc.includes(marker)) return desc
  return desc.replace(marker, `<available_skills>\n${skillsSection}</available_skills>`)
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
  return {
    name: 'Skill',
    description: injectAvailableSkills(baseSpec.description, buildAvailableSkillsSection(cwd)),
    input_schema: baseSpec.input_schema,
  }
}

const spec: ToolDefinition = buildSkillToolSpecForCwd(process.cwd())

export const skillToolModule: ToolModule = {
  name: 'Skill',
  handler: SkillToolHandler,
  presenter: SkillToolPresenter,
  spec,
}
