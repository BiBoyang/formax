import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import type { ConnectionTestResult, SetupDraft, SetupProviderOption } from './types.js'
import { createSetupBridgeService } from './bridgeService.js'

const PROVIDERS: SetupProviderOption[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'gemini', label: 'Gemini', disabled: true },
]

const ok = (models: string[]): ConnectionTestResult => ({ ok: true, models })

function createSessionIdFactory(): () => string {
  let next = 0
  return () => `session-${next++}`
}

async function completeSessionToWrite(service: ReturnType<typeof createSetupBridgeService>, sessionId: string): Promise<void> {
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'setProvider', provider: 'anthropic' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'setApiKey', apiKey: 'sk-write-secret' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'setModel', model: 'model-a' })
  await service.applyAction(sessionId, { type: 'next' })
  await service.applyAction(sessionId, { type: 'next' })
}

async function withTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), name))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe('createSetupBridgeService', () => {
  it('reports setup status without exposing secrets', async () => {
    await withTempDir('formax-setup-bridge-status-', async (dir) => {
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['claude-sonnet'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })

      const status = await service.status()

      expect(status).toMatchObject({
        schemaVersion: 1,
        complete: false,
        reason: 'missing_api_key',
        effective: {
          provider: 'anthropic',
          apiKeySource: 'none',
        },
      })
      expect(JSON.stringify(status)).not.toContain('sk-')
    })
  })

  it('reports a complete env-backed setup with a redacted auth source', async () => {
    await withTempDir('formax-setup-bridge-env-status-', async (dir) => {
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['claude-sonnet'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: {
          FORMAX_CONFIG_DIR: path.join(dir, 'global'),
          FORMAX_API_KEY: 'sk-env-secret',
          FORMAX_BASE_URL: 'https://api.anthropic.com/v1',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet',
        } as any,
      })

      const status = await service.status()

      expect(status.complete).toBe(true)
      expect(status.reason).toBe('configured')
      expect(status.effective).toMatchObject({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet',
        apiKeySource: 'env',
      })
      expect(JSON.stringify(status)).not.toContain('sk-env-secret')
    })
  })

  it('reports a complete auth-store-backed setup with a redacted auth source', async () => {
    await withTempDir('formax-setup-bridge-auth-status-', async (dir) => {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet',
          authRef: 'team',
        },
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            team: { apiKey: 'sk-auth-secret' },
          },
        },
      })
      await store.writeJsonAtomic(path.join(projectDir, '.formax', 'config.json'), {
        version: 1,
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          defaultTier: 'sonnet',
          tierModels: { sonnet: 'claude-sonnet' },
        },
      })
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: store,
        testConnection: vi.fn(async () => ok(['claude-sonnet'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: projectDir,
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
      })

      const status = await service.status()

      expect(status.complete).toBe(true)
      expect(status.reason).toBe('configured')
      expect(status.effective.apiKeySource).toBe('auth_store')
      expect(JSON.stringify(status)).not.toContain('sk-auth-secret')
    })
  })

  it('marks setup restart required when startup was incomplete and config becomes complete later', async () => {
    await withTempDir('formax-setup-bridge-restart-required-', async (dir) => {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: store,
        testConnection: vi.fn(async () => ok(['claude-sonnet'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: projectDir,
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
      })

      await expect(service.status()).resolves.toMatchObject({ complete: false, restartRequired: false })

      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet',
        },
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-auth-secret' },
          },
        },
      })

      await expect(service.status()).resolves.toMatchObject({
        complete: true,
        restartRequired: true,
      })
    })
  })

  it('keeps API keys inside ephemeral sessions and returns redacted views', async () => {
    await withTempDir('formax-setup-bridge-session-', async (dir) => {
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })

      const session = service.createSession()
      const updated = await service.applyAction(session.id, { type: 'setApiKey', apiKey: 'sk-very-secret' })

      expect(updated.ok).toBe(true)
      if (!updated.ok) return
      expect(updated.session.draft.apiKeyPresent).toBe(true)
      expect(updated.session.draft.apiKeyPreview).toBe('****cret')
      expect('apiKey' in updated.session.draft).toBe(false)
      expect(JSON.stringify(updated.session)).not.toContain('sk-very-secret')

      service.disposeSession(session.id)
      const afterDispose = await service.applyAction(session.id, { type: 'next' })
      expect(afterDispose).toMatchObject({ ok: false, code: 'session_not_found' })
    })
  })

  it('expires stale sessions before accepting new actions', async () => {
    await withTempDir('formax-setup-bridge-expire-', async (dir) => {
      let now = 100
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
        nowMs: () => now,
        sessionTtlMs: 10,
      })

      const session = service.createSession()
      now = 111

      expect(service.cleanupExpiredSessions()).toBe(1)
      const result = await service.applyAction(session.id, { type: 'next' })
      expect(result).toMatchObject({ ok: false, code: 'session_not_found' })
    })
  })

  it('expires secret-bearing sessions on the scheduled cleanup timer', async () => {
    await withTempDir('formax-setup-bridge-timer-expire-', async (dir) => {
      let now = 100
      const cleanupCallbacks: Array<() => void> = []
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
        nowMs: () => now,
        sessionTtlMs: 10,
        setSessionCleanupTimer: (callback) => {
          cleanupCallbacks.push(callback)
          return callback
        },
        clearSessionCleanupTimer: () => undefined,
      })

      const session = service.createSession()
      await service.applyAction(session.id, { type: 'setApiKey', apiKey: 'sk-timer-secret' })
      now = 111
      cleanupCallbacks.at(-1)?.()

      const result = await service.applyAction(session.id, { type: 'next' })
      expect(result).toMatchObject({ ok: false, code: 'session_not_found' })
    })
  })

  it('evicts the least recently used session when the session cap is reached', async () => {
    await withTempDir('formax-setup-bridge-lru-', async (dir) => {
      let now = 100
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
        nowMs: () => now,
        maxSessions: 2,
        setSessionCleanupTimer: (callback) => callback,
        clearSessionCleanupTimer: () => undefined,
      })

      const first = service.createSession()
      now = 101
      const second = service.createSession()
      now = 102
      await service.applyAction(first.id, { type: 'setApiKey', apiKey: 'sk-active-secret' })
      now = 103
      const third = service.createSession()

      expect(third.id).toBe('session-2')
      await expect(service.applyAction(second.id, { type: 'next' })).resolves.toMatchObject({
        ok: false,
        code: 'session_not_found',
      })
      await expect(service.applyAction(first.id, { type: 'next' })).resolves.toMatchObject({ ok: true })
    })
  })

  it('rejects commits before setup validation reaches the write step', async () => {
    await withTempDir('formax-setup-bridge-commit-gate-', async (dir) => {
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })
      const session = service.createSession()

      await service.applyAction(session.id, { type: 'setProvider', provider: 'anthropic' })
      await service.applyAction(session.id, { type: 'setBaseUrl', baseUrl: 'https://api.anthropic.com/v1/' })
      await service.applyAction(session.id, { type: 'setApiKey', apiKey: 'sk-write-secret' })
      await service.applyAction(session.id, { type: 'setModel', model: 'model-a' })

      const committed = await service.commit(session.id)

      expect(committed).toMatchObject({
        ok: false,
        code: 'incomplete_setup',
        message: 'Complete setup validation before writing setup.',
      })
    })
  })

  it('commits complete setup drafts through the injected writer and disposes the session', async () => {
    await withTempDir('formax-setup-bridge-commit-', async (dir) => {
      const writeSetup = vi.fn(async (_draft: SetupDraft) => ({
        configPath: path.join(dir, 'global', 'config.json'),
        authPath: path.join(dir, 'global', 'auth.json'),
        logsDir: path.join(dir, 'global', 'logs'),
        warnings: ['writer-warning'],
      }))
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup,
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })
      const session = service.createSession()

      await completeSessionToWrite(service, session.id)

      const committed = await service.commit(session.id)

      expect(committed.ok).toBe(true)
      if (!committed.ok) return
      expect(committed.schemaVersion).toBe(1)
      expect(committed.warnings).toEqual(['writer-warning'])
      expect(writeSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          apiKey: 'sk-write-secret',
          baseUrl: 'https://api.deepseek.com/anthropic',
          model: 'model-a',
          contextWindowTokens: undefined,
          contextWindowBinding: undefined,
          tierContextWindowTokens: {},
          tierContextWindowSources: undefined,
          tierContextWindowConfidence: undefined,
          tierContextWindowBindings: undefined,
        }),
        { persistApiKey: true, authRef: 'default' },
      )

      const afterCommit = await service.applyAction(session.id, { type: 'next' })
      expect(afterCommit).toMatchObject({ ok: false, code: 'session_not_found' })
    })
  })

  it('rejects concurrent commits for the same setup session while the first write is pending', async () => {
    await withTempDir('formax-setup-bridge-concurrent-commit-', async (dir) => {
      let resolveWrite: ((value: {
        configPath: string
        authPath: string
        logsDir: string
        warnings: string[]
      }) => void) | null = null
      const writeSetup = vi.fn(async () => new Promise<{
        configPath: string
        authPath: string
        logsDir: string
        warnings: string[]
      }>((resolve) => {
        resolveWrite = resolve
      }))
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup,
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })
      const session = service.createSession()

      await completeSessionToWrite(service, session.id)

      const firstCommit = service.commit(session.id)
      await vi.waitFor(() => expect(writeSetup).toHaveBeenCalledTimes(1))

      const secondCommit = await service.commit(session.id)
      expect(secondCommit).toEqual({
        ok: false,
        code: 'commit_in_progress',
        message: 'Setup write is already in progress.',
      })
      expect(writeSetup).toHaveBeenCalledTimes(1)

      resolveWrite?.({
        configPath: path.join(dir, 'global', 'config.json'),
        authPath: path.join(dir, 'global', 'auth.json'),
        logsDir: path.join(dir, 'global', 'logs'),
        warnings: [],
      })

      await expect(firstCommit).resolves.toMatchObject({ ok: true })
      await expect(service.commit(session.id)).resolves.toMatchObject({ ok: false, code: 'session_not_found' })
    })
  })

  it('allows env-backed repair commits without persisting the API key', async () => {
    await withTempDir('formax-setup-bridge-env-commit-', async (dir) => {
      const writeSetup = vi.fn(async (_draft: SetupDraft) => ({
        configPath: path.join(dir, 'global', 'config.json'),
        authPath: path.join(dir, 'global', 'auth.json'),
        logsDir: path.join(dir, 'global', 'logs'),
        warnings: [],
      }))
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup,
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: {
          FORMAX_CONFIG_DIR: path.join(dir, 'global'),
          FORMAX_API_KEY: 'sk-env-secret',
        } as any,
      })
      const session = service.createSession()

      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setProvider', provider: 'anthropic' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setModel', model: 'model-a' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })

      const committed = await service.commit(session.id)

      expect(committed.ok).toBe(true)
      expect(writeSetup).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-env-secret' }),
        { persistApiKey: false, authRef: 'default' },
      )
    })
  })

  it('allows auth-store-backed repair commits without re-entering the API key', async () => {
    await withTempDir('formax-setup-bridge-auth-commit-', async (dir) => {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet',
          authRef: 'team',
        },
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            team: { apiKey: 'sk-auth-secret' },
          },
        },
      })
      const writeSetup = vi.fn(async (_draft: SetupDraft) => ({
        configPath: path.join(globalConfigDir, 'config.json'),
        authPath: path.join(globalConfigDir, 'auth.json'),
        logsDir: path.join(globalConfigDir, 'logs'),
        warnings: [],
      }))
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: store,
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup,
        createSessionId: createSessionIdFactory(),
        cwd: projectDir,
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
      })
      const session = service.createSession()

      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setProvider', provider: 'anthropic' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setModel', model: 'model-a' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })

      const committed = await service.commit(session.id)

      expect(committed.ok).toBe(true)
      expect(writeSetup).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-auth-secret' }),
        { persistApiKey: false, authRef: 'team' },
      )
    })
  })

  it('requires re-entering an API key when setup switches providers from an auth-store-backed config', async () => {
    await withTempDir('formax-setup-bridge-provider-switch-auth-commit-', async (dir) => {
      const store = createNodeFileStore()
      const globalConfigDir = path.join(dir, 'global')
      const projectDir = path.join(dir, 'repo')
      await store.writeJsonAtomic(path.join(globalConfigDir, 'config.json'), {
        version: 1,
        llm: {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet',
          authRef: 'default',
        },
      })
      await store.writeJsonAtomic(path.join(globalConfigDir, 'auth.json'), {
        version: 1,
        providers: {
          anthropic: {
            default: { apiKey: 'sk-shared-secret' },
          },
        },
      })
      const writeSetup = vi.fn(async (_draft: SetupDraft) => ({
        configPath: path.join(globalConfigDir, 'config.json'),
        authPath: path.join(globalConfigDir, 'auth.json'),
        logsDir: path.join(globalConfigDir, 'logs'),
        warnings: [],
      }))
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: store,
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup,
        createSessionId: createSessionIdFactory(),
        cwd: projectDir,
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: globalConfigDir } as any,
      })
      const session = service.createSession()

      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setProvider', provider: 'openai' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'setModel', model: 'model-a' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })
      await service.applyAction(session.id, { type: 'next' })

      const committed = await service.commit(session.id)

      expect(committed).toEqual({
        ok: false,
        code: 'incomplete_setup',
        message: 'Complete setup validation before writing setup.',
      })
      expect(writeSetup).not.toHaveBeenCalled()
    })
  })

  it('preserves setup sessions when setup writes fail so users can retry', async () => {
    await withTempDir('formax-setup-bridge-write-fail-', async (dir) => {
      const service = createSetupBridgeService({
        providers: PROVIDERS,
        fileStore: createNodeFileStore(),
        testConnection: vi.fn(async () => ok(['model-a'])),
        writeSetup: vi.fn(async () => {
          throw new Error('disk full with sk-write-secret')
        }),
        createSessionId: createSessionIdFactory(),
        cwd: path.join(dir, 'repo'),
        homedir: dir,
        platform: 'linux',
        env: { FORMAX_CONFIG_DIR: path.join(dir, 'global') } as any,
      })
      const session = service.createSession()

      await completeSessionToWrite(service, session.id)
      const committed = await service.commit(session.id)

      expect(committed).toEqual({
        ok: false,
        code: 'write_failed',
        message: 'Failed to write setup files.',
      })
      expect(JSON.stringify(committed)).not.toContain('sk-write-secret')

      const afterFailure = await service.applyAction(session.id, { type: 'back' })
      expect(afterFailure).toMatchObject({ ok: true })
    })
  })
})
