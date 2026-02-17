import { describe, expect, it } from 'vitest'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../projection/transcriptProjection'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../runtime/threadRuntimeState'
import { toCanonicalEventsFromTurnNotification } from '../adapters/turnNotificationCanonicalAdapter'
import { selectTerminalTurnInvariantIssues } from '../selectors/invariants'

type TurnNotification = {
  method: string
  params: Record<string, unknown>
}

function applyNotifications(
  threadId: string,
  notifications: TurnNotification[],
  options?: {
    projectionState?: ReturnType<typeof createInitialTranscriptProjectionState>
    runtimeState?: ThreadRuntimeState
  },
) {
  let projection =
    options?.projectionState ?? createInitialTranscriptProjectionState({ threadId })
  let runtime =
    options?.runtimeState ??
    createInitialThreadRuntimeState({
      threadId,
      replaySeq: Number((notifications[0]?.params as { replaySeq?: number })?.replaySeq ?? 1),
      method: notifications[0]?.method ?? 'turn/started',
      ts: (notifications[0]?.params as { ts?: unknown })?.ts,
    })

  for (const notification of notifications) {
    const canonicalEvents = toCanonicalEventsFromTurnNotification(notification, {
      fallbackThreadId: threadId,
    })
    for (const event of canonicalEvents) {
      projection = reduceTranscriptProjection(projection, event)
    }
    const replaySeq = (notification.params as { replaySeq?: unknown })?.replaySeq
    if (typeof replaySeq === 'number' && Number.isFinite(replaySeq)) {
      runtime = reduceThreadRuntimeState(runtime, {
        method: notification.method,
        params: notification.params,
        replaySeq,
      })
    }
  }

  return { projection, runtime }
}

