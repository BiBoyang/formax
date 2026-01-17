import type { FileStore } from '../../adapters/fs/fileStore.js'
import type { Platform } from '../../adapters/fs/configPaths.js'
import { loadPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction } from '../../core/policy/types.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext, ToolPreflight } from './index.js'
import type { ApprovalService } from './approvalService.js'
import { classifyBashCommand } from '../modules/bash/policy.js'
import { isSameFilePath } from '../../utils/planMode.js'
import { explainPolicy } from '../../core/policy/engine.js'
import { toolCallToPolicyAction } from './policyAction.js'
import { ErrorCode } from '../../core/errors/codes.js'
import { formatPolicyExplainLines } from './policyExplain.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso } from '../../core/audit/schema.js'
import { loadProjectPermissionsAllowList } from '../../adapters/permissions/permissionsStore.js'
import { buildToolPermissionKey } from '../../adapters/permissions/permissionKeys.js'

export function createPolicyPreflight(args: {
  fileStore: FileStore
  approval?: ApprovalService
  audit?: AuditLog
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): ToolPreflight {
  const env = args.env ?? process.env
  return async (call, ctx): Promise<ToolResult | null> => {
    const action: PolicyAction | null = toolCallToPolicyAction(call, ctx)
    if (!action) return null

    const replMode = ctx.getReplMode?.() ?? ctx.replMode
    const cwd = ctx.cwd || process.cwd()

    // Plan mode: only allow editing the plan file itself (no approvals for non-plan paths).
    if (action.kind === 'fs.write' && replMode === 'plan') {
      const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
      const isPlanFile = Boolean(planPath && isSameFilePath(action.path, planPath, cwd))
      if (!isPlanFile) {
        return {
          tool_use_id: call.id,
          content: 'Error: Plan mode is active. Only the plan file may be edited until you exit plan mode.',
          is_error: true,
        }
      }
      // Plan file edits should not prompt.
      return null
    }

    const loaded = await loadPolicyRules({
      fileStore: args.fileStore,
      cwd: ctx.cwd,
      env,
      platform: args.platform,
      homedir: args.homedir,
    })

    const sessionRules = args.approval?.getSessionRules() ?? []
    const explained = explainPolicy({ action, rules: [...sessionRules, ...loaded.mergedRules] })
    let effectiveDecision = explained.decision

    // acceptEdits mode: treat prompts as implicitly approved (still respects deny rules).
    if (action.kind === 'fs.write' && replMode === 'acceptEdits' && effectiveDecision === 'prompt') {
      effectiveDecision = 'allow'
    }

    // Bash: require approval for commands our classifier marks as confirm (unless an allow rule matched).
    if (call.name === 'Bash' && action.kind === 'bash.exec') {
      const input = call.input
      const obj = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null
      const command = obj && typeof obj.command === 'string' ? obj.command : ''
      const dangerouslyDisableSandbox = Boolean(obj && (obj as any).dangerouslyDisableSandbox)

      const decision = classifyBashCommand({ command, mode: replMode, agentDepth: ctx.agentDepth })
      if (decision.risk === 'deny') {
        return {
          tool_use_id: call.id,
          content: `Error: Bash command denied (${decision.prefix}): ${decision.reason}`,
          is_error: true,
        }
      }

      const allowByRule = Boolean(explained.matchedRule && explained.decision === 'allow')
      const shouldPrompt = (decision.risk === 'confirm' || dangerouslyDisableSandbox) && !allowByRule
      if (shouldPrompt && effectiveDecision !== 'deny') effectiveDecision = 'prompt'

      // Repo-local permissions allow-list can bypass prompts (Claude Code style).
      // IMPORTANT: explicit policy "ask/prompt" rules must still prompt (ask > allow).
      const promptByRule = Boolean(explained.matchedRule && explained.decision === 'prompt')
      if (effectiveDecision === 'prompt' && !promptByRule) {
        const allow = await loadProjectPermissionsAllowList({ fileStore: args.fileStore, cwd })
        if (allow.size > 0 && matchesBashAllowList({ allow, command })) {
          effectiveDecision = 'allow'
        }
      }
    }

    if (args.audit) {
      void args.audit.append({
        schemaVersion: 1,
        ts: nowIso(),
        kind: 'policy.decision',
        agentDepth: ctx.agentDepth,
        tool: { name: call.name, toolUseId: call.id },
        replMode: replMode ?? undefined,
        action,
        decision: {
          raw: explained.decision,
          effective: effectiveDecision,
          matchedRule: explained.matchedRule,
          suggestions: explained.suggestions,
        },
      })
    }

    if (effectiveDecision === 'allow') return null

    if (effectiveDecision === 'deny') {
      const lines: string[] = []
      lines.push(`Error: Policy denied ${action.kind}`)
      lines.push(`ErrorCode: ${ErrorCode.PolicyDenied}`)
      lines.push(
        ...formatPolicyExplainLines({ effectiveDecision, explained, warnings: loaded.warnings }),
      )

      return { tool_use_id: call.id, content: lines.join('\n'), is_error: true }
    }

    // Some contexts (e.g. background tasks) deliberately disable interactive prompts.
    // In those cases, do not hang waiting for user input; return a stable error instead.
    if (ctx.interactive === false) {
      const lines: string[] = []
      lines.push(
        `Error: Policy requires approval for ${action.kind}, but interactive prompts are disabled in this context`,
      )
      lines.push(`ErrorCode: ${ErrorCode.ApprovalRequired}`)
      lines.push(
        ...formatPolicyExplainLines({ effectiveDecision, explained, warnings: loaded.warnings }),
      )
      return { tool_use_id: call.id, content: lines.join('\n'), is_error: true }
    }

    if (!args.approval) {
      const lines: string[] = []
      lines.push(`Error: Policy requires approval for ${action.kind}, but no approval service is configured`)
      lines.push(`ErrorCode: ${ErrorCode.ApprovalRequired}`)
      lines.push(
        ...formatPolicyExplainLines({ effectiveDecision, explained, warnings: loaded.warnings }),
      )
      return { tool_use_id: call.id, content: lines.join('\n'), is_error: true }
    }

    const approved = await args.approval.ensureApproved({
      call,
      ctx,
      action,
      effectiveDecision,
      explained,
      loaded,
    })
    if ('result' in approved) return approved.result
    return null
  }
}

function matchesBashAllowList(args: { allow: Set<string>; command: string }): boolean {
  const command = String(args.command || '').trim()
  if (!command) return false

  // Exact match is the safe default.
  if (args.allow.has(buildToolPermissionKey('Bash', command))) return true

  // Prefix match: Bash(<prefix>:*) means allow any command starting with <prefix>.
  // This mirrors Claude Code's documented behavior (operator-aware matching is handled
  // by the Bash command classifier; we also keep deny rules as highest priority).
  for (const raw of args.allow) {
    const m = /^Bash\((.*)\)$/.exec(String(raw))
    if (!m) continue
    const inner = String(m[1] ?? '')
    if (!inner.endsWith(':*')) continue
    const prefix = inner.slice(0, -2).trim()
    if (!prefix) continue
    if (command === prefix) return true
    if (command.startsWith(prefix)) {
      const next = command.slice(prefix.length, prefix.length + 1)
      if (!next || /\s/.test(next)) return true
    }
  }

  return false
}
