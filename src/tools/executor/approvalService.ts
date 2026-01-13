import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import type { PolicyRule, PolicyScope } from '../../core/policy/schema.js'
import { savePolicyRules, type LoadedPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction } from '../../core/policy/types.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext } from './index.js'
import { createAllowRuleFromAction } from '../../core/approval/rules.js'

import type { UserInputManager } from '../runtime/userInputManager.js'

type ApprovalAnswer = {
  decision?: string
  feedback?: string
  scope?: string
}

export type ApprovalService = {
  getSessionRules: () => PolicyRule[]
  ensureApproved: (args: {
    call: ToolCall
    ctx: ExecutionContext
    action: PolicyAction
    loaded: LoadedPolicyRules
  }) => Promise<{ ok: true } | { ok: false; result: ToolResult }>
}

export function createApprovalService(args: {
  fileStore: FileStore
  userInput: UserInputManager | null
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): ApprovalService {
  const env = args.env ?? process.env
  const sessionRules: PolicyRule[] = []

  const getSessionRules = () => sessionRules.slice()

  function buildUserRejectedContent(action: PolicyAction): string {
    const what = (() => {
      switch (action.kind) {
        case 'fs.read':
          return 'this read'
        case 'fs.write':
          return 'this edit'
        case 'bash.exec':
          return 'this command'
        case 'net.fetch':
        case 'net.search':
          return 'this request'
      }
    })()

    return `Error: User rejected ${what}.`
  }

  async function persistAllowRule(args2: {
    scope: Exclude<PolicyScope, 'session'>
    action: PolicyAction
    loaded: LoadedPolicyRules
    ctx: ExecutionContext
    toolUseId: string
  }): Promise<{ ok: true } | { ok: false; result: ToolResult }> {
    const { scope, action, loaded, ctx } = args2

    const existing = scope === 'project' ? (loaded.projectRules?.rules ?? []) : (loaded.globalRules?.rules ?? [])
    const rule = createAllowRuleFromAction({
      scope,
      action,
      reason: 'Approved via interactive prompt',
    })

    const already = existing.some((r) => JSON.stringify(r.match) === JSON.stringify(rule.match) && r.decision === 'allow')
    const nextRules = already ? existing : [...existing, rule]

    try {
      await savePolicyRules({
        fileStore: args.fileStore,
        scope,
        rules: nextRules,
        cwd: ctx.cwd,
        env,
        platform: args.platform,
        homedir: args.homedir,
      })
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        result: { tool_use_id: args2.toolUseId, content: `Error: Failed to save policy rule: ${msg}`, is_error: true },
      }
    }
  }

  async function ensureApproved(args2: {
    call: ToolCall
    ctx: ExecutionContext
    action: PolicyAction
    loaded: LoadedPolicyRules
  }): Promise<{ ok: true } | { ok: false; result: ToolResult }> {
    const { call, ctx } = args2

    if (!args.userInput) {
      return {
        ok: false,
        result: {
          tool_use_id: call.id,
          content: `Error: Approval required for ${args2.action.kind}, but no interactive UI is available.`,
          is_error: true,
        },
      }
    }

    if (ctx.signal?.aborted) {
      return { ok: false, result: { tool_use_id: call.id, content: 'Request aborted', is_error: true } }
    }

    const answersPromise = args.userInput.requestAnswers({
      toolUseId: call.id,
      questions: [],
      signal: ctx.signal,
    })
    ctx.onEvent?.({ type: 'tool_update', id: call.id, middleLines: [] })

    let answers: ApprovalAnswer
    try {
      answers = (await answersPromise) as ApprovalAnswer
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, result: { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true } }
    }

    const decision = String(answers.decision || '').trim().toLowerCase()
    const feedback = String(answers.feedback || '').trim()
    const scopeRaw = String(answers.scope || '').trim().toLowerCase()
    const scope: PolicyScope = scopeRaw === 'global' ? 'global' : scopeRaw === 'project' ? 'project' : 'session'

    if (decision === 'approve') {
      return { ok: true }
    }

    if (decision === 'approve_remember') {
      if (scope === 'session') {
        // For session-only remembers, rely on existing REPL modes where applicable
        // (e.g. acceptEdits) and also keep a conservative policy allow for this action.
        sessionRules.push(
          createAllowRuleFromAction({
            scope: 'session',
            action: args2.action,
            reason: 'Approved for this session',
          }),
        )
        return { ok: true }
      }

      const persisted = await persistAllowRule({
        scope,
        action: args2.action,
        loaded: args2.loaded,
        ctx: args2.ctx,
        toolUseId: call.id,
      })
      if (!persisted.ok) {
        return persisted
      }
      return { ok: true }
    }

    if (decision === 'feedback') {
      if (!feedback) {
        return { ok: false, result: { tool_use_id: call.id, content: buildUserRejectedContent(args2.action), is_error: true } }
      }
      return {
        ok: false,
        result: {
          tool_use_id: call.id,
          content: `Error: User requested changes. Feedback: ${feedback}`,
          is_error: true,
        },
      }
    }

    return { ok: false, result: { tool_use_id: call.id, content: buildUserRejectedContent(args2.action), is_error: true } }
  }

  return { getSessionRules, ensureApproved }
}
