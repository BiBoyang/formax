import fs from 'node:fs/promises'
import path from 'node:path'
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
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso } from '../../core/audit/schema.js'
import { loadMergedPermissions } from '../../adapters/permissions/permissionsStore.js'
import { decideToolPermission } from '../../adapters/permissions/matcher.js'
import { detectWorkspaceRoots } from '../../adapters/fs/workspaceRoots.js'
import { formatPathForDisplay, normalizePathForCompare } from '../../utils/paths.js'
import type { HookRun } from '../../hooks/types.js'

function normalizeWorkspacePath(rawPath: string, cwd: string): string | null {
  const normalized = normalizePathForCompare(rawPath, cwd)
  if (!normalized) return null
  return path.resolve(normalized)
}

async function tryRealpath(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

async function canonicalizeForWorkspaceCheck(args: {
  fileStore: FileStore
  rawPath: string
  cwd: string
}): Promise<string | null> {
  const normalized = normalizeWorkspacePath(args.rawPath, args.cwd)
  if (!normalized) return null

  const exists = await args.fileStore.exists(normalized)
  if (exists) return (await tryRealpath(normalized)) ?? normalized

  let current = path.dirname(normalized)
  let last = ''
  for (let i = 0; i < 50 && current !== last; i++) {
    if (await args.fileStore.exists(current)) {
      const canonicalParent = (await tryRealpath(current)) ?? current
      const rel = path.relative(current, normalized)
      return path.join(canonicalParent, rel)
    }
    last = current
    current = path.dirname(current)
  }

  return normalized
}

function isPathWithinRoot(target: string, root: string): boolean {
  if (target === root) return true
  const rel = path.relative(root, target)
  if (!rel || rel === '.') return true
  if (rel === '..') return false
  return !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function isPathWithinRoots(target: string, roots: string[]): boolean {
  return roots.some((root) => isPathWithinRoot(target, root))
}

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
    const auditHookRuns = (eventName: string, runs: HookRun[]) => {
      if (!args.audit) return
      if (runs.length === 0) return
      for (const r of runs) {
        void args.audit.append({
          schemaVersion: 1,
          ts: nowIso(),
          kind: 'hook.run',
          agentDepth: ctx.agentDepth,
          tool: { name: call.name, toolUseId: call.id },
          hook: {
            eventName,
            command: r.command,
            exitCode: r.exitCode,
            signal: r.signal,
            timedOut: r.timedOut,
            durationMs: r.durationMs,
          },
        })
      }
    }
    let mergedPermissions: Awaited<ReturnType<typeof loadMergedPermissions>> | null = null
    const getMergedPermissions = async () => {
      // Important: permissions must take effect immediately after they are persisted
      // (e.g. approve_remember writes into settings.local.json). We therefore avoid
      // caching across tool calls; only memoize within the current preflight call.
      if (!mergedPermissions) {
        mergedPermissions = await loadMergedPermissions({
          fileStore: args.fileStore,
          cwd,
          env,
          platform: args.platform,
          homedir: args.homedir,
        })
      }
      return mergedPermissions
    }

    // Plan mode: only allow editing the plan file itself (no approvals for non-plan paths).
    if (action.kind === 'fs.write' && replMode === 'plan') {
      const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
      const isPlanFile = Boolean(planPath && isSameFilePath(action.path, planPath, cwd))
      if (!isPlanFile) {
        return {
          tool_use_id: call.id,
          content: 'Error: Plan mode is active. Only the plan file may be edited.',
          is_error: true,
        }
      }
      // Plan file edits should not prompt.
      return null
    }

    if (action.kind === 'fs.read' || action.kind === 'fs.write') {
      const rootsResult = await detectWorkspaceRoots({ fileStore: args.fileStore, cwd })
      const permissions = await getMergedPermissions()
      const rootCandidates = [
        ...rootsResult.workspaceRoots,
        ...permissions.workspace.additionalDirectories.map((entry) => entry.dir),
      ]
      const normalizedRoots = Array.from(
        new Set(
          rootCandidates
            .map((root) => normalizeWorkspacePath(root, cwd))
            .filter((root): root is string => Boolean(root)),
        ),
      )
      const canonicalRoots = Array.from(
        new Set(
          (await Promise.all(
            normalizedRoots.map((root) =>
              canonicalizeForWorkspaceCheck({ fileStore: args.fileStore, rawPath: root, cwd }),
            ),
          ))
            .filter((root): root is string => Boolean(root))
            .map((root) => path.resolve(root)),
        ),
      )
      const canonicalTargetPath = await canonicalizeForWorkspaceCheck({
        fileStore: args.fileStore,
        rawPath: action.path,
        cwd,
      })

      if (canonicalTargetPath && canonicalRoots.length && !isPathWithinRoots(canonicalTargetPath, canonicalRoots)) {
        return {
          tool_use_id: call.id,
          content: `Error: Path is outside the workspace\nPath: ${formatPathForDisplay(canonicalTargetPath)}`,
          is_error: true,
        }
      }
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
    let deniedByPermission = false

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

      // Claude Code semantics: repo-local permissions can suppress prompts for matching commands.
      // IMPORTANT:
      // - Explicit policy "prompt" rules must still prompt (ask > allow).
      // - permissions "ask" can also force prompts even if policy would allow.
      const promptByRule = Boolean(explained.matchedRule && explained.decision === 'prompt')
      const permissions = await getMergedPermissions()
      const perm = decideToolPermission({ permissions, toolName: 'Bash', toolSpec: command })

      if (perm.decision === 'deny') {
        effectiveDecision = 'deny'
        deniedByPermission = true
      } else if (perm.decision === 'ask') {
        if (effectiveDecision === 'allow') effectiveDecision = 'prompt'
      } else if (perm.decision === 'allow') {
        if (effectiveDecision === 'prompt' && !promptByRule) effectiveDecision = 'allow'
      }
    }

    if (call.name === 'WebFetch' || call.name === 'WebSearch') {
      const promptByRule = Boolean(explained.matchedRule && explained.decision === 'prompt')
      const denyByRule = Boolean(explained.matchedRule && explained.decision === 'deny')
      const permissions = await getMergedPermissions()
      const perm = decideToolPermission({ permissions, toolName: call.name })

      if (perm.decision === 'deny') {
        effectiveDecision = 'deny'
        deniedByPermission = true
      } else if (perm.decision === 'ask') {
        if (effectiveDecision === 'allow') effectiveDecision = 'prompt'
      } else if (perm.decision === 'allow') {
        if (!denyByRule && (effectiveDecision === 'prompt' ? !promptByRule : true)) {
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
      if (deniedByPermission) {
        return { tool_use_id: call.id, content: `Error: Permission denied ${call.name}`, is_error: true }
      }
      const reason = explained.matchedRule?.reason?.trim()
      if (reason) {
        return { tool_use_id: call.id, content: `Error: Policy denied ${action.kind}\nReason: ${reason}`, is_error: true }
      }

      return { tool_use_id: call.id, content: `Error: Policy denied ${action.kind}`, is_error: true }
    }

    // Sub-agents must not prompt (they cannot reliably coordinate approvals/UI input).
    if (ctx.agentDepth > 0) {
      return { tool_use_id: call.id, content: 'Error: Approval required', is_error: true }
    }

    // Some contexts (e.g. background tasks) deliberately disable interactive prompts.
    // In those cases, do not hang waiting for user input; return a stable error instead.
    if (ctx.interactive === false) {
      return { tool_use_id: call.id, content: `Error: Approval required for ${action.kind}`, is_error: true }
    }

    if (!args.approval) {
      return { tool_use_id: call.id, content: `Error: Approval required for ${action.kind}`, is_error: true }
    }

    if (ctx.hooks) {
      const permHook = await ctx.hooks.runPermissionRequest({
        toolName: call.name,
        toolInput: call.input ?? {},
        cwd,
        signal: ctx.signal,
      })
      auditHookRuns('PermissionRequest', permHook.runs)
      if (permHook.blocked) {
        const stderr = permHook.blockedBy?.stderr?.trim()
        const content = stderr ? `Error: Permission denied ${call.name}\n${stderr}` : `Error: Permission denied ${call.name}`
        return { tool_use_id: call.id, content, is_error: true }
      }
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
