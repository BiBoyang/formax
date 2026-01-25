import type { FileStore } from '../adapters/fs/fileStore.js'
import type { Platform } from '../adapters/fs/configPaths.js'
import { resolveFormaxProjectRoot } from '../adapters/fs/projectRoot.js'
import type { ToolResult } from '../tools/types.js'
import { hookMatcherMatchesToolName } from './matcher.js'
import { runCommandHooks, summarizeHookRuns } from './runner.js'
import { loadMergedHooks } from './store.js'
import type { HookEventName, HookRuleEntry, HookRun, MergedHooks } from './types.js'

function isDisabledByEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env.FORMAX_DISABLE_HOOKS ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function buildHookPayload(args: {
  hookEventName: HookEventName
  toolName: string
  toolInput: unknown
  toolResponse?: unknown
  cwd: string
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    hook_event_name: args.hookEventName,
    tool_name: args.toolName,
    tool_input: args.toolInput,
    cwd: args.cwd,
  }
  if (args.toolResponse !== undefined) payload.tool_response = args.toolResponse
  return payload
}

function buildUserPromptSubmitPayload(args: {
  prompt: string
  cwd: string
}): Record<string, unknown> {
  return {
    hook_event_name: 'UserPromptSubmit',
    prompt: args.prompt,
    cwd: args.cwd,
    permission_mode: 'default',
  }
}

function buildSessionStartPayload(args: {
  sessionId: string
  cwd: string
}): Record<string, unknown> {
  return {
    session_id: args.sessionId,
    hook_event_name: 'SessionStart',
    source: 'startup',
    cwd: args.cwd,
    permission_mode: 'default',
  }
}

function buildStopPayload(args: {
  sessionId: string
  cwd: string
  stopHookActive: boolean
}): Record<string, unknown> {
  return {
    session_id: args.sessionId,
    hook_event_name: 'Stop',
    stop_hook_active: args.stopHookActive,
    cwd: args.cwd,
    permission_mode: 'default',
  }
}

function extractAdditionalContextFromRun(args: {
  hookEventName: HookEventName
  run: HookRun
}): string | null {
  const parsed = args.run.parsedJson
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  // Claude docs show camelCase (`hookSpecificOutput.additionalContext`), but we also
  // accept snake_case for easier script migration.
  const hookSpecificOutput = (parsed as any).hookSpecificOutput ?? (parsed as any).hook_specific_output
  if (!hookSpecificOutput || typeof hookSpecificOutput !== 'object' || Array.isArray(hookSpecificOutput)) return null

  const hookEventName = (hookSpecificOutput as any).hookEventName ?? (hookSpecificOutput as any).hook_event_name
  if (hookEventName !== args.hookEventName) return null

  const additionalContext =
    (hookSpecificOutput as any).additionalContext ?? (hookSpecificOutput as any).additional_context
  if (typeof additionalContext !== 'string') return null

  const trimmed = additionalContext.trim()
  if (!trimmed) return null
  return trimmed
}

function filterHooksForToolName(entries: HookRuleEntry[], toolName: string): HookRuleEntry[] {
  return entries.filter((e) => hookMatcherMatchesToolName({ matcher: e.matcher, toolName }))
}

