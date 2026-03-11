import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import type { PolicyRule, PolicyScope } from '../../core/policy/schema.js'
import { savePolicyRules, type LoadedPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction, PolicyDecision } from '../../core/policy/types.js'
import type { PolicyExplainResult } from '../../core/policy/engine.js'
import { explainPolicy } from '../../core/policy/engine.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext } from './index.js'
import { createAllowRuleFromAction } from '../../core/approval/rules.js'
import { formatPolicyExplainLines } from './policyExplain.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso, type TraceContext } from '../../core/audit/schema.js'
import { toolCallToPolicyAction } from './policyAction.js'
import { classifyBashCommand } from '../modules/bash/policy.js'

import type { UserInputManager } from '../runtime/userInputManager.js'
import {
  loadMergedPermissions,
  persistProjectPermissionAllow,
  persistWorkspaceDirectory,
} from '../../adapters/permissions/permissionsStore.js'
import { buildToolPermissionKey } from '../../adapters/permissions/permissionKeys.js'
import { decideToolPermission } from '../../adapters/permissions/matcher.js'
import {
  promptForApprovalLikeAnswer,
  resolveApprovalLikeOutcome,
} from './approvalLikePrompt.js'

export type WorkspaceAccessRequest = {
  dir: string
}

type ApprovalAnswer = {
  decision?: string
  feedback?: string
  scope?: string
  updated_input_json?: string
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

  async function validateUpdatedInput(args2: {
    call: ToolCall
    ctx: ExecutionContext
    originalAction: PolicyAction
    loaded: LoadedPolicyRules
    updatedInput: Record<string, unknown>
  }): Promise<{ ok: true; action: PolicyAction } | { ok: false; error: string }> {
    const updatedCall: ToolCall = { ...args2.call, input: args2.updatedInput }
    const updatedAction = toolCallToPolicyAction(updatedCall, args2.ctx)
    if (!updatedAction) {
      return { ok: false, error: 'updated_input_json produced an unsupported tool action' }
    }

    if (updatedAction.kind !== args2.originalAction.kind) {
      return {
        ok: false,
        error: `updated_input_json cannot change action kind (${args2.originalAction.kind} -> ${updatedAction.kind})`,
      }
    }

    if (
      updatedAction.kind === 'fs.read' &&
      args2.originalAction.kind === 'fs.read' &&
      updatedAction.path !== args2.originalAction.path
    ) {
      return { ok: false, error: 'updated_input_json cannot change fs.read path after approval prompt' }
    }

    if (
      updatedAction.kind === 'fs.write' &&
      args2.originalAction.kind === 'fs.write' &&
      updatedAction.path !== args2.originalAction.path
    ) {
      return { ok: false, error: 'updated_input_json cannot change fs.write path after approval prompt' }
    }

    const mergedRules = Array.isArray(args2.loaded.mergedRules) ? args2.loaded.mergedRules : []
    const explainedUpdated = explainPolicy({
      action: updatedAction,
      rules: [...sessionRules, ...mergedRules],
    })
    if (explainedUpdated.decision === 'deny') {
      return { ok: false, error: `updated_input_json denied by policy for ${updatedAction.kind}` }
    }

    const cwd = args2.ctx.cwd || process.cwd()
    let permissionsPromise: ReturnType<typeof loadMergedPermissions> | null = null
    const loadPermissions = async () => {
      if (!permissionsPromise) {
        permissionsPromise = loadMergedPermissions({
          fileStore: args.fileStore,
          cwd,
          env,
          platform: args.platform,
          homedir: args.homedir,
        })
      }
      return await permissionsPromise
    }

    if (updatedAction.kind === 'bash.exec' && args2.call.name === 'Bash') {
      const replMode = args2.ctx.getReplMode?.() ?? args2.ctx.replMode
      const bashDecision = classifyBashCommand({
        command: updatedAction.command,
        mode: replMode,
        agentDepth: args2.ctx.agentDepth,
      })
      if (bashDecision.risk === 'deny') {
        return { ok: false, error: `updated_input_json denied (${bashDecision.prefix}): ${bashDecision.reason}` }
      }

      const permissions = await loadPermissions()
      const perm = decideToolPermission({
        permissions,
        toolName: 'Bash',
        toolSpec: updatedAction.command,
      })
      if (perm.decision === 'deny') {
        return { ok: false, error: 'updated_input_json denied by permission rule for Bash' }
      }
    }

    if (
      (args2.call.name === 'WebFetch' || args2.call.name === 'WebSearch') &&
      (updatedAction.kind === 'net.fetch' || updatedAction.kind === 'net.search')
    ) {
      const permissions = await loadPermissions()
      const toolSpec = updatedAction.kind === 'net.fetch' ? updatedAction.url : updatedAction.query
      const perm = decideToolPermission({
        permissions,
        toolName: args2.call.name,
        toolSpec,
      })
      if (perm.decision === 'deny') {
        return { ok: false, error: `updated_input_json denied by permission rule for ${args2.call.name}` }
      }
    }

    return { ok: true, action: updatedAction }
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

    const suggestions = formatPolicyExplainLines({
      effectiveDecision: args2.effectiveDecision,
      explained: args2.explained,
    })
    const decisionReason = args2.explained.matchedRule?.reason?.trim()
    const promptResult = await promptForApprovalLikeAnswer<ApprovalAnswer>({
      call,
      ctx,
      userInput: args.userInput,
      unavailableContent: `Error: Approval required for ${args2.action.kind}`,
      abortedContent: 'Error: Request aborted',
      beforeRequest: () => {
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

        ctx.onEvent?.({
          type: 'approval_request',
          toolUseId: call.id,
          toolName: call.name,
          action: args2.action,
          effectiveDecision: args2.effectiveDecision,
          suggestions,
          ...(decisionReason ? { decisionReason } : {}),
          ...(args2.workspaceRequest?.dir ? { blockedPath: args2.workspaceRequest.dir } : {}),
          ...(args2.workspaceRequest ? { workspaceRequest: args2.workspaceRequest } : {}),
        })
      },
    })
    if (promptResult.ok !== true) {
      return { ok: false, result: promptResult.result }
    }

    const { answers, decision, feedback } = promptResult
    const scopeRaw = String(answers.scope || '').trim().toLowerCase()
    const scope: PolicyScope = scopeRaw === 'global' ? 'global' : scopeRaw === 'project' ? 'project' : 'session'
    const workspaceDir = String(args2.workspaceRequest?.dir || '').trim()
    const updatedInputJson = String(answers.updated_input_json || '').trim()
    const parseUpdatedInput = (): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } | null => {
      if (!updatedInputJson) return null
      try {
        const parsed = JSON.parse(updatedInputJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, error: 'updated_input_json must decode to an object' }
        }
        return { ok: true, value: parsed as Record<string, unknown> }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `invalid updated_input_json: ${message}` }
      }
    }
    const parsedUpdatedInput = parseUpdatedInput()
    const updatedInputError =
      parsedUpdatedInput && parsedUpdatedInput.ok === false
        ? parsedUpdatedInput.error
        : null
    if (updatedInputError) {
      return {
        ok: false,
        result: {
          tool_use_id: call.id,
          content: `Error: ${updatedInputError}`,
          is_error: true,
        },
      }
    }

    let actionForDecision: PolicyAction = args2.action
    if (decision === 'approve' || decision === 'approve_remember') {
      if (parsedUpdatedInput && parsedUpdatedInput.ok) {
        const validatedUpdated = await validateUpdatedInput({
          call,
          ctx,
          originalAction: args2.action,
          loaded: args2.loaded,
          updatedInput: parsedUpdatedInput.value,
        })
        if (validatedUpdated.ok !== true) {
          return {
            ok: false,
            result: {
              tool_use_id: call.id,
              content: `Error: ${validatedUpdated.error}`,
              is_error: true,
            },
          }
        }
        call.input = parsedUpdatedInput.value
        actionForDecision = validatedUpdated.action
      }
    }

    const outcome = resolveApprovalLikeOutcome({
      call,
      decision,
      feedback,
    })

    if (outcome.type === 'approve') {
      if (args.audit) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'approval.result',
          agentDepth: ctx.agentDepth,
          trace: traceForCall,
          tool: { name: call.name, toolUseId: call.id },
          action: actionForDecision,
          outcome: 'approve',
        })
      }
      return { ok: true }
    }

    if (outcome.type === 'approve_remember') {
      if (args.audit) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'approval.result',
          agentDepth: ctx.agentDepth,
          trace: traceForCall,
          tool: { name: call.name, toolUseId: call.id },
          action: actionForDecision,
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
      if (actionForDecision.kind === 'fs.write') {
        ctx.setReplMode?.('acceptEdits')
        return { ok: true }
      }

      // Workspace out-of-bounds reads are session-only and should not create policy rules.
      if (actionForDecision.kind === 'fs.read' && workspaceDir) {
        return { ok: true }
      }

      // Bash: remember by writing into repo-local permissions.allow.
      if (actionForDecision.kind === 'bash.exec' && call.name === 'Bash') {
        const cwd = ctx.cwd || process.cwd()
        const key = buildToolPermissionKey('Bash', actionForDecision.command)
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
            action: actionForDecision,
            reason: 'Approved for this session',
          }),
        )
        return { ok: true }
      }

      const persisted = await persistAllowRule({
        scope,
        action: actionForDecision,
        loaded: args2.loaded,
        ctx: args2.ctx,
        toolUseId: call.id,
      })
      if (!persisted.ok) {
        return persisted
      }
      return { ok: true }
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
        outcome: outcome.type === 'feedback' ? 'feedback' : 'cancel',
      })
    }
    return { ok: false, result: outcome.result }
  }

  return { getSessionRules, ensureApproved }
}
