import { describe, expect, it } from 'vitest'
import type { Msg } from '../../shared/toolMessageTypes'
import {
  EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT,
  isCompactSlashCommandText,
  projectCompactPrimaryTranscript,
  projectExpandedTranscript,
} from './compactProjection'

function createMessage(overrides: Partial<Msg>): Msg {
  return {
    id: 'm0',
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('isCompactSlashCommandText', () => {
  it('matches /compact with optional arguments', () => {
    expect(isCompactSlashCommandText('/compact')).toBe(true)
    expect(isCompactSlashCommandText('/compact summarize this')).toBe(true)
    expect(isCompactSlashCommandText('   /compact foo')).toBe(true)
  })

  it('does not match non-compact commands', () => {
    expect(isCompactSlashCommandText('/compact-foo')).toBe(false)
    expect(isCompactSlashCommandText('/compactfoo')).toBe(false)
    expect(isCompactSlashCommandText('/clear')).toBe(false)
  })
})

describe('projectCompactPrimaryTranscript', () => {
  it('returns all messages when no compact boundary exists', () => {
    const allMessages: Msg[] = [
      createMessage({ id: 'u1', role: 'user', content: 'hello' }),
      createMessage({ id: 'a1', role: 'assistant', content: 'world' }),
    ]

    const result = projectCompactPrimaryTranscript(allMessages)

    expect(result.lastCompactBoundaryIndex).toBe(-1)
    expect(result.primaryTranscriptStartIndex).toBe(0)
    expect(result.surfaceViewKind).toBe('ui_scrollback_full')
    expect(result.primaryTranscriptMessages).toEqual(allMessages)
  })

  it('keeps base messages unchanged when /compact exists after boundary', () => {
    const banner = createMessage({
      id: 'b1',
      role: 'assistant',
      ui: { kind: 'compact_banner' },
      content: 'Conversation compacted · ctrl+o for history',
    })
    const compactCommand = createMessage({ id: 'u2', role: 'user', content: '/compact keep this' })
    const subline = createMessage({
      id: 's1',
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'Compacted (ctrl+o to see full summary)',
    })
    const allMessages: Msg[] = [
      createMessage({ id: 'p1', role: 'assistant', content: 'old' }),
      createMessage({ id: 'c1', role: 'assistant', ui: { kind: 'compact_boundary' }, content: '' }),
      banner,
      compactCommand,
      subline,
    ]

    const result = projectCompactPrimaryTranscript(allMessages)
    expect(result.surfaceViewKind).toBe('ui_scrollback_compact_slice')
    expect(result.primaryTranscriptMessages).toEqual([banner, compactCommand, subline])
  })

  it('reinserts latest compact command after banner when base lacks one', () => {
    const oldCompact = createMessage({ id: 'old-compact', role: 'user', content: '/compact old' })
    const latestCompact = createMessage({ id: 'latest-compact', role: 'user', content: '/compact latest args' })
    const banner = createMessage({
      id: 'banner',
      role: 'assistant',
      ui: { kind: 'compact_banner' },
      content: 'Conversation compacted · ctrl+o for history',
    })
    const subline = createMessage({
      id: 'subline',
      role: 'assistant',
      ui: { kind: 'command_subline' },
      content: 'Compacted (ctrl+o to see full summary)',
    })
    const allMessages: Msg[] = [
      createMessage({ id: 'a0', role: 'assistant', content: 'old assistant' }),
      oldCompact,
      latestCompact,
      createMessage({ id: 'boundary', role: 'assistant', ui: { kind: 'compact_boundary' }, content: '' }),
      banner,
      subline,
    ]

    const result = projectCompactPrimaryTranscript(allMessages)
    expect(result.surfaceViewKind).toBe('ui_scrollback_compact_slice')
    expect(result.primaryTranscriptMessages).toEqual([banner, latestCompact, subline])
  })

  it('returns base transcript when compact banner is missing after boundary', () => {
    const allMessages: Msg[] = [
      createMessage({ id: 'u0', role: 'user', content: '/compact old' }),
      createMessage({ id: 'skip1', role: 'assistant', content: '/compact but assistant' }),
      createMessage({ id: 'skip2', role: 'user', content: { text: '/compact object-content' } as any }),
      createMessage({ id: 'boundary', role: 'assistant', ui: { kind: 'compact_boundary' }, content: '' }),
      createMessage({ id: 'subline', role: 'assistant', ui: { kind: 'command_subline' }, content: 'Compacted' }),
    ]

    const result = projectCompactPrimaryTranscript(allMessages)
    expect(result.surfaceViewKind).toBe('ui_scrollback_compact_slice')
    expect(result.primaryTranscriptMessages.map((message) => message.id)).toEqual(['subline'])
  })

  it('returns base transcript when there is no compact command before boundary', () => {
    const banner = createMessage({
      id: 'banner',
      role: 'assistant',
      ui: { kind: 'compact_banner' },
      content: 'Conversation compacted',
    })
    const allMessages: Msg[] = [
      createMessage({ id: 'p1', role: 'assistant', content: 'hello' }),
      createMessage({ id: 'u1', role: 'user', content: '/clear' }),
      createMessage({ id: 'boundary', role: 'assistant', ui: { kind: 'compact_boundary' }, content: '' }),
      banner,
    ]

    const result = projectCompactPrimaryTranscript(allMessages)
    expect(result.surfaceViewKind).toBe('ui_scrollback_compact_slice')
    expect(result.primaryTranscriptMessages).toEqual([banner])
  })
})

describe('projectExpandedTranscript', () => {
  it('declares expanded transcript as raw UI scrollback when inactive', () => {
    const allMessages: Msg[] = [
      createMessage({ id: 'u1', role: 'user', content: 'hello' }),
      createMessage({ id: 'a1', role: 'assistant', content: 'world' }),
    ]

    const result = projectExpandedTranscript({
      allMessages,
      expandedViewActive: false,
      hideHistory: true,
    })

    expect(result.surfaceViewKind).toBe('ui_scrollback_raw')
    expect(result.expandedTranscriptHiddenCount).toBe(0)
    expect(result.expandedTranscriptMessages).toEqual(allMessages)
  })

  it('declares expanded transcript as raw UI scrollback when history is visible', () => {
    const allMessages = Array.from({ length: EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT + 2 }, (_, index) =>
      createMessage({ id: `m${index}`, role: index % 2 === 0 ? 'user' : 'assistant', content: `message ${index}` }),
    )

    const result = projectExpandedTranscript({
      allMessages,
      expandedViewActive: true,
      hideHistory: false,
    })

    expect(result.surfaceViewKind).toBe('ui_scrollback_raw')
    expect(result.expandedTranscriptHiddenCount).toBe(2)
    expect(result.expandedTranscriptMessages).toEqual(allMessages)
  })

  it('declares expanded hide-history as a recent UI scrollback window', () => {
    const allMessages = Array.from({ length: EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT + 3 }, (_, index) =>
      createMessage({ id: `m${index}`, role: 'assistant', content: `message ${index}` }),
    )

    const result = projectExpandedTranscript({
      allMessages,
      expandedViewActive: true,
      hideHistory: true,
    })

    expect(result.surfaceViewKind).toBe('ui_scrollback_recent_window')
    expect(result.expandedTranscriptHiddenCount).toBe(3)
    expect(result.expandedTranscriptMessages.map((message) => message.id)).toEqual(
      allMessages.slice(-EXPANDED_TRANSCRIPT_RECENT_WINDOW_MESSAGE_COUNT).map((message) => message.id),
    )
  })
})
