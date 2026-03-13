import { describe, expect, it, vi } from 'vitest'
import type { CanonicalEvent } from '../../../semantics/core/canonicalEvents'
import * as canonicalEventAdapter from '../../../semantics/adapters/canonicalEventAdapter'
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

  it('forwards canonical events without mapping when mapEvent is omitted', () => {
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
    })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      kind: 'assistant_delta',
      textDelta: 'hello',
    })
  })

  it('does not forward when canonical bridge is missing', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi.spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')

    forwardCanonicalStreamEvent({
      canonicalTurnId: 'turn-1',
      event: { type: 'assistant_delta', text: 'hello' },
    })

    expect(mapSpy).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
    mapSpy.mockRestore()
  })

  it('does not forward when canonical turn id is missing', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi.spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')

    forwardCanonicalStreamEvent({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent,
      },
      canonicalTurnId: null,
      event: { type: 'assistant_delta', text: 'hello' },
    })

    expect(mapSpy).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalled()
    mapSpy.mockRestore()
  })

  it('maps approval_request events to policy source', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi
      .spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')
      .mockReturnValue([])

    forwardCanonicalStreamEvent({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent,
      },
      canonicalTurnId: 'turn-1',
      event: {
        type: 'approval_request',
        toolUseId: 'toolu_1',
        toolName: 'bash',
        action: { cmd: 'ls' },
        effectiveDecision: 'ask',
      },
    })

    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(mapSpy.mock.calls[0]?.[1]).toMatchObject({ source: 'policy' })
    mapSpy.mockRestore()
  })

  it('maps ask_user_question events to tool source', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi
      .spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')
      .mockReturnValue([])

    forwardCanonicalStreamEvent({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent,
      },
      canonicalTurnId: 'turn-1',
      event: {
        type: 'ask_user_question',
        toolUseId: 'toolu_2',
        questions: [
          {
            question: 'continue?',
            header: 'Confirm',
            options: [{ label: 'Yes', description: 'continue execution' }],
            multiSelect: false,
          },
        ],
      },
    })

    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(mapSpy.mock.calls[0]?.[1]).toMatchObject({ source: 'tool' })
    mapSpy.mockRestore()
  })

  it('maps error events to system source', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi
      .spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')
      .mockReturnValue([])

    forwardCanonicalStreamEvent({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent,
      },
      canonicalTurnId: 'turn-1',
      event: { type: 'error', error: new Error('boom') },
    })

    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(mapSpy.mock.calls[0]?.[1]).toMatchObject({ source: 'system' })
    mapSpy.mockRestore()
  })

  it('maps tool_end events to tool source', () => {
    const onEvent = vi.fn<(event: CanonicalEvent) => void>()
    const mapSpy = vi
      .spyOn(canonicalEventAdapter, 'mapStreamEventToCanonicalEvents')
      .mockReturnValue([])

    forwardCanonicalStreamEvent({
      canonical: {
        threadId: 'thread',
        getTurnId: () => 'turn-1',
        nextReplaySeq: () => 1,
        onEvent,
      },
      canonicalTurnId: 'turn-1',
      event: {
        type: 'tool_end',
        id: 'toolu_3',
        result: {
          tool_use_id: 'toolu_3',
          content: 'ok',
        },
      },
    })

    expect(mapSpy).toHaveBeenCalledTimes(1)
    expect(mapSpy.mock.calls[0]?.[1]).toMatchObject({ source: 'tool' })
    mapSpy.mockRestore()
  })
})
