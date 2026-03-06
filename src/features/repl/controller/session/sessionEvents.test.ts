import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordClaudeMdInjectionEvent,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
} from './sessionEvents'

const EMPTY_CLAUDE_MD_META = { capChars: 200_000, global: null, project: null } as const

function createClaudeMdFileMeta(scope: 'global' | 'project') {
  return {
    scope,
    filePath: scope === 'global' ? '/home/user/.formax/CLAUDE.md' : '/tmp/project/CLAUDE.md',
    sizeBytes: 128,
    mtimeMs: 1_700_000_000_000,
    includedSha256: 'abc123',
    originalChars: 128,
    includedChars: 128,
    truncated: false,
  }
}

vi.mock('../../injectedBlocks', () => ({
  getClaudeMdInjectionMeta: vi.fn(),
}))

vi.mock('./localCommandInjection', () => ({
  getLocalCommandInjectionStats: vi.fn(),
}))

describe('sessionEvents', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')
    const { getLocalCommandInjectionStats } = await import('./localCommandInjection')
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue(EMPTY_CLAUDE_MD_META as any)
    vi.mocked(getLocalCommandInjectionStats).mockReturnValue({ matched: 1, injected: 1, skipped: 0 } as any)
  })

  it('records compact_requested only when session save is enabled', () => {
    const appendEvent = vi.fn()

    recordCompactRequestedEvent({
      sessionSaveEnabled: false,
      writer: { appendEvent },
    })
    recordCompactRequestedEvent({
      sessionSaveEnabled: true,
      writer: { appendEvent },
    })

    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(appendEvent).toHaveBeenCalledWith('compact_requested')
  })

  it('records local command injection with computed stats', async () => {
    const appendEvent = vi.fn()
    const { getLocalCommandInjectionStats } = await import('./localCommandInjection')

    recordLocalCommandInjectionEvent({
      sessionSaveEnabled: true,
      writer: { appendEvent },
      source: 'slash_local',
      record: { commandName: '/permissions' } as any,
    })

    expect(getLocalCommandInjectionStats).toHaveBeenCalledWith({ commandName: '/permissions' })
    expect(appendEvent).toHaveBeenCalledWith('local_command_injection', {
      source: 'slash_local',
      commandName: '/permissions',
      matched: 1,
      injected: 1,
      skipped: 0,
    })
  })

  it('does not record local command injection when save is disabled', () => {
    const appendEvent = vi.fn()
    recordLocalCommandInjectionEvent({
      sessionSaveEnabled: false,
      writer: { appendEvent },
      source: 'slash_local_async',
      record: { commandName: '/hooks' } as any,
    })
    expect(appendEvent).not.toHaveBeenCalled()
  })

  it('records claude_md_injection only for full profile with changed non-empty meta', async () => {
    const appendEvent = vi.fn()
    const lastSigRef = { current: null as string | null }
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')
    const meta = {
      capChars: 200_000,
      global: createClaudeMdFileMeta('global'),
      project: null,
    }
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue(meta as any)

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(appendEvent).toHaveBeenCalledWith('claude_md_injection', meta)
    expect(lastSigRef.current).toBe(JSON.stringify(meta))
  })

  it('skips claude_md_injection when disabled/non-full/empty/same-signature', async () => {
    const appendEvent = vi.fn()
    const lastSigRef = { current: null as string | null }
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: false,
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue(EMPTY_CLAUDE_MD_META as any)
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    const repeatedMeta = {
      capChars: 200_000,
      global: createClaudeMdFileMeta('global'),
      project: null,
    }
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue(repeatedMeta as any)
    lastSigRef.current = JSON.stringify(repeatedMeta)
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).not.toHaveBeenCalled()
  })
})
