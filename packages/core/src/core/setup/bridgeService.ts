import { loadRuntimeConfig } from '../../config/config.js'
import { getConfigPaths } from '../../config/configPaths.js'
import type { FileStore } from '../../config/settings/fileStore.js'
import type { Platform } from '../../config/settings/paths.js'
import { configShow } from '../../config/settings/show.js'
import type { CapabilitySource, ModelTier, ProviderId } from '../../config/settings/schema.js'
import { getSetupConfiguredReason, type SetupStatusReason } from './configuredStatus.js'
import { createSetupSession, type ConnectionTester, type SetupSession, type SetupSessionState } from './session.js'
import type {
  SetupAnthropicVendor,
  SetupDraft,
  SetupModelMode,
  SetupProviderOption,
} from './types.js'

export type WebSetupMode = 'require-config' | 'allow'

export type { SetupStatusReason } from './configuredStatus.js'

export type SetupAuthSource = 'env' | 'auth_store' | 'none'

export type SetupStatusResult = {
  schemaVersion: 1
  complete: boolean
  restartRequired?: boolean
  reason: SetupStatusReason
  effective: {
    provider: ProviderId
    baseUrl: string
    model: string
    authRef: string
    apiKeySource: SetupAuthSource
  }
  warnings: string[]
}

export type RedactedSetupDraft = Omit<SetupDraft, 'apiKey'> & {
  apiKeyPresent: boolean
  apiKeyPreview: string
}

export type SetupSessionView = Omit<SetupSessionState, 'draft'> & {
  id: string
  draft: RedactedSetupDraft
}

export type SetupBridgeAction =
  | { type: 'setProvider'; provider: ProviderId }
  | { type: 'setAnthropicVendor'; vendor: SetupAnthropicVendor }
  | { type: 'setBaseUrl'; baseUrl: string }
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'setModelMode'; mode: SetupModelMode }
  | { type: 'setModel'; model: string }
  | { type: 'setTierModel'; tier: ModelTier; model: string }
  | { type: 'next' }
  | { type: 'back' }

export type SetupBridgeActionResult =
  | { ok: true; session: SetupSessionView }
  | { ok: false; code: 'session_not_found'; message: string }

export type SetupBridgeCommitResult =
  | {
      ok: true
      schemaVersion: 1
      paths: {
        configPath: string
        authPath: string
        logsDir: string
      }
      warnings: string[]
      status: SetupStatusResult
    }
  | { ok: false; code: 'session_not_found' | 'incomplete_setup' | 'write_failed' | 'commit_in_progress'; message: string }

export type SetupBridgeService = {
  status: () => Promise<SetupStatusResult>
  createSession: () => SetupSessionView
  applyAction: (sessionId: string, action: SetupBridgeAction) => Promise<SetupBridgeActionResult>
  commit: (sessionId: string) => Promise<SetupBridgeCommitResult>
  disposeSession: (sessionId: string) => void
  cleanupExpiredSessions: () => number
  shutdown: () => void
}

export type WriteSetupDraftResult = {
  configPath: string
  authPath: string
  logsDir: string
  warnings: string[]
}

type SetupBridgeEntry = {
  session: SetupSession
  expiresAtMs: number
  lastUsedMs: number
  cleanupTimer: unknown
  committing: boolean
}

type WriteSetupOptions = { persistApiKey?: boolean; authRef?: string }
type WriteSetupDraft = (draft: SetupDraft, options?: WriteSetupOptions) => Promise<WriteSetupDraftResult>
type CommitDraft = { draft: SetupDraft; persistApiKey: boolean; authRef: string }

export const DEFAULT_SETUP_SESSION_TTL_MS = 30 * 60 * 1000
const SETUP_MODEL_TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus']

function redactApiKey(apiKey: string): Pick<RedactedSetupDraft, 'apiKeyPresent' | 'apiKeyPreview'> {
  const raw = String(apiKey || '')
  if (!raw) return { apiKeyPresent: false, apiKeyPreview: '' }
  if (raw.length <= 4) return { apiKeyPresent: true, apiKeyPreview: '****' }
  return { apiKeyPresent: true, apiKeyPreview: `****${raw.slice(-4)}` }
}

