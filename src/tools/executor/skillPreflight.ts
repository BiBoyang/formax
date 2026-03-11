import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { UserInputManager } from '../runtime/userInputManager.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ToolPreflight, ExecutionContext } from './index.js'
import { assertNoExtraKeys, requirePlainObject } from '../utils/strictInput.js'
import { buildSkillPermissionKey, persistProjectSkillAllow } from '../../adapters/permissions/skillAllowList.js'
import { loadMergedPermissions } from '../../adapters/permissions/permissionsStore.js'
import { decideToolPermission } from '../../adapters/permissions/matcher.js'
import {
  buildToolUseRejectedContent,
  promptForApprovalLikeAnswer,
} from './approvalLikePrompt.js'

type SkillApprovalAnswer = {
  decision?: string
  feedback?: string
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

    const promptResult = await promptForApprovalLikeAnswer<SkillApprovalAnswer>({
      call,
      ctx,
      userInput: args.userInput,
      unavailableContent: 'Error: Skill requires user approval.',
      abortedContent: 'Request aborted',
      requireInteractive: true,
    })
    if (promptResult.ok !== true) return promptResult.result
    const { decision, feedback } = promptResult

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
