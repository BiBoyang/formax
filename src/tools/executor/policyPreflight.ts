import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileStore } from '../../adapters/fs/fileStore.js'
import { getConfigPaths, type Platform } from '../../adapters/fs/configPaths.js'
import { loadPolicyRules } from '../../core/policy/store.js'
import type { PolicyAction } from '../../core/policy/types.js'
import type { ToolCall, ToolResult } from '../types.js'
import type { ExecutionContext, ToolPreflight } from './index.js'
import type { ApprovalService } from './approvalService.js'
import type { WorkspaceAccessRequest } from './approvalService.js'
import { classifyBashCommand } from '../modules/bash/policy.js'
import { probeRipgrepExecutable } from '../modules/grep/ripgrepBinary.js'
import { isSameFilePath } from '../../shared/utils/planMode.js'
import { explainPolicy } from '../../core/policy/engine.js'
import { toolCallToPolicyAction } from './policyAction.js'
import type { AuditLog } from '../../adapters/audit/auditLog.js'
import { nowIso, type TraceContext } from '../../core/audit/schema.js'
import { loadMergedPermissions } from '../../adapters/permissions/permissionsStore.js'
import { decideToolPermission } from '../../adapters/permissions/matcher.js'
import { detectWorkspaceRoots } from '../../adapters/fs/workspaceRoots.js'
import { formatPathForDisplay, normalizePathForCompare } from '../../shared/utils/paths.js'
import type { HookRun } from '../../hooks/types.js'
import { appendHookRunAuditEvents } from '../../hooks/audit.js'
import { createRuntimeFlags } from '../../config/runtimeFlags.js'
import { buildAutoMemoryDirectoryPath } from '../../shared/utils/autoMemoryPath.js'

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