export type HooksRuntime = {
  runPreToolUse: (args: { toolName: string; toolInput: unknown; cwd: string; signal?: AbortSignal }) => Promise<{
    runs: HookRun[]
    blocked: boolean
    blockedBy?: HookRun
  }>
  runPermissionRequest: (args: { toolName: string; toolInput: unknown; cwd: string; signal?: AbortSignal }) => Promise<{
    runs: HookRun[]
    blocked: boolean
    blockedBy?: HookRun
  }>
  runUserPromptSubmit: (args: { prompt: string; cwd: string; signal?: AbortSignal }) => Promise<{
    runs: HookRun[]
    additionalContext: string[]
    blocked: boolean
    blockedBy?: HookRun
  }>
  runSessionStart: (args: { sessionId: string; cwd: string; signal?: AbortSignal }) => Promise<{
    runs: HookRun[]
    additionalContext: string[]
    blocked: boolean
    blockedBy?: HookRun
  }>
  runStop: (args: { sessionId: string; cwd: string; stopHookActive: boolean; signal?: AbortSignal }) => Promise<{
    runs: HookRun[]
    additionalContext: string[]
    blocked: boolean
    blockedBy?: HookRun
  }>
  runPostToolUse: (args: {
    toolUseId: string
    toolName: string
    toolInput: unknown
    toolResult: ToolResult
    cwd: string
    signal?: AbortSignal
  }) => Promise<{
    runs: HookRun[]
    additionalContext: string[]
    blockingErrors: Array<{ command: string; stderr: string }>
  }>
}

