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
})