function redactState(id: string, state: SetupSessionState): SetupSessionView {
  const { apiKey: _apiKey, ...draft } = state.draft
  return {
    ...state,
    id,
    draft: {
      ...draft,
      ...redactApiKey(state.draft.apiKey),
    },
  }
}

function mapAuthSource(args: { env: NodeJS.ProcessEnv; authSource: string | undefined; apiKey: string }): SetupAuthSource {
  if (String(args.env.FORMAX_API_KEY || '').trim()) return 'env'
  if (args.apiKey.trim()) return 'auth_store'
  if (args.authSource && args.authSource !== 'default') return 'auth_store'
  return 'none'
}

function requireCommitDraft(
  state: SetupSessionState,
  env: NodeJS.ProcessEnv,
  runtimeAuth: { apiKey: string; provider: ProviderId; authRef: string },
): { ok: true; commit: CommitDraft } | { ok: false; message: string } {
  const draft = state.draft
  if (state.step !== 'write') return { ok: false, message: 'Complete setup validation before writing setup.' }
  if (!draft.provider) return { ok: false, message: 'Select a provider before writing setup.' }
  const draftApiKey = draft.apiKey.trim()
  const envApiKey = String(env.FORMAX_API_KEY || '').trim()
  const providerMatchesRuntime = draft.provider === runtimeAuth.provider
  const resolvedStoreApiKey = providerMatchesRuntime ? runtimeAuth.apiKey.trim() : ''
  const apiKey = draftApiKey || envApiKey || resolvedStoreApiKey
  if (!apiKey) return { ok: false, message: 'Enter an API key before writing setup.' }
  if (!draft.baseUrl.trim()) return { ok: false, message: 'Enter a base URL before writing setup.' }
  const model = draft.model.trim() || draft.tierModels.sonnet.trim()
  if (!model) return { ok: false, message: 'Select a model before writing setup.' }
  const usesEnvApiKey = Boolean(envApiKey && apiKey === envApiKey)
  const usesStoreApiKey = Boolean(!usesEnvApiKey && resolvedStoreApiKey && apiKey === resolvedStoreApiKey)
  const reusedRuntimeKey = Boolean(
    draftApiKey &&
      (draftApiKey === envApiKey || (providerMatchesRuntime && draftApiKey === resolvedStoreApiKey)),
  )
  const persistApiKey = usesEnvApiKey
    ? false
    : draftApiKey
      ? !reusedRuntimeKey
      : usesStoreApiKey
        ? !providerMatchesRuntime
        : false
  return {
    ok: true,
    commit: {
      draft: { ...draft, apiKey },
      persistApiKey,
      authRef: providerMatchesRuntime ? runtimeAuth.authRef : 'default',
    },
  }
}

function prepareCommitDraft(draft: SetupDraft): SetupDraft {
  if (draft.modelMode === 'quick') {
    const tierSources = Object.values(draft.tierContextWindowSources ?? {})
    const hasAuthoritativeTierSource = tierSources.some((source) => source && source !== 'heuristic')
    if (!hasAuthoritativeTierSource) {
      return {
        ...draft,
        contextWindowTokens: undefined,
        contextWindowBinding: undefined,
        tierContextWindowTokens: {},
        tierContextWindowSources: undefined,
        tierContextWindowConfidence: undefined,
        tierContextWindowBindings: undefined,
      }
    }
  }

  const tierContextWindowTokens = draft.tierContextWindowTokens
  const tierContextWindowSources: Partial<Record<ModelTier, CapabilitySource>> = {
    ...(draft.tierContextWindowSources ?? {}),
  }

  for (const tier of SETUP_MODEL_TIERS) {
    if (tierContextWindowTokens[tier] == null) continue
    tierContextWindowSources[tier] ??= 'heuristic'
  }

  return {
    ...draft,
    tierContextWindowSources,
  }
}

