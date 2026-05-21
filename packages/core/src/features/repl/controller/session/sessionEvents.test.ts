import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordClaudeMdInjectionEvent,
  recordCompactRequestedEvent,
  recordLocalCommandInjectionEvent,
  recordRequestCollapseEvent,
  recordRequestSnipEvent,
} from './sessionEvents'
import { CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME } from '../../../../chat/context/contextCollapseStore'
import { DURABLE_SNIP_COMMITTED_EVENT_NAME } from '../../sessionSave/durableSnipStoreEvents'

const EMPTY_CLAUDE_MD_META = { capChars: 200_000, global: null, project: null, memory: null } as const

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

  it('records request collapse diagnostics and durable collapse commit when available', async () => {
    const appendEvent = vi.fn()
    const recapMessage = {
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>durable recap</system-reminder>' }],
    } as any

    await recordRequestCollapseEvent({
      sessionSaveEnabled: true,
      writer: { appendEvent },
      phase: 'initial',
      collapsedHeadMessageCount: 2,
      estimatedTokensSaved: 120,
      metadata: {
        schemaVersion: 1,
        kind: 'request_recap',
        keepLastTurns: 2,
        preservedTailMessageCount: 4,
        retainedCompactSummary: true,
        recentUserPromptCount: 2,
        recentFileCount: 1,
        earlierToolResultBlockCount: 5,
        recapFingerprint: 'abcdef0123456789',
      },
      commit: {
        collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
        compactBoundaryFingerprint: 'compact-generation',
        recapMessage,
      },
    })

    expect(appendEvent).toHaveBeenCalledWith(
      'request_collapse_applied',
      expect.objectContaining({
        phase: 'initial',
        collapsedHeadMessageCount: 2,
        recapFingerprint: 'abcdef0123456789',
      }),
    )
    expect(appendEvent).toHaveBeenCalledWith(
      CONTEXT_COLLAPSE_COMMITTED_EVENT_NAME,
      expect.objectContaining({
        id: 'request-collapse:initial:abcdef0123456789',
        source: 'request_collapse',
        collapsedRange: { kind: 'model_facing_index_range', startIndex: 0, endIndexExclusive: 2 },
        compactBoundaryFingerprint: 'compact-generation',
        recapMessage,
      }),
    )
  })

  it('records durable request snip snapshots when applied', async () => {
    const appendEvent = vi.fn()
    await recordRequestSnipEvent({
      sessionSaveEnabled: true,
      writer: { appendEvent },
      phase: 'initial',
      state: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 120,
        compactBoundaryFingerprint: 'compact-generation',
        baseProjectionFingerprint: 'baseline-fp',
        sourceProjectionKind: 'model_facing_baseline',
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 1,
            endIndexExclusive: 2,
            reason: 'request snip removed older assistant text message',
            removedMessageFingerprints: ['removed-fp'],
          },
        ],
      },
    })

    expect(appendEvent).toHaveBeenCalledWith(DURABLE_SNIP_COMMITTED_EVENT_NAME, {
      schemaVersion: 1,
      source: 'request_snip',
      phase: 'initial',
      estimatedTokensSaved: 120,
      removedMessageCount: 1,
      compactBoundaryFingerprint: 'compact-generation',
      baseProjectionFingerprint: 'baseline-fp',
      sourceProjectionKind: 'model_facing_baseline',
      removals: [
        {
          kind: 'model_facing_index_range',
          startIndex: 1,
          endIndexExclusive: 2,
          reason: 'request snip removed older assistant text message',
          removedMessageFingerprints: ['removed-fp'],
        },
      ],
    })
  })

  it('skips durable request snip snapshots when disabled or not applied', async () => {
    const appendEvent = vi.fn()
    await recordRequestSnipEvent({
      sessionSaveEnabled: false,
      writer: { appendEvent },
      phase: 'initial',
      state: {
        applied: true,
        removedMessageCount: 1,
        estimatedTokensSaved: 120,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [
          {
            kind: 'model_facing_index_range',
            startIndex: 1,
            endIndexExclusive: 2,
            reason: 'request snip removed older assistant text message',
            removedMessageFingerprints: ['removed-fp'],
          },
        ],
      },
    })
    await recordRequestSnipEvent({
      sessionSaveEnabled: true,
      writer: { appendEvent },
      phase: 'initial',
      state: {
        applied: false,
        removedMessageCount: 0,
        estimatedTokensSaved: 0,
        compactBoundaryFingerprint: null,
        baseProjectionFingerprint: null,
        sourceProjectionKind: 'model_facing_baseline',
        removals: [],
      },
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
      memory: null,
    }
    vi.mocked(getClaudeMdInjectionMeta).mockReturnValue(meta as any)

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      includeAutoMemory: true,
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).toHaveBeenCalledTimes(1)
    expect(appendEvent).toHaveBeenCalledWith('claude_md_injection', meta)
    expect(lastSigRef.current).toBe(JSON.stringify(meta))
  })

  it('skips memory-only claude_md_injection when includeAutoMemory is false', async () => {
    const appendEvent = vi.fn()
    const lastSigRef = { current: null as string | null }
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')
    const meta = {
      capChars: 200_000,
      global: null,
      project: null,
      memory: {
        filePath: '/home/user/.formax/projects/-tmp-memory/memory/MEMORY.md',
        sizeBytes: 64,
        mtimeMs: 1_700_000_000_000,
        includedSha256: 'abc123',
        originalLines: 10,
        includedLines: 10,
        truncated: false,
      },
    }
    vi.mocked(getClaudeMdInjectionMeta).mockImplementation((args: any) => {
      if (args?.includeAutoMemory === false) {
        return { capChars: 200_000, global: null, project: null, memory: null } as any
      }
      return meta as any
    })

    recordClaudeMdInjectionEvent({
      sessionSaveEnabled: true,
      cwd: '/tmp/project',
      env: {},
      includeAutoMemory: false,
      lastSigRef,
      writer: { appendEvent },
    })

    expect(appendEvent).not.toHaveBeenCalled()
  })

  it('records claude_md_injection when only auto-memory metadata exists', async () => {
    const appendEvent = vi.fn()
    const lastSigRef = { current: null as string | null }
    const { getClaudeMdInjectionMeta } = await import('../../injectedBlocks')
    const meta = {
      capChars: 200_000,
      global: null,
      project: null,
      memory: {
        filePath: '/home/user/.formax/projects/-tmp-memory/memory/MEMORY.md',
        sizeBytes: 64,
        mtimeMs: 1_700_000_000_000,
        includedSha256: 'abc123',
        originalLines: 10,
        includedLines: 10,
        truncated: false,
      },
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
      memory: null,
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