export function createHooksRuntime(args: {
  fileStore: FileStore
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
}): HooksRuntime {
  const env = args.env ?? process.env

  async function loadHooks(cwd: string): Promise<MergedHooks> {
    return await loadMergedHooks({
      fileStore: args.fileStore,
      cwd,
      env,
      platform: args.platform,
      homedir: args.homedir,
    })
  }

  function buildExecEnv(cwd: string): Record<string, string | undefined> {
    const projectRoot = resolveFormaxProjectRoot(cwd || process.cwd())
    return {
      ...env,
      CLAUDE_PROJECT_DIR: projectRoot,
      FORMAX_PROJECT_DIR: projectRoot,
    }
  }

  async function runEvent(args2: {
    eventName: HookEventName
    toolName: string
    toolInput: unknown
    toolResponse?: unknown
    cwd: string
    signal?: AbortSignal
  }): Promise<HookRun[]> {
    if (isDisabledByEnv(env)) return []

    const merged = await loadHooks(args2.cwd)
    const entries = filterHooksForToolName(merged[args2.eventName], args2.toolName)
    if (entries.length === 0) return []

      const payload = buildHookPayload({
        hookEventName: args2.eventName,
        toolName: args2.toolName,
        toolInput: args2.toolInput,
        toolResponse: args2.toolResponse,
        cwd: args2.cwd,
      })

    return await runCommandHooks({
      hooks: entries,
      payload,
      cwd: args2.cwd,
      env: buildExecEnv(args2.cwd),
      signal: args2.signal,
    })
  }

  return {
    async runPreToolUse({ toolName, toolInput, cwd, signal }) {
      const runs = await runEvent({ eventName: 'PreToolUse', toolName, toolInput, cwd, signal })
      const { blocked } = summarizeHookRuns(runs)
      return { runs, blocked: blocked.length > 0, blockedBy: blocked[0] ?? undefined }
    },

    async runPermissionRequest({ toolName, toolInput, cwd, signal }) {
      const runs = await runEvent({ eventName: 'PermissionRequest', toolName, toolInput, cwd, signal })
      const { blocked } = summarizeHookRuns(runs)
      return { runs, blocked: blocked.length > 0, blockedBy: blocked[0] ?? undefined }
    },

    async runUserPromptSubmit({ prompt, cwd, signal }) {
      if (isDisabledByEnv(env)) return { runs: [], additionalContext: [], blocked: false }

      const merged = await loadHooks(cwd)
      const entries = merged.UserPromptSubmit
      if (entries.length === 0) return { runs: [], additionalContext: [], blocked: false }

      const runs = await runCommandHooks({
        hooks: entries,
        payload: buildUserPromptSubmitPayload({ prompt, cwd }),
        cwd,
        env: buildExecEnv(cwd),
        signal,
      })

      // Phase 1: we execute hooks and record their exit codes, but we do NOT
      // block the model call based on UserPromptSubmit. Blocking semantics can
      // be added later once we have a clear transcript/history UX.
      // We still surface exitCode=2 in `runs`, but we don't treat it as "blocked".
      const { blocked } = summarizeHookRuns(runs)

      const additionalContext = runs
        .map((r) => extractAdditionalContextFromRun({ hookEventName: 'UserPromptSubmit', run: r }))
        .filter((v): v is string => Boolean(v))

      // Claude docs: for UserPromptSubmit, stdout is injected into context on success.
      // We only do that when stdout is *not* JSON (to avoid injecting raw JSON blobs).
      for (const r of runs) {
        if (r.exitCode !== 0) continue
        if (r.parsedJson !== null) continue
        const text = String(r.stdout ?? '').trim()
        if (!text) continue
        additionalContext.push(text)
      }

      return { runs, additionalContext, blocked: false, blockedBy: undefined }
    },

    async runSessionStart({ sessionId, cwd, signal }) {
      if (isDisabledByEnv(env)) return { runs: [], additionalContext: [], blocked: false }

      const merged = await loadHooks(cwd)
      const entries = merged.SessionStart
      if (entries.length === 0) return { runs: [], additionalContext: [], blocked: false }

      const runs = await runCommandHooks({
        hooks: entries,
        payload: buildSessionStartPayload({ sessionId, cwd }),
        cwd,
        env: buildExecEnv(cwd),
        signal,
      })

      // Claude docs: SessionStart does not have blocking semantics; exitCode=2 is
      // "not applicable" and should only be surfaced to the user in detail mode.
      const additionalContext = runs
        .map((r) => extractAdditionalContextFromRun({ hookEventName: 'SessionStart', run: r }))
        .filter((v): v is string => Boolean(v))

      // Claude docs: for SessionStart, stdout is injected into context on success.
      // We only do that when stdout is *not* JSON (to avoid injecting raw JSON blobs).
      for (const r of runs) {
        if (r.exitCode !== 0) continue
        if (r.parsedJson !== null) continue
        const text = String(r.stdout ?? '').trim()
        if (!text) continue
        additionalContext.push(text)
      }

      return { runs, additionalContext, blocked: false, blockedBy: undefined }
    },

    async runStop({ sessionId, cwd, stopHookActive, signal }) {
      if (isDisabledByEnv(env)) return { runs: [], additionalContext: [], blocked: false }

      const merged = await loadHooks(cwd)
      const entries = merged.Stop
      if (entries.length === 0) return { runs: [], additionalContext: [], blocked: false }

      const runs = await runCommandHooks({
        hooks: entries,
        payload: buildStopPayload({ sessionId, cwd, stopHookActive }),
        cwd,
        env: buildExecEnv(cwd),
        signal,
      })

      // Phase 1: execute and record exit codes, but do not block the app flow.
      // We still surface exitCode=2 in `runs` for audit/debug.

      const additionalContext = runs
        .map((r) => extractAdditionalContextFromRun({ hookEventName: 'Stop', run: r }))
        .filter((v): v is string => Boolean(v))

      // Claude docs: for Stop, stdout is injected into context on success.
      // We only do that when stdout is *not* JSON (to avoid injecting raw JSON blobs).
      for (const r of runs) {
        if (r.exitCode !== 0) continue
        if (r.parsedJson !== null) continue
        const text = String(r.stdout ?? '').trim()
        if (!text) continue
        additionalContext.push(text)
      }

      return { runs, additionalContext, blocked: false, blockedBy: undefined }
    },

    async runPostToolUse({ toolUseId: _toolUseId, toolName, toolInput, toolResult, cwd, signal }) {
      const runs = await runEvent({
        eventName: 'PostToolUse',
        toolName,
        toolInput,
        toolResponse: toolResult,
        cwd,
        signal,
      })

      const { blocked } = summarizeHookRuns(runs)
      const blockingErrors = blocked.map((r) => ({ command: r.command, stderr: r.stderr.trim() }))

      const additionalContext = runs
        .map((r) => extractAdditionalContextFromRun({ hookEventName: 'PostToolUse', run: r }))
        .filter((v): v is string => Boolean(v))

      return { runs, additionalContext, blockingErrors }
    },
  }
}
