import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordClaudeMdInjectionEvent,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
} from './sessionEvents'

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
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue({ global: false, project: false })
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
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue({ global: true, project: false } as any)

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      promptProfile: 'full',
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(appendEvent).toHaveBeenCalledWith('claude_md_injection', { global: true, project: false })
    expect(lastSigRef.current).toBe(JSON.stringify({ global: true, project: false }))
  })

  it('skips claude_md_injection when disabled/non-full/empty/same-signature', async () => {
    const appendEvent = vi.fn()
    const lastSigRef = { current: null as string | null }
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: false,
      promptProfile: 'full',
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      promptProfile: 'compact',
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue({ global: false, project: false } as any)
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      promptProfile: 'full',
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue({ global: true, project: false } as any)
    lastSigRef.current = JSON.stringify({ global: true, project: false })
    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      promptProfile: 'full',
      cwd: '/tmp/project',
      env: {},
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).not.toHaveBeenCalled()
  })
})
