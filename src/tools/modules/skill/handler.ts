import type { ToolCall, ToolResult } from '../../types'
import type { ExecutionContext, ToolHandler } from '../../executor'
import { assertNoExtraKeys, requirePlainObject } from '../../utils/strictInput'
import { getConfigPaths } from '../../../adapters/fs/configPaths'
import { createSkillStore } from '../../../skills/SkillStore'
import { truncateByCharBudget } from '../../../invokables/charBudget'
import path from 'node:path'

const DEFAULT_SKILL_BODY_CHAR_BUDGET = 60000

function getSkillBodyCharBudget(): number {
  const raw = String(process.env.FORMAX_SKILL_BODY_CHAR_BUDGET || '').trim()
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SKILL_BODY_CHAR_BUDGET
  return n
}

export const SkillToolHandler: ToolHandler = {
  canHandle(name: string): boolean {
    return name === 'Skill'
  },

  async execute(call: ToolCall, ctx: ExecutionContext): Promise<ToolResult> {
    try {
      const input = requirePlainObject(call.input || {}, 'Skill.input')
      assertNoExtraKeys(input, ['skill'], 'Skill.input')

      const raw = (input as any).skill
      const skill = typeof raw === 'string' ? raw.trim() : ''
      if (!skill) throw new Error('Missing skill')

      const cwd = ctx.cwd || process.cwd()
      const configPaths = getConfigPaths({ cwd, env: process.env })
      const store = createSkillStore({ cwd, globalConfigDir: configPaths.globalConfigDir })
      const available = store.list().filter((s) => !s.disableModelInvocation).map((s) => s.name)
      const meta = store.get(skill)

      if (!meta) {
        const list = available.length ? available.join(', ') : '(none)'
        return {
          tool_use_id: call.id,
          content: `Error: Unknown skill: ${skill}\nAvailable skills: ${list}`,
          is_error: true,
        }
      }

      if (meta.disableModelInvocation) {
        return {
          tool_use_id: call.id,
          content: `Error: Skill is disabled for model invocation: ${meta.name}`,
          is_error: true,
        }
      }

      const { kept, truncated } = truncateByCharBudget(meta.body.split(/\r?\n/g), getSkillBodyCharBudget())
      const body = kept.join('\n')

      return {
        tool_use_id: call.id,
        content: buildSkillLoadedText({
          name: meta.name,
          baseDir: path.dirname(meta.filePath),
          body,
          truncated,
        }),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }
  },
}

function buildSkillLoadedText(args: {
  name: string
  baseDir: string
  body: string
  truncated: boolean
}): string {
  const lines: string[] = []
  lines.push(`Launching skill: ${args.name}`)
  lines.push(`Base directory for this skill: ${args.baseDir}`)
  lines.push('')
  lines.push(args.body)
  if (args.truncated) lines.push('\n… (truncated)')
  return lines.join('\n')
}
