import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
  type ThreadRuntimeState,
} from '../runtime/threadRuntimeState'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../projection/transcriptProjection'
import { toCanonicalEventsFromTurnNotification } from '../adapters/turnNotificationCanonicalAdapter'
import { selectTerminalTurnInvariantIssues } from '../selectors/invariants'

type TurnNotification = {
  method: string
  params: Record<string, unknown>
}

type ReplayFixturesModule = {
  REPLAY_FIXTURE_THREAD_ID: string
  REPLAY_FIXTURE_TURN_ID: string
  REPLAY_FIXTURE_TS: string
  createReplayTurnEventEnvelope: (overrides?: Record<string, unknown>) => Record<string, unknown>
}

async function loadReplayFixtures(): Promise<ReplayFixturesModule> {
  const fixturePath = path.resolve(
    process.cwd(),
    'apps/web-reference-react/src/app/runtime/testFixtures/replayFixtures.ts',
  )
  const mod = await import(pathToFileURL(fixturePath).href)
  return mod as ReplayFixturesModule
}

function applyNotifications(args: {
  threadId: string
  notifications: TurnNotification[]
  projectionState?: ReturnType<typeof createInitialTranscriptProjectionState>
  runtimeState?: ThreadRuntimeState
}) {
  const first = args.notifications[0]
  let projection = args.projectionState ?? createInitialTranscriptProjectionState({ threadId: args.threadId })
  let runtime =
    args.runtimeState ??
    createInitialThreadRuntimeState({
      threadId: args.threadId,
      replaySeq: Number((first?.params?.replaySeq as number) ?? 1),
      method: first?.method ?? 'turn/started',
      ts: first?.params?.ts,
    })

  for (const notification of args.notifications) {
    const canonicalEvents = toCanonicalEventsFromTurnNotification(notification, {
      fallbackThreadId: args.threadId,
      requireEnvelope: true,
    })

    for (const event of canonicalEvents) {
      projection = reduceTranscriptProjection(projection, event)
    }

    const replaySeq = notification.params?.replaySeq
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

describe('realtime/replay parity contract', () => {
  it('keeps projection + runtime equivalent across realtime and replay rebuild paths', async () => {
    const fixtures = await loadReplayFixtures()
    const threadId = fixtures.REPLAY_FIXTURE_THREAD_ID
    const turnId = fixtures.REPLAY_FIXTURE_TURN_ID

    const notifications: TurnNotification[] = [
      {
        method: 'turn/started',
        params: {
          replaySeq: 1,
          eventId: 'evt-1',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, mode: 'normal', status: 'running' },
        },
      },
      {
        method: 'turn/event',
        params: fixtures.createReplayTurnEventEnvelope({
          replaySeq: 2,
          eventId: 'evt-2',
          ts: fixtures.REPLAY_FIXTURE_TS,
          threadId,
          turnId,
        }),
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 3,
          eventId: 'evt-3',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'tool',
          threadId,
          turnId,
          event: { type: 'tool_start', id: 'tool-1', name: 'Read' },
        },
      },
      {
        method: 'turn/inputRequested',
        params: {
          replaySeq: 4,
          eventId: 'evt-4',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'policy',
          threadId,
          turnId,
          input: {
            inputId: 'input-1',
            threadId,
            turnId,
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'pending',
            createdAt: fixtures.REPLAY_FIXTURE_TS,
            expiresAt: '2026-02-17T00:05:00.000Z',
            payload: { toolName: 'Read' },
          },
        },
      },
      {
        method: 'turn/inputResolved',
        params: {
          replaySeq: 5,
          eventId: 'evt-5',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'policy',
          threadId,
          turnId,
          input: {
            inputId: 'input-1',
            threadId,
            turnId,
            toolUseId: 'tool-1',
            kind: 'approval',
            status: 'submitted',
            createdAt: fixtures.REPLAY_FIXTURE_TS,
            expiresAt: '2026-02-17T00:05:00.000Z',
            resolvedAt: '2026-02-17T00:00:04.000Z',
          },
        },
      },
      {
        method: 'turn/event',
        params: {
          replaySeq: 6,
          eventId: 'evt-6',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'tool',
          threadId,
          turnId,
          event: {
            type: 'tool_end',
            id: 'tool-1',
            result: { tool_use_id: 'tool-1', content: 'ok', is_error: false },
          },
        },
      },
      {
        method: 'turn/modeChanged',
        params: {
          replaySeq: 7,
          eventId: 'evt-7',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'engine',
          threadId,
          turnId,
          previousMode: 'normal',
          mode: 'acceptEdits',
        },
      },
      {
        method: 'turn/completed',
        params: {
          replaySeq: 8,
          eventId: 'evt-8',
          ts: fixtures.REPLAY_FIXTURE_TS,
          source: 'engine',
          threadId,
          turn: { id: turnId, threadId, status: 'completed' },
        },
      },
    ]

    const realtime = applyNotifications({ threadId, notifications })

    const splitAt = 4
    const baseline = applyNotifications({ threadId, notifications: notifications.slice(0, splitAt) })
    const replayRebuild = applyNotifications({
      threadId,
      notifications: notifications.slice(splitAt),
      projectionState: baseline.projection,
      runtimeState: baseline.runtime,
    })

    expect(replayRebuild.projection).toEqual(realtime.projection)
    expect(replayRebuild.runtime).toEqual(realtime.runtime)
    expect(Object.keys(realtime.runtime.pendingInputs)).toEqual([])
    expect(
      selectTerminalTurnInvariantIssues({
        projection: realtime.projection,
        runtimeState: realtime.runtime,
      }),
    ).toEqual([])
  })
})
