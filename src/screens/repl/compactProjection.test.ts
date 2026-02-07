import { describe, expect, it } from 'vitest'
import type { Msg } from '../../components/tool/ToolMessage'
import { isCompactSlashCommandText, projectCompactPrimaryTranscript } from './compactProjection'

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
    expect(result.primaryTranscriptMessages).toEqual([banner, latestCompact, subline])
  })
})
