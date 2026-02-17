import { describe, expect, it } from 'vitest'
import type { CanonicalEvent } from '../core/canonicalEvents'
import {
  createInitialTranscriptProjectionState,
  projectCanonicalEvents,
} from './transcriptProjection'

function eventFactory(
  base: { replaySeq: number; eventId: string },
  patch: { kind: CanonicalEvent['kind'] } & Record<string, unknown>,
): CanonicalEvent {
  return {
    threadId: 'thread-1',
    replaySeq: base.replaySeq,
    eventId: base.eventId,
    ts: '2026-02-13T01:10:00.000Z',
    source: 'engine',
    ...patch,
  } as CanonicalEvent
}

describe('transcriptProjection', () => {
  it('keeps turn-local segment order when tool rows split assistant deltas', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'e1' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'alpha' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'e2' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' },
      ),
      eventFactory(
        { replaySeq: 3, eventId: 'e3' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'beta' },
      ),
    ])

    expect(next.segments.map((segment) => segment.kind)).toEqual(['assistant', 'tool', 'assistant'])
    expect(next.segments[0]).toMatchObject({ kind: 'assistant', text: 'alpha' })
    expect(next.segments[2]).toMatchObject({ kind: 'assistant', text: 'beta' })
  })

  it('keeps toolName sticky when update/end events omit toolName', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'e1' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-write', phase: 'start', toolName: 'Write' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'e2' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-write', phase: 'update', line: 'line-1' },
      ),
      eventFactory(
        { replaySeq: 3, eventId: 'e3' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-write', phase: 'end', summary: 'Wrote file' },
      ),
    ])

    expect(next.segments).toHaveLength(1)
    expect(next.segments[0]).toMatchObject({
      kind: 'tool',
      toolUseId: 'tool-write',
      toolName: 'Write',
      status: 'completed',
      summary: 'Wrote file',
      detailLines: ['line-1'],
    })
  })

  it('is idempotent by eventId and ignores stale replaySeq events', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 2, eventId: 'e1' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'A' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'e1' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'A' },
      ),
      eventFactory(
        { replaySeq: 1, eventId: 'e2' },
        { kind: 'assistant_delta', turnId: 'turn-1', textDelta: 'B' },
      ),
    ])

    expect(next.lastReplaySeq).toBe(2)
    expect(next.segments).toHaveLength(1)
    expect(next.segments[0]).toMatchObject({ kind: 'assistant', text: 'A' })
  })

  it('finalizes an open thinking segment when tool event arrives', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'e1' },
        { kind: 'thinking_delta', turnId: 'turn-1', textDelta: 'reasoning' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'e2' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' },
      ),
    ])

    expect(next.segments[0]).toMatchObject({ kind: 'thinking', status: 'finalized', text: 'reasoning' })
    expect(next.segments[1]).toMatchObject({ kind: 'tool', toolName: 'Bash', status: 'running' })
  })

  it('annotates input state on existing tool and updates turn footer in place', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'e1' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'e2' },
        {
          kind: 'tool_input_state',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          inputKind: 'approval',
          status: 'pending',
        },
      ),
      eventFactory(
        { replaySeq: 3, eventId: 'e3' },
        { kind: 'turn_footer', turnId: 'turn-1', status: 'completed' },
      ),
      eventFactory(
        { replaySeq: 4, eventId: 'e4' },
        { kind: 'turn_footer', turnId: 'turn-1', status: 'interrupted', message: 'interrupted' },
      ),
    ])

    const tool = next.segments.find((segment) => segment.kind === 'tool')
    const footer = next.segments.find((segment) => segment.kind === 'turn_footer')
    expect(tool).toMatchObject({
      kind: 'tool',
      toolName: 'Bash',
      inputState: { kind: 'approval', status: 'pending' },
    })
    expect(footer).toMatchObject({
      kind: 'turn_footer',
      status: 'interrupted',
      message: 'interrupted',
    })
    expect(next.segments.filter((segment) => segment.kind === 'turn_footer')).toHaveLength(1)
  })

  it('retains structured tool metadata and infers duration on tool end', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'm1' },
        {
          kind: 'tool_event',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          phase: 'start',
          toolName: 'Task',
          ts: '2026-02-13T01:10:00.000Z',
        },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'm2' },
        {
          kind: 'tool_event',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          phase: 'update',
          toolUses: 3,
          usage: { input_tokens: 9, output_tokens: 4 },
          nestedTools: [{ id: 'n1', name: 'Bash', input: { command: 'pwd' }, status: 'completed' }],
        },
      ),
      eventFactory(
        { replaySeq: 3, eventId: 'm3' },
        {
          kind: 'tool_event',
          turnId: 'turn-1',
          toolUseId: 'task-1',
          phase: 'end',
          summary: 'done',
          result: '{"transcript":["a","b"]}',
          ts: '2026-02-13T01:10:02.500Z',
        },
      ),
    ])

    const tool = next.segments.find((segment) => segment.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      toolUseId: 'task-1',
      status: 'completed',
      toolUses: 3,
      usage: { input_tokens: 9, output_tokens: 4 },
      nestedTools: [{ id: 'n1', name: 'Bash' }],
      result: '{"transcript":["a","b"]}',
    })
    if (!tool || tool.kind !== 'tool') return
    expect(tool.durationMs).toBeGreaterThanOrEqual(2500)
  })

  it('does not let empty middleLines overwrite existing tool detail lines', () => {
    const state = createInitialTranscriptProjectionState({ threadId: 'thread-1' })
    const next = projectCanonicalEvents(state, [
      eventFactory(
        { replaySeq: 1, eventId: 'x1' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' },
      ),
      eventFactory(
        { replaySeq: 2, eventId: 'x2' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'update', middleLines: ['line-1'] },
      ),
      eventFactory(
        { replaySeq: 3, eventId: 'x3' },
        { kind: 'tool_event', turnId: 'turn-1', toolUseId: 'tool-1', phase: 'update', middleLines: [] },
      ),
    ])

    const tool = next.segments.find((segment) => segment.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      detailLines: ['line-1'],
      middleLines: ['line-1'],
    })
  })
})
