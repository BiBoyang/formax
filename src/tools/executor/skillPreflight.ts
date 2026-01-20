import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ToolPreflight, ExecutionContext } from './index.js'
import { assertNoExtraKeys, requirePlainObject } from '../utils/strictInput.js'
import { buildSkillPermissionKey, persistProjectSkillAllow } from '../../adapters/permissions/skillAllowList.js'
import { loadMergedPermissions } from '../../adapters/permissions/permissionsStore.js'
import { decideToolPermission } from '../../adapters/permissions/matcher.js'

type SkillApprovalAnswer = {
  decision?: string
  feedback?: string
}

function buildToolUseRejectedContent(args: { message?: string }): string {
  const msg = String(args.message ?? '').trim()
  if (msg) return `Tool use rejected with user message: ${msg}`
  return 'Tool use rejected by user.'
}

function parseSkillName(call: ToolCall): string {
  const input = requirePlainObject(call.input || {}, 'Skill.input')
  assertNoExtraKeys(input, ['skill'], 'Skill.input')
  const raw = (input as any).skill
  return typeof raw === 'string' ? raw.trim() : ''
}

export function createSkillPreflight(args: {
  fileStore: FileStore
  userInput: UserInputManager | null
}): ToolPreflight {
  return async (call: ToolCall, ctx: ExecutionContext): Promise<ToolResult | null> => {
    if (call.name !== 'Skill') return null

    // Sub-agents must not prompt (and cannot reliably coordinate approvals).
    if (ctx.agentDepth > 0) {
      return {
        tool_use_id: call.id,
        content: 'Error: Skill requires user approval.',
        is_error: true,
      }
    }

    let skill = ''
    try {
      skill = parseSkillName(call)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }

    if (!skill) return { tool_use_id: call.id, content: 'Error: Missing skill', is_error: true }

    const cwd = ctx.cwd || process.cwd()
    const key = buildSkillPermissionKey(skill)
    const permissions = await loadMergedPermissions({ fileStore: args.fileStore, cwd })
    const perm = decideToolPermission({ permissions, toolName: 'Skill', toolSpec: skill })

    if (perm.decision === 'deny') {
      return { tool_use_id: call.id, content: `Error: Permission denied Skill(${skill})`, is_error: true }
    }
    if (perm.decision === 'allow') return null

    if (!args.userInput || ctx.interactive === false) {
      return {
        tool_use_id: call.id,
        content: 'Error: Skill requires user approval.',
        is_error: true,
      }
    }

    if (ctx.signal?.aborted) {
      return { tool_use_id: call.id, content: 'Request aborted', is_error: true }
    }

    const answersPromise = args.userInput.requestAnswers({
      toolUseId: call.id,
      questions: [],
      signal: ctx.signal,
    })
    ctx.onEvent?.({ type: 'tool_update', id: call.id, middleLines: [] })

    let answers: SkillApprovalAnswer
    try {
      answers = (await answersPromise) as SkillApprovalAnswer
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true }
    }

    const decision = String(answers.decision || '').trim().toLowerCase()
    const feedback = String(answers.feedback || '').trim()

    if (decision === 'approve') return null

    if (decision === 'approve_remember') {
      try {
        await persistProjectSkillAllow({ fileStore: args.fileStore, cwd, key })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { tool_use_id: call.id, content: `Error: Failed to save settings.local.json: ${msg}`, is_error: true }
      }
      return null
    }

    if (decision === 'feedback') {
      if (!feedback) return { tool_use_id: call.id, content: buildToolUseRejectedContent({}), is_error: true }
      return { tool_use_id: call.id, content: buildToolUseRejectedContent({ message: feedback }), is_error: true }
    }

    return { tool_use_id: call.id, content: buildToolUseRejectedContent({}), is_error: true }
  }
}
