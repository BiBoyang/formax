import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import type { PolicyRule, PolicyScope } from '../../core/policy/schema.js'
import { savePolicyRules, type LoadedPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction, PolicyDecision } from '../../core/policy/types.js'
import type { PolicyExplainResult } from '../../core/policy/engine.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext } from './index.js'
import { createAllowRuleFromAction } from '../../core/approval/rules.js'
import { formatPolicyExplainLines } from './policyExplain.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso, type TraceContext } from '../../core/audit/schema.js'

import type { UserInputManager } from '../runtime/userInputManager.js'
import { persistProjectPermissionAllow, persistWorkspaceDirectory } from '../../adapters/permissions/permissionsStore.js'
import { buildToolPermissionKey } from '../../adapters/permissions/permissionKeys.js'

export type WorkspaceAccessRequest = {
  dir: string
}

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
    effectiveDecision: PolicyDecision
    explained: PolicyExplainResult
    loaded: LoadedPolicyRules
    workspaceRequest?: WorkspaceAccessRequest | null
  }) => Promise<{ ok: true } | { ok: false; result: ToolResult }>
}

export function createApprovalService(args: {
  fileStore: FileStore
  userInput: UserInputManager | null
  audit?: AuditLog
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): ApprovalService {
  const env = args.env ?? process.env
  const sessionRules: PolicyRule[] = []

  const getSessionRules = () => sessionRules.slice()

  function buildToolUseRejectedContent(args2: { message?: string }): string {
    const msg = String(args2.message ?? '').trim()
    if (msg) return `Tool use rejected with user message: ${msg}`
    return 'Tool use rejected by user.'
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
    effectiveDecision: PolicyDecision
    explained: PolicyExplainResult
    loaded: LoadedPolicyRules
    workspaceRequest?: WorkspaceAccessRequest | null
  }): Promise<{ ok: true } | { ok: false; result: ToolResult }> {
    const { call, ctx } = args2
    const traceForCall: TraceContext = { ...(ctx.trace ?? {}), toolUseId: call.id }

    if (!args.userInput) {
      return {
        ok: false,
        result: {
          tool_use_id: call.id,
          content: `Error: Approval required for ${args2.action.kind}`,
          is_error: true,
        },
      }
    }

    if (ctx.signal?.aborted) {
      return { ok: false, result: { tool_use_id: call.id, content: 'Error: Request aborted', is_error: true } }
    }

    if (args.audit) {
      void args.audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'approval.prompt',
        agentDepth: ctx.agentDepth,
        trace: traceForCall,
        tool: { name: call.name, toolUseId: call.id },
        action: args2.action,
        effectiveDecision: args2.effectiveDecision,
      })
    }

    const suggestions = formatPolicyExplainLines({
      effectiveDecision: args2.effectiveDecision,
      explained: args2.explained,
    })
    ctx.onEvent?.({
      type: 'approval_request',
      toolUseId: call.id,
      toolName: call.name,
      action: args2.action,
      effectiveDecision: args2.effectiveDecision,
      suggestions,
      ...(args2.workspaceRequest ? { workspaceRequest: args2.workspaceRequest } : {}),
    })

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
    const workspaceDir = String(args2.workspaceRequest?.dir || '').trim()

    if (decision === 'approve') {
      if (args.audit) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'approval.result',
          agentDepth: ctx.agentDepth,
          trace: traceForCall,
          tool: { name: call.name, toolUseId: call.id },
          action: args2.action,
          outcome: 'approve',
        })
      }
      return { ok: true }
    }

    if (decision === 'approve_remember') {
      if (args.audit) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'approval.result',
          agentDepth: ctx.agentDepth,
          trace: traceForCall,
          tool: { name: call.name, toolUseId: call.id },
          action: args2.action,
          outcome: 'approve_remember',
          scope,
        })
      }

      if (workspaceDir) {
        try {
          await persistWorkspaceDirectory({
            fileStore: args.fileStore,
            cwd: ctx.cwd || process.cwd(),
            scope: 'projectLocal',
            dir: workspaceDir,
            env,
            platform: args.platform,
            homedir: args.homedir,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return { ok: false, result: { tool_use_id: call.id, content: `Error: ${msg}`, is_error: true } }
        }
      }

      // Claude Code semantics:
      // - File edits are "remembered" by switching the session into accept-edits mode (no persistence).
      // - Persistent allow-lists are reserved for other permission types (e.g. Bash, Skill).
      if (args2.action.kind === 'fs.write') {
        ctx.setReplMode?.('acceptEdits')
        return { ok: true }
      }

      // Workspace out-of-bounds reads are session-only and should not create policy rules.
      if (args2.action.kind === 'fs.read' && workspaceDir) {
        return { ok: true }
      }

      // Bash: remember by writing into repo-local permissions.allow.
      if (args2.action.kind === 'bash.exec' && call.name === 'Bash') {
        const cwd = ctx.cwd || process.cwd()
        const key = buildToolPermissionKey('Bash', args2.action.command)
        try {
          await persistProjectPermissionAllow({ fileStore: args.fileStore, cwd, key })
          return { ok: true }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return {
            ok: false,
            result: { tool_use_id: call.id, content: `Error: Failed to save settings.local.json: ${msg}`, is_error: true },
          }
        }
      }

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
        if (args.audit) {
          void args.audit.append({
            schemaVersion: 1,
            ts: nowIso(),
            kind: 'approval.result',
            agentDepth: ctx.agentDepth,
            trace: traceForCall,
            tool: { name: call.name, toolUseId: call.id },
            action: args2.action,
            outcome: 'cancel',
          })
        }
        return { ok: false, result: { tool_use_id: call.id, content: buildToolUseRejectedContent({}), is_error: true } }
      }
      if (args.audit) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'approval.result',
          agentDepth: ctx.agentDepth,
          trace: traceForCall,
          tool: { name: call.name, toolUseId: call.id },
          action: args2.action,
          outcome: 'feedback',
        })
      }
      return {
        ok: false,
        result: {
          tool_use_id: call.id,
          content: buildToolUseRejectedContent({ message: feedback }),
          is_error: true,
        },
      }
    }

    if (args.audit) {
      void args.audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'approval.result',
        agentDepth: ctx.agentDepth,
        trace: traceForCall,
        tool: { name: call.name, toolUseId: call.id },
        action: args2.action,
        outcome: 'cancel',
      })
    }
    return { ok: false, result: { tool_use_id: call.id, content: buildToolUseRejectedContent({}), is_error: true } }
  }

  return { getSessionRules, ensureApproved }
}