async function isExistingDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p)
    return st.isDirectory()
  } catch {
    return false
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

const GREP_SYMLINK_SCAN_CACHE_TTL_MS = 5000

type GrepSymlinkScanCacheEntry = {
  escapedDir: string | null
  expiresAt: number
}

function createGrepSymlinkScanCacheKey(args: {
  rootDir: string
  workspaceRoots: string[]
}): string {
  const normalizedRoots = [...args.workspaceRoots].sort((a, b) => a.localeCompare(b))
  return `${args.rootDir}\n${normalizedRoots.join('\n')}`
}

async function findFirstExternalSymlinkDirectory(args: {
  rootDir: string
  workspaceRoots: string[]
}): Promise<string | null> {
  const visitedDirs = new Set<string>()
  const skipDirNames = new Set(['.git', 'node_modules'])

  async function inspectSymlinkTarget(linkPath: string): Promise<{
    escapedDir: string | null
    isDirectory: boolean
  }> {
    const realTarget = await tryRealpath(linkPath)
    if (!realTarget) {
      return { escapedDir: null, isDirectory: false }
    }

    let targetDir = realTarget
    let isDirectory = true
    try {
      const st = await fs.stat(realTarget)
      isDirectory = st.isDirectory()
      if (!isDirectory) targetDir = path.dirname(realTarget)
    } catch {
      isDirectory = false
      targetDir = path.dirname(realTarget)
    }

    const canonicalTargetDir = path.resolve(targetDir)
    if (!isPathWithinRoots(canonicalTargetDir, args.workspaceRoots)) {
      return { escapedDir: canonicalTargetDir, isDirectory }
    }
    return { escapedDir: null, isDirectory }
  }

  async function walk(dirPath: string): Promise<string | null> {
    const canonicalDir = (await tryRealpath(dirPath)) ?? path.resolve(dirPath)
    if (visitedDirs.has(canonicalDir)) return null
    visitedDirs.add(canonicalDir)

    let entries: Array<{ name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }> = []
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      if (skipDirNames.has(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)
      if (entry.isSymbolicLink()) {
        const symlink = await inspectSymlinkTarget(fullPath)
        if (symlink.escapedDir) return symlink.escapedDir
        if (symlink.isDirectory) {
          const nestedEscapedDir = await walk(fullPath)
          if (nestedEscapedDir) return nestedEscapedDir
        }
        continue
      }
      if (entry.isDirectory()) {
        const escapedDir = await walk(fullPath)
        if (escapedDir) return escapedDir
      }
    }

    return null
  }

  return await walk(args.rootDir)
}

export const __testOnlyPolicyPreflight = {
  normalizeWorkspacePath,
  tryRealpath,
  isExistingDirectory,
  canonicalizeForWorkspaceCheck,
  isPathWithinRoot,
  isPathWithinRoots,
  createGrepSymlinkScanCacheKey,
  findFirstExternalSymlinkDirectory,
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
  const deferredToolExposureEnabled = createRuntimeFlags(env).deferredToolExposureEnabled
  const grepSymlinkScanCache = new Map<string, GrepSymlinkScanCacheEntry>()
  const grepSymlinkScanInFlight = new Map<string, Promise<string | null>>()
  const getAutoMemoryWhitelistRoot = (cwd: string): string | null => {
    if (!deferredToolExposureEnabled) return null
    const globalConfigDir = getConfigPaths({
      cwd,
      env,
      platform: args.platform,
      homedir: args.homedir,
    }).globalConfigDir
    return normalizeWorkspacePath(
      buildAutoMemoryDirectoryPath({
        cwd,
        configDir: globalConfigDir,
      }),
      cwd,
    )
  }
  const resolveFirstEscapedGrepSymlinkDir = async (scanArgs: {
    rootDir: string
    workspaceRoots: string[]
  }): Promise<string | null> => {
    const cacheKey = createGrepSymlinkScanCacheKey(scanArgs)
    const now = Date.now()
    const cached = grepSymlinkScanCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.escapedDir

    const inFlight = grepSymlinkScanInFlight.get(cacheKey)
    if (inFlight) return await inFlight

    const scanPromise = findFirstExternalSymlinkDirectory(scanArgs)
      .then((escapedDir) => {
        grepSymlinkScanCache.set(cacheKey, {
          escapedDir,
          expiresAt: Date.now() + GREP_SYMLINK_SCAN_CACHE_TTL_MS,
        })
        return escapedDir
      })
      .finally(() => {
        grepSymlinkScanInFlight.delete(cacheKey)
      })

    grepSymlinkScanInFlight.set(cacheKey, scanPromise)
    return await scanPromise
  }

  return async (call, ctx): Promise<ToolResult | null> => {
    const action: PolicyAction | null = toolCallToPolicyAction(call, ctx)
    if (!action) return null

    const replMode = ctx.getReplMode?.() ?? ctx.replMode
    const cwd = ctx.cwd || process.cwd()
    let isAutoMemoryWriteTarget = false
    const traceForCall: TraceContext = { ...(ctx.trace ?? {}), toolUseId: call.id }
    let workspaceRequest: WorkspaceAccessRequest | null = null
    const auditHookRuns = (eventName: string, runs: HookRun[]) => {
      appendHookRunAuditEvents({
        audit: args.audit,
        env,
        tool: { name: call.name, toolUseId: call.id },
        agentDepth: ctx.agentDepth,
        eventName,
        runs,
        trace: traceForCall,
      })
    }
    const getMergedPermissions = async () => {
      // Important: permissions must take effect immediately after they are persisted
      // (e.g. approve_remember writes into settings.local.json). We intentionally
      // reload when requested instead of caching across calls.
      return await loadMergedPermissions({
        fileStore: args.fileStore,
        cwd,
        env,
        platform: args.platform,
        homedir: args.homedir,
      })
    }

    // Plan mode: only allow editing the plan file itself (no approvals for non-plan paths).
    if (action.kind === 'fs.write' && replMode === 'plan') {
      const planPath = ctx.getPlanPath?.() ?? ctx.planPath ?? null
      const isPlanFile = planPath ? isSameFilePath(action.path, planPath, cwd) : false
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

    const loaded = await loadPolicyRules({
      fileStore: args.fileStore,
      cwd: ctx.cwd,
      env,
      platform: args.platform,
      homedir: args.homedir,
    })

    if (call.name === 'Grep') {
      const rgPath = await probeRipgrepExecutable()
      if (!rgPath) {
        const installAction: PolicyAction = { kind: 'tool.install', tool: 'ripgrep' }
        const sessionRules = args.approval?.getSessionRules() ?? []
        const installExplained = explainPolicy({ action: installAction, rules: [...sessionRules, ...loaded.mergedRules] })
        const installDecision = installExplained.decision

        if (args.audit) {
          void args.audit.append({
            schemaVersion: 1,
            ts: nowIso(),
            kind: 'policy.decision',
            agentDepth: ctx.agentDepth,
            trace: traceForCall,
            tool: { name: call.name, toolUseId: call.id },
            replMode: replMode ?? undefined,
            action: installAction,
            decision: {
              raw: installExplained.decision,
              effective: installDecision,
              matchedRule: installExplained.matchedRule,
              suggestions: installExplained.suggestions,
            },
          })
        }

        if (installDecision === 'deny') {
          const reason = installExplained.matchedRule?.reason?.trim()
          if (reason) {
            return {
              tool_use_id: call.id,
              content: `Error: Policy denied ${installAction.kind}\nReason: ${reason}`,
              is_error: true,
            }
          }
          return { tool_use_id: call.id, content: `Error: Policy denied ${installAction.kind}`, is_error: true }
        }

        if (installDecision === 'prompt') {
          if (ctx.agentDepth > 0) {
            return { tool_use_id: call.id, content: 'Error: Approval required', is_error: true }
          }
          if (ctx.interactive === false) {
            return { tool_use_id: call.id, content: `Error: Approval required for ${installAction.kind}`, is_error: true }
          }
          if (!args.approval) {
            return { tool_use_id: call.id, content: `Error: Approval required for ${installAction.kind}`, is_error: true }
          }

          const approved = await args.approval.ensureApproved({
            call,
            ctx,
            action: installAction,
            effectiveDecision: installDecision,
            explained: installExplained,
            loaded,
          })
          if (approved.ok !== true) return approved.result
        }
      }
    }

    if (action.kind === 'fs.read' || action.kind === 'fs.write') {
      const rootsResult = await detectWorkspaceRoots({ fileStore: args.fileStore, cwd })
      const permissions = await getMergedPermissions()
      const autoMemoryWhitelistRoot = getAutoMemoryWhitelistRoot(cwd)
      const canonicalAutoMemoryRoot = autoMemoryWhitelistRoot
        ? await canonicalizeForWorkspaceCheck({
            fileStore: args.fileStore,
            rawPath: autoMemoryWhitelistRoot,
            cwd,
          })
        : null
      const rootCandidates = [
        ...rootsResult.workspaceRoots,
        ...permissions.workspace.additionalDirectories.map((entry) => entry.dir),
        ...(autoMemoryWhitelistRoot ? [autoMemoryWhitelistRoot] : []),
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
      if (action.kind === 'fs.write' && canonicalTargetPath && canonicalAutoMemoryRoot) {
        isAutoMemoryWriteTarget = isPathWithinRoot(canonicalTargetPath, path.resolve(canonicalAutoMemoryRoot))
      }

      if (canonicalTargetPath && canonicalRoots.length && !isPathWithinRoots(canonicalTargetPath, canonicalRoots)) {
        const isInteractiveMain = ctx.agentDepth === 0 && ctx.interactive !== false && Boolean(args.approval)
        if (!isInteractiveMain) {
          return {
            tool_use_id: call.id,
            content: `Error: Path is outside the workspace\nPath: ${formatPathForDisplay(canonicalTargetPath)}`,
            is_error: true,
          }
        }

        let dir = canonicalTargetPath
        if (action.kind === 'fs.write') {
          dir = path.dirname(canonicalTargetPath)
        } else if (!(await isExistingDirectory(canonicalTargetPath))) {
          dir = path.dirname(canonicalTargetPath)
        }

        workspaceRequest = { dir }
      }

      if (
        !workspaceRequest &&
        call.name === 'Grep' &&
        action.kind === 'fs.read' &&
        canonicalTargetPath &&
        canonicalRoots.length &&
        (await isExistingDirectory(canonicalTargetPath))
      ) {
        const firstEscapedDir = await resolveFirstEscapedGrepSymlinkDir({
          rootDir: canonicalTargetPath,
          workspaceRoots: canonicalRoots,
        })

        if (firstEscapedDir) {
          const isInteractiveMain = ctx.agentDepth === 0 && ctx.interactive !== false && Boolean(args.approval)
          if (!isInteractiveMain) {
            return {
              tool_use_id: call.id,
              content: `Error: Path is outside the workspace\nPath: ${formatPathForDisplay(firstEscapedDir)}`,
              is_error: true,
            }
          }
          workspaceRequest = { dir: firstEscapedDir }
        }
      }
    }

    const sessionRules = args.approval?.getSessionRules() ?? []
    const explained = explainPolicy({ action, rules: [...sessionRules, ...loaded.mergedRules] })
    let effectiveDecision = explained.decision
    const promptByPolicyRule = Boolean(explained.matchedRule && explained.decision === 'prompt')
    let deniedByPermission = false

    // acceptEdits mode: treat prompts as implicitly approved (still respects deny rules).
    if (action.kind === 'fs.write' && replMode === 'acceptEdits' && effectiveDecision === 'prompt') {
      effectiveDecision = 'allow'
    }

    if (workspaceRequest && effectiveDecision !== 'deny') {
      effectiveDecision = 'prompt'
    }

    if (
      action.kind === 'fs.write' &&
      isAutoMemoryWriteTarget &&
      effectiveDecision === 'prompt' &&
      !promptByPolicyRule
    ) {
      effectiveDecision = 'allow'
    }

    // Bash: require approval for commands our classifier marks as confirm (unless an allow rule matched).
    if (call.name === 'Bash' && action.kind === 'bash.exec') {
      const input = call.input as Record<string, unknown>
      const command = action.command
      const dangerouslyDisableSandbox = Boolean((input as any).dangerouslyDisableSandbox)

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
        trace: traceForCall,
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
        toolInput: call.input as Record<string, unknown>,
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
      workspaceRequest,
    })
    if ('result' in approved) return approved.result
    return null
  }
}