describe('runtime replay parity', () => {
  it('keeps realtime and replay rebuild equivalent with no pending input leak after terminal turn', () => {
    const threadId = 'thread-runtime-parity'
    const turnId = 'turn-runtime-parity'
    const notifications: TurnNotification[] = [
      {
        method: 'turn/started',
        params: {
          replaySeq: 1,
          eventId: 'e1',
          ts: '2026-02-17T10:00:01.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 2,
          eventId: 'e2',
          ts: '2026-02-17T10:00:02.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: { type: 'tool_start', id: 'tool-1', name: 'Write' },
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 3,
          eventId: 'e3',
          ts: '2026-02-17T10:00:03.000Z',
          source: 'engine',
          threadId,
          turnId,
          input: {
            inputId: 'input-1',
            threadId,
            turnId,
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-17T10:00:03.000Z',
            expiresAt: '2026-02-17T10:05:03.000Z',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 4,
          eventId: 'e4',
          ts: '2026-02-17T10:00:04.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: {
            type: 'tool_end',
            id: 'tool-1',
            result: { content: 'Wrote file', is_error: false, tool_use_id: 'tool-1' },
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 5,
          eventId: 'e5',
          ts: '2026-02-17T10:00:05.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, status: 'completed' },
        },
      },
    ]

    const realtime = applyNotifications(threadId, notifications)

    const splitAt = 2
    const baseline = applyNotifications(threadId, notifications.slice(0, splitAt))
    const rebuiltFromReplayTail = applyNotifications(
      threadId,
      notifications.slice(splitAt),
      {
        projectionState: baseline.projection,
        runtimeState: baseline.runtime,
      },
    )

    expect(rebuiltFromReplayTail.projection).toEqual(realtime.projection)
    expect(rebuiltFromReplayTail.runtime).toEqual(realtime.runtime)
    expect(Object.keys(realtime.runtime.pendingInputs)).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: realtime.projection,
        runtimeState: realtime.runtime,
      }),
    ).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: rebuiltFromReplayTail.projection,
        runtimeState: rebuiltFromReplayTail.runtime,
      }),
    ).toEqual([])
  })

  it('keeps realtime and replay rebuild equivalent with no running tool leak after terminal turn', () => {
    const threadId = 'thread-runtime-running-tool'
    const turnId = 'turn-runtime-running-tool'
    const notifications: TurnNotification[] = [
      {
        method: 'turn/started',
        params: {
          replaySeq: 1,
          eventId: 'r1',
          ts: '2026-02-17T11:00:01.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 2,
          eventId: 'r2',
          ts: '2026-02-17T11:00:02.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: { type: 'tool_start', id: 'tool-2', name: 'Bash' },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 3,
          eventId: 'r3',
          ts: '2026-02-17T11:00:03.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, status: 'completed' },
        },
      },
    ]

    const realtime = applyNotifications(threadId, notifications)

    const splitAt = 1
    const baseline = applyNotifications(threadId, notifications.slice(0, splitAt))
    const rebuiltFromReplayTail = applyNotifications(
      threadId,
      notifications.slice(splitAt),
      {
        projectionState: baseline.projection,
        runtimeState: baseline.runtime,
      },
    )

    expect(rebuiltFromReplayTail.projection).toEqual(realtime.projection)
    expect(rebuiltFromReplayTail.runtime).toEqual(realtime.runtime)
    expect(
      selectTerminalTurnInvariantIssues({
        projection: realtime.projection,
        runtimeState: realtime.runtime,
      }),
    ).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: rebuiltFromReplayTail.projection,
        runtimeState: rebuiltFromReplayTail.runtime,
      }),
    ).toEqual([])
  })

  it('keeps realtime and replay rebuild equivalent across inputResolved terminal statuses', () => {
    const threadId = 'thread-runtime-input-resolved'
    const notifications: TurnNotification[] = [
      {
        method: 'turn/started',
        params: {
          replaySeq: 1,
          eventId: 'i1',
          ts: '2026-02-17T12:30:01.000Z',
          source: 'engine',
          threadId,
          turn: { id: 'turn-a', threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 2,
          eventId: 'i2',
          ts: '2026-02-17T12:30:02.000Z',
          source: 'policy',
          threadId,
          turnId: 'turn-a',
          input: {
            inputId: 'input-a',
            threadId,
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            kind: 'approval',
            status: 'pending',
            createdAt: '2026-02-17T12:30:02.000Z',
            expiresAt: '2026-02-17T12:35:02.000Z',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          replaySeq: 3,
          eventId: 'i3',
          ts: '2026-02-17T12:30:03.000Z',
          source: 'policy',
          threadId,
          turnId: 'turn-a',
          input: {
            inputId: 'input-a',
            threadId,
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            kind: 'approval',
            status: 'canceled',
            payload: { toolName: 'Write' },
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 4,
          eventId: 'i4',
          ts: '2026-02-17T12:30:04.000Z',
          source: 'engine',
          threadId,
          turn: { id: 'turn-a', threadId, status: 'completed' },
        },
      },
      {
        method: 'turn/started',
        params: {
          replaySeq: 5,
          eventId: 'i5',
          ts: '2026-02-17T12:31:01.000Z',
          source: 'engine',
          threadId,
          turn: { id: 'turn-b', threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 6,
          eventId: 'i6',
          ts: '2026-02-17T12:31:02.000Z',
          source: 'policy',
          threadId,
          turnId: 'turn-b',
          input: {
            inputId: 'input-b',
            threadId,
            turnId: 'turn-b',
            toolUseId: 'tool-b',
            kind: 'ask_user_question',
            status: 'pending',
            createdAt: '2026-02-17T12:31:02.000Z',
            expiresAt: '2026-02-17T12:36:02.000Z',
            payload: { toolName: 'AskUserQuestion' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          replaySeq: 7,
          eventId: 'i7',
          ts: '2026-02-17T12:31:03.000Z',
          source: 'policy',
          threadId,
          turnId: 'turn-b',
          input: {
            inputId: 'input-b',
            threadId,
            turnId: 'turn-b',
            toolUseId: 'tool-b',
            kind: 'ask_user_question',
            status: 'failed',
            payload: { toolName: 'AskUserQuestion' },
          },
        },
      },
      {
        method: 'turn/failed',
        params: {
          replaySeq: 8,
          eventId: 'i8',
          ts: '2026-02-17T12:31:04.000Z',
          source: 'engine',
          threadId,
          turn: { id: 'turn-b', threadId, status: 'failed' },
          error: 'failed after input resolution',
        },
      },
    ]

    const realtime = applyNotifications(threadId, notifications)

    const splitAt = 4
    const baseline = applyNotifications(threadId, notifications.slice(0, splitAt))
    const rebuiltFromReplayTail = applyNotifications(
      threadId,
      notifications.slice(splitAt),
      {
        projectionState: baseline.projection,
        runtimeState: baseline.runtime,
      },
    )

    expect(rebuiltFromReplayTail.projection).toEqual(realtime.projection)
    expect(rebuiltFromReplayTail.runtime).toEqual(realtime.runtime)
    expect(Object.keys(realtime.runtime.pendingInputs)).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: realtime.projection,
        runtimeState: realtime.runtime,
      }),
    ).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: rebuiltFromReplayTail.projection,
        runtimeState: rebuiltFromReplayTail.runtime,
      }),
    ).toEqual([])
  })

  it('keeps tool terminal row idempotent under duplicate tool_end notifications', () => {
    const threadId = 'thread-runtime-dup-tool-end'
    const turnId = 'turn-runtime-dup-tool-end'
    const notifications: TurnNotification[] = [
      {
        method: 'turn/started',
        params: {
          replaySeq: 1,
          eventId: 'd1',
          ts: '2026-02-17T13:00:01.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 2,
          eventId: 'd2',
          ts: '2026-02-17T13:00:02.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: { type: 'tool_start', id: 'tool-1', name: 'Bash' },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 3,
          eventId: 'd3',
          ts: '2026-02-17T13:00:03.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: {
            type: 'tool_end',
            id: 'tool-1',
            result: { content: 'done', is_error: false, tool_use_id: 'tool-1' },
          },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 4,
          eventId: 'd4',
          ts: '2026-02-17T13:00:04.000Z',
          source: 'engine',
          threadId,
          turnId,
          event: {
            type: 'tool_end',
            id: 'tool-1',
            result: { content: 'done', is_error: false, tool_use_id: 'tool-1' },
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 5,
          eventId: 'd5',
          ts: '2026-02-17T13:00:05.000Z',
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, status: 'completed' },
        },
      },
    ]

    const realtime = applyNotifications(threadId, notifications)
    const baseline = applyNotifications(threadId, notifications.slice(0, 2))
    const rebuiltFromReplayTail = applyNotifications(threadId, notifications.slice(2), {
      projectionState: baseline.projection,
      runtimeState: baseline.runtime,
    })

    const realtimeToolRows = realtime.projection.segments.filter(
      (segment: any) => segment.kind === 'tool' && segment.toolUseId === 'tool-1',
    )
    expect(realtimeToolRows).toHaveLength(1)
    expect(realtimeToolRows[0]).toMatchObject({
      kind: 'tool',
      toolUseId: 'tool-1',
      status: 'completed',
    })

    expect(rebuiltFromReplayTail.projection).toEqual(realtime.projection)
    expect(rebuiltFromReplayTail.runtime).toEqual(realtime.runtime)
    expect(
      selectTerminalTurnInvariantIssues({
        projection: realtime.projection,
        runtimeState: realtime.runtime,
      }),
    ).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: rebuiltFromReplayTail.projection,
        runtimeState: rebuiltFromReplayTail.runtime,
      }),
    ).toEqual([])
  })
})