export function createSetupBridgeService(args: {
  providers: SetupProviderOption[]
  fileStore: FileStore
  testConnection: ConnectionTester
  writeSetup: WriteSetupDraft
  createSessionId: () => string
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: Platform
  homedir?: string
  nowMs?: () => number
  sessionTtlMs?: number
  maxSessions?: number
  setSessionCleanupTimer?: (callback: () => void, delayMs: number) => unknown
  clearSessionCleanupTimer?: (timer: unknown) => void
}): SetupBridgeService {
  const env = args.env ?? process.env
  const cwd = args.cwd ?? process.cwd()
  const platform = args.platform ?? process.platform
  const nowMs = args.nowMs ?? (() => Date.now())
  const sessionTtlMs = args.sessionTtlMs ?? DEFAULT_SETUP_SESSION_TTL_MS
  const maxSessions = args.maxSessions ?? 8
  const setSessionCleanupTimer =
    args.setSessionCleanupTimer ??
    ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref?.()
      return timer
    })
  const clearSessionCleanupTimer = args.clearSessionCleanupTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const sessions = new Map<string, SetupBridgeEntry>()

  const deleteSession = (sessionId: string): boolean => {
    const entry = sessions.get(sessionId)
    if (!entry) return false
    clearSessionCleanupTimer(entry.cleanupTimer)
    return sessions.delete(sessionId)
  }

  const scheduleCleanup = (sessionId: string, entry: SetupBridgeEntry) => {
    clearSessionCleanupTimer(entry.cleanupTimer)
    entry.cleanupTimer = setSessionCleanupTimer(() => {
      const current = sessions.get(sessionId)
      if (!current || current.expiresAtMs > nowMs()) return
      deleteSession(sessionId)
    }, sessionTtlMs)
  }

  const getEntry = (sessionId: string): SetupBridgeEntry | null => {
    cleanupExpiredSessions()
    return sessions.get(sessionId) ?? null
  }

  const touch = (sessionId: string, entry: SetupBridgeEntry) => {
    const now = nowMs()
    entry.expiresAtMs = now + sessionTtlMs
    entry.lastUsedMs = now
    scheduleCleanup(sessionId, entry)
  }

  function cleanupExpiredSessions(): number {
    const now = nowMs()
    let removed = 0
    for (const [id, entry] of sessions) {
      if (entry.expiresAtMs > now) continue
      deleteSession(id)
      removed += 1
    }
    return removed
  }

  async function readStatusSnapshot(): Promise<SetupStatusResult> {
    try {
      const [runtime, shown] = await Promise.all([
        loadRuntimeConfig(env, cwd, { fileStore: args.fileStore, platform, homedir: args.homedir }),
        configShow({
          fileStore: args.fileStore,
          paths: getConfigPaths({ cwd, env, platform, homedir: args.homedir }),
          cwd,
          env,
          platform,
          homedir: args.homedir,
        }),
      ])
      const reason = getSetupConfiguredReason({ runtime })
      return {
        schemaVersion: 1,
        complete: reason === 'configured',
        reason,
        effective: {
          provider: runtime.llm.provider,
          baseUrl: runtime.llm.baseUrl,
          model: runtime.llm.model,
          authRef: runtime.llm.authRef ?? 'default',
          apiKeySource: mapAuthSource({ env, authSource: shown.auth?.source, apiKey: runtime.llm.apiKey }),
        },
        warnings: shown.warnings,
      }
    } catch (err) {
      return {
        schemaVersion: 1,
        complete: false,
        reason: 'invalid_config',
        effective: {
          provider: 'anthropic',
          baseUrl: '',
          model: '',
          authRef: 'default',
          apiKeySource: 'none',
        },
        warnings: [err instanceof Error ? err.message : String(err)],
      }
    }
  }

  const startupCompletePromise = readStatusSnapshot()
    .then((status) => status.complete)
    .catch(() => false)

  async function readStatus(): Promise<SetupStatusResult> {
    const [status, initialComplete] = await Promise.all([readStatusSnapshot(), startupCompletePromise])
    return {
      ...status,
      restartRequired: initialComplete === false && status.complete === true,
    }
  }

  async function readRuntimeAuth(): Promise<{ apiKey: string; provider: ProviderId; authRef: string }> {
    try {
      const runtime = await loadRuntimeConfig(env, cwd, { fileStore: args.fileStore, platform, homedir: args.homedir })
      return {
        apiKey: runtime.llm.apiKey.trim(),
        provider: runtime.llm.provider,
        authRef: runtime.llm.authRef ?? 'default',
      }
    } catch {
      return { apiKey: '', provider: 'anthropic', authRef: 'default' }
    }
  }

  return {
    status: readStatus,

    createSession(): SetupSessionView {
      cleanupExpiredSessions()
      while (sessions.size >= maxSessions) {
        let leastRecentlyUsed: string | null = null
        let leastRecentlyUsedAt = Number.POSITIVE_INFINITY
        for (const [id, entry] of sessions) {
          if (entry.lastUsedMs >= leastRecentlyUsedAt) continue
          leastRecentlyUsed = id
          leastRecentlyUsedAt = entry.lastUsedMs
        }
        if (!leastRecentlyUsed) break
        deleteSession(leastRecentlyUsed)
      }
      const id = args.createSessionId()
      const session = createSetupSession({
        providers: args.providers,
        testConnection: args.testConnection,
      })
      const envApiKey = String(env.FORMAX_API_KEY || '').trim()
      if (envApiKey) session.setApiKey(envApiKey)
      const now = nowMs()
      const entry: SetupBridgeEntry = {
        session,
        expiresAtMs: now + sessionTtlMs,
        lastUsedMs: now,
        cleanupTimer: null,
        committing: false,
      }
      scheduleCleanup(id, entry)
      sessions.set(id, entry)
      return redactState(id, session.getState())
    },

    async applyAction(sessionId: string, action: SetupBridgeAction): Promise<SetupBridgeActionResult> {
      const entry = getEntry(sessionId)
      if (!entry) {
        return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
      }

      if (action.type === 'next' && entry.session.getState().step === 'apiKey' && !entry.session.getState().draft.apiKey.trim()) {
        const state = entry.session.getState()
        const runtimeAuth = await readRuntimeAuth()
        const envApiKey = String(env.FORMAX_API_KEY || '').trim()
        if (runtimeAuth.apiKey && (envApiKey || state.draft.provider === runtimeAuth.provider)) {
          entry.session.setApiKey(runtimeAuth.apiKey)
        }
      }

      switch (action.type) {
        case 'setProvider':
          entry.session.setProvider(action.provider)
          break
        case 'setAnthropicVendor':
          entry.session.setAnthropicVendor(action.vendor)
          break
        case 'setBaseUrl':
          entry.session.setBaseUrl(action.baseUrl)
          break
        case 'setApiKey':
          entry.session.setApiKey(action.apiKey)
          break
        case 'setModelMode':
          entry.session.setModelMode(action.mode)
          break
        case 'setModel':
          entry.session.setModel(action.model)
          break
        case 'setTierModel':
          entry.session.setTierModel(action.tier, action.model)
          break
        case 'next':
          await entry.session.next()
          break
        case 'back':
          entry.session.back()
          break
      }

      touch(sessionId, entry)
      return { ok: true, session: redactState(sessionId, entry.session.getState()) }
    },

    async commit(sessionId: string): Promise<SetupBridgeCommitResult> {
      const entry = getEntry(sessionId)
      if (!entry) {
        return { ok: false, code: 'session_not_found', message: 'Setup session was not found or has expired.' }
      }
      if (entry.committing) {
        return { ok: false, code: 'commit_in_progress', message: 'Setup write is already in progress.' }
      }
      const state = entry.session.getState()
      const required = requireCommitDraft(state, env, await readRuntimeAuth())
      if (required.ok === false) return { ok: false, code: 'incomplete_setup', message: required.message }

      let written: WriteSetupDraftResult
      entry.committing = true
      try {
        written = await args.writeSetup(prepareCommitDraft(required.commit.draft), {
          persistApiKey: required.commit.persistApiKey,
          authRef: required.commit.authRef,
        })
      } catch {
        entry.committing = false
        return { ok: false, code: 'write_failed', message: 'Failed to write setup files.' }
      }
      deleteSession(sessionId)
      const status = await readStatus()
      return {
        ok: true,
        schemaVersion: 1,
        paths: {
          configPath: written.configPath,
          authPath: written.authPath,
          logsDir: written.logsDir,
        },
        warnings: written.warnings,
        status,
      }
    },

    disposeSession(sessionId: string): void {
      deleteSession(sessionId)
    },

    cleanupExpiredSessions,

    shutdown(): void {
      for (const id of sessions.keys()) deleteSession(id)
    },
  }
}
