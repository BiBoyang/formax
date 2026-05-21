import { describe, expect, it } from 'vitest'
import { buildPromptMessageIdentity, fingerprintPromptMessage } from './compact'
import { applyRequestSnip, resolveAdaptiveSnipPolicy, SNIP_STUB_PREFIX } from './snip'
import type { PromptMessage } from '../../prompts'

describe('snip', () => {
  it('stays inactive below the snip pressure tier', () => {
    expect(resolveAdaptiveSnipPolicy({ pressureRatio: 0.6 })).toEqual({
      pressureTier: 'inactive',
      enabled: false,
      keepRecentMessages: 2,
      minTextChars: 1800,
      maxExcerptChars: 160,
    })
  })

  it('snips older assistant-only text messages while keeping recent eligible messages', () => {
    const messages: PromptMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: `old-a ${'x'.repeat(2200)}` }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: `old-b ${'y'.repeat(2100)}` }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: `recent ${'z'.repeat(2300)}` }],
      },
    ]

    const out = applyRequestSnip({
      messages,
      policy: {
        pressureTier: 'critical',
        enabled: true,
        keepRecentMessages: 1,
        minTextChars: 1000,
        maxExcerptChars: 120,
      },
    })

    expect(out.applied).toBe(true)
    expect(out.messages[0]?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(SNIP_STUB_PREFIX),
      }),
    ])
    expect(out.messages[1]?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(SNIP_STUB_PREFIX),
      }),
    ])
    expect((out.messages[2]?.content[0] as any)?.text).toContain('recent')
    expect(out.impact).toMatchObject({
      snippedMessages: 2,
      snippedBlocks: 2,
      keptRecentMessages: 1,
      minTextChars: 1000,
    })
    expect(out.removals).toEqual([
      {
        kind: 'model_facing_index_range',
        startIndex: 0,
        endIndexExclusive: 1,
        reason: 'request snip removed older assistant text message',
        removedMessageFingerprints: [fingerprintPromptMessage(messages[0]!)],
        removedMessageIdentities: [buildPromptMessageIdentity({ message: messages[0]!, index: 0 })],
      },
      {
        kind: 'model_facing_index_range',
        startIndex: 1,
        endIndexExclusive: 2,
        reason: 'request snip removed older assistant text message',
        removedMessageFingerprints: [fingerprintPromptMessage(messages[1]!)],
        removedMessageIdentities: [buildPromptMessageIdentity({ message: messages[1]!, index: 1 })],
      },
    ])
    expect(out.impact.estimatedTokensSaved).toBeGreaterThan(0)
  })

  it('skips assistant messages that contain tool blocks or are already snipped', () => {
    const messages: PromptMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: `mixed ${'a'.repeat(2200)}` },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/repo/a.ts' } },
        ] as any,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: `${SNIP_STUB_PREFIX} ~2,200 chars] cached` }],
      },
    ]

    const out = applyRequestSnip({
      messages,
      policy: {
        pressureTier: 'critical',
        enabled: true,
        keepRecentMessages: 0,
        minTextChars: 1000,
        maxExcerptChars: 120,
      },
    })

    expect(out.applied).toBe(false)
    expect(out.messages).toEqual(messages)
    expect(out.removals).toEqual([])
    expect(out.impact).toEqual({
      snippedMessages: 0,
      snippedBlocks: 0,
      estimatedTokensSaved: 0,
      keptRecentMessages: 0,
      minTextChars: 1000,
    })
  })
})
