import { describe, expect, it, vi } from 'vitest'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import {
  forwardCanonicalStreamEvent,
  resolveCanonicalStreamWritePolicy,
  type CanonicalStreamBridge,
} from './streamBridge'

describe('streamBridge', () => {
  it('disables legacy transcript writes when canonical is configured but turn is not active', () => {
    const policy = resolveCanonicalStreamWritePolicy({
      canonical: {
        threadId: 'thread',
        getTurnId: () => null,
        nextReplaySeq: () => 1,
        onEvent: () => {},
      },
      event: { type: 'assistant_delta', text: 'hello' },
    })
    expect(policy.canonicalBridgeActive).toBe(false)
    expect(policy.canonicalOnly).toBe(true)
    expect(policy.canWriteLegacyTranscript).toBe(false)
    expect(policy.shouldForwardCanonical).toBe(false)
  })

  it('allows legacy transcript writes when canonical bridge is not configured', () => {
    const policy = resolveCanonicalStreamWritePolicy({
      event: { type: 'assistant_delta', text: 'hello' },
    })
    expect(policy.canonicalBridgeActive).toBe(false)
    expect(policy.canonicalOnly).toBe(false)
    expect(policy.canWriteLegacyTranscript).toBe(true)
    expect(policy.shouldForwardCanonical).toBe(false)
  })

  it('disables legacy transcript writes when canonical turn is active', () => {
    const policy = resolveCanonicalStreamWritePolicy({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent: () => {},
      },
      event: { type: 'assistant_delta', text: 'hello' },
    })
    expect(policy.canonicalBridgeActive).toBe(true)
    expect(policy.canonicalOnly).toBe(true)
    expect(policy.canWriteLegacyTranscript).toBe(false)
    expect(policy.shouldForwardCanonical).toBe(true)
  })

  it('marks abort-like error as non-forwardable', () => {
    const policy = resolveCanonicalStreamWritePolicy({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent: () => {},
      },
      event: { type: 'error', error: new Error('Request aborted by user') },
    })
    expect(policy.shouldForwardCanonical).toBe(false)
    expect(policy.canWriteLegacyTranscript).toBe(false)
  })

  it('forwards canonical events and applies mapping', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const canonical: CanonicalStreamBridge = {
      threadId: 'thread',
      getTurnId: () => 'turn-1',
      nextReplaySeq: () => 1,
      onEvent,
    }

    forwardCanonicalStreamEvent({
      canonical,
      canonicalTurnId: 'turn-1',
      event: { type: 'assistant_delta', text: 'hello' },
      mapEvent: (event) =>
        event.kind === 'assistant_delta'
          ? {
              ...event,
              textDelta: `${event.textDelta} world`,
            }
          : event,
    })

    expect(onEvent).toHaveBeenCalledTimes(1)
    const emitted = onEvent.mock.calls[0]?.[0]
    expect(emitted).toMatchObject({
      kind: 'assistant_delta',
      textDelta: 'hello world',
    })
  })
})
