import { describe, expect, it, vi } from 'vitest'

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
      promptProfile: 'full',
      setPromptProfile: () => {},
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
      promptProfile: 'full',
      setPromptProfile: () => {},
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
      promptProfile: 'full',
      setPromptProfile: () => {},
      setDefaultModelTier: async () => 'sonnet',
      workspaceRoots: ['/tmp/repo'],
      workspaceRootWarnings: [],
    })

    const out = await registry.doctor.run()
    expect(out).toBe('doctor-report\n')
    expect(runReplDoctorMock).toHaveBeenCalledTimes(1)
  })
})
