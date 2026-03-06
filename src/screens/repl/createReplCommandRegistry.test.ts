import { describe, expect, it, vi } from 'vitest'
import pkg from '../../../package.json'

const createSlashCommandRegistryMock = vi.fn((args: any) => args)
vi.mock('../../features/commands/registry', () => {
  return { createSlashCommandRegistry: (args: any) => createSlashCommandRegistryMock(args) }
})

const createStatusSnapshotMock = vi.fn((args: any) => {
  return { warnings: ['base-warning'], args }
})
vi.mock('../../core/diagnostics/status', () => {
  return { createStatusSnapshot: (args: any) => createStatusSnapshotMock(args) }
})

const runReplDoctorMock = vi.fn(async (_args: any) => 'doctor-report\n')
vi.mock('../../features/commands/replDoctorService', () => {
  return { runReplDoctor: (args: any) => runReplDoctorMock(args) }
})

import { createReplCommandRegistry } from './createReplCommandRegistry'

describe('createReplCommandRegistry', () => {
  it('returns base status snapshot when workspaceRootWarnings is empty', () => {
    const registry: any = createReplCommandRegistry({
      cfg: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'http://localhost',
          model: 'm',
          timeoutMs: 123,
          apiKey: 'k',
        },
        paths: { projectRoot: '/tmp/repo' },
        ui: { assistantTextMode: 'default' },
      } as any,
      planSession: {} as any,
      setDefaultModelTier: async () => 'sonnet',
      workspaceRoots: ['/tmp/repo'],
      workspaceRootWarnings: [],
    })

    const status = registry.status.get()
    expect(status.warnings).toEqual(['base-warning'])
  })

  it('merges workspaceRootWarnings into status warnings', () => {
    const registry: any = createReplCommandRegistry({
      cfg: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'http://localhost',
          model: 'm',
          timeoutMs: 123,
          apiKey: 'k',
        },
        paths: { projectRoot: '/tmp/repo' },
        ui: { assistantTextMode: 'default' },
      } as any,
      planSession: {} as any,
      setDefaultModelTier: async () => 'sonnet',
      workspaceRoots: ['/tmp/repo'],
      workspaceRootWarnings: ['extra-1', 'extra-2'],
    })

    const status = registry.status.get()
    expect(status.warnings).toEqual(['base-warning', 'extra-1', 'extra-2'])
  })

  it('doctor.run uses the doctor pipeline and returns formatted output', async () => {
    const registry: any = createReplCommandRegistry({
      cfg: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'http://localhost',
          model: 'm',
          timeoutMs: 123,
          apiKey: 'k',
        },
        paths: { projectRoot: '/tmp/repo' },
        ui: { assistantTextMode: 'default' },
      } as any,
      planSession: {} as any,
      setDefaultModelTier: async () => 'sonnet',
      workspaceRoots: ['/tmp/repo'],
      workspaceRootWarnings: [],
    })

    const out = await registry.doctor.run()
    expect(out).toBe('doctor-report\n')
    expect(runReplDoctorMock).toHaveBeenCalledTimes(1)
  })

  it('exposes modelTier accessors and fallback tier', async () => {
    const setDefaultModelTier = vi.fn(async (_next: 'haiku' | 'sonnet' | 'opus') => 'haiku' as const)
    const registry: any = createReplCommandRegistry({
      cfg: {
        llm: {
          provider: 'anthropic',
          baseUrl: 'http://localhost',
          model: 'm',
          timeoutMs: 123,
          apiKey: 'k',
        },
        paths: { projectRoot: '/tmp/repo' },
        ui: { assistantTextMode: 'default' },
      } as any,
      planSession: {} as any,
      setDefaultModelTier,
      workspaceRoots: ['/tmp/repo'],
      workspaceRootWarnings: [],
    })

    // Fallback when cfg.llm.defaultTier is unset.
    expect(registry.modelTier.get()).toBe('sonnet')
    await registry.modelTier.set('haiku')
    expect(setDefaultModelTier).toHaveBeenCalledWith('haiku')
  })

  it('uses unknown version fallback when package version is unavailable', async () => {
    const prevVersion = (pkg as any).version
    ;(pkg as any).version = ''
    try {
      const registry: any = createReplCommandRegistry({
        cfg: {
          llm: {
            provider: 'anthropic',
            baseUrl: 'http://localhost',
            model: 'm',
            timeoutMs: 123,
            apiKey: 'k',
            defaultTier: 'opus',
          },
          paths: { projectRoot: '/tmp/repo' },
          ui: { assistantTextMode: 'default' },
        } as any,
        planSession: {} as any,
        setDefaultModelTier: async () => 'sonnet',
        workspaceRoots: ['/tmp/repo'],
        workspaceRootWarnings: [],
      })

      registry.status.get()
      await registry.doctor.run()

      expect(createStatusSnapshotMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          version: 'unknown',
        }),
      )
      expect(runReplDoctorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          version: 'unknown',
        }),
      )
      expect(registry.modelTier.get()).toBe('opus')
    } finally {
      ;(pkg as any).version = prevVersion
    }
  })
})
