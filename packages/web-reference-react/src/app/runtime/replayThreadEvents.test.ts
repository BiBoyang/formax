import { describe, expect, it, vi } from 'vitest'
import {
  replayThreadEvents,
  resolveReplayCursorProgress,
  type ReplayThreadEventsContext,
} from './replayThreadEvents'
import { processNotification, type ProcessNotificationContext } from './processNotification'
import type { ReplayStateSnapshot } from '../core/rpcParsers'
import type { RpcNotification } from '../../types'
import {
  createInitialThreadRuntimeState,
  reduceThreadRuntimeState,
} from '../../semantics'
// Shared replay fixtures are centralized in ./testFixtures/replayFixtures.ts.
import {
  REPLAY_FIXTURE_THREAD_ID,
  REPLAY_FIXTURE_TURN_ID,
  createReplayTurnEventEnvelope,
} from './testFixtures/replayFixtures'
import { CROSS_PATH_CONTRACT_FIXTURE } from '../../semantics'

type ReplayPage = ReturnType<ReplayThreadEventsContext['parseThreadReplayResponse']>
// Type aliases
type ReplayMockFn = ReturnType<typeof vi.fn>
type ReplayRequestMock = ReplayMockFn
type ReplayCursorParams = { after?: number }
type ReplayTurnEventMethod = 'turn/started' | 'turn/progress'
type ReplayTurnEventPayload = { replaySeq: number; method: ReplayTurnEventMethod; params: { replaySeq: number } }

const TEST_THREAD_ID = REPLAY_FIXTURE_THREAD_ID
const TEST_TURN_ID = REPLAY_FIXTURE_TURN_ID

// Constants: shared between replay fixture builders and assertions.
const REPLAY_STATE_UPDATED_AT = '2026-02-17T00:00:00.000Z'
const REPLAY_SEQ_BASELINE = 51
const REPLAY_SEQ_INCREMENTAL = 121
const REPLAY_SEQ_REBUILD_COMPLETE = 120

const INITIAL_REPLAY_CURSOR = 50
const REPLAY_CURSOR_FROM_START = 0
const REPLAY_CURSOR_REBUILD_COMPLETE = REPLAY_SEQ_REBUILD_COMPLETE

const REPLAY_PAGE_SIZE = 200
const REPLAY_PROGRESS_STEP = 1
const REPLAY_REQUEST_DEFAULTS = {
  baselineCursor: REPLAY_CURSOR_REBUILD_COMPLETE,
  progressStep: REPLAY_PROGRESS_STEP,
  pageSize: REPLAY_PAGE_SIZE,
} as const

// Helpers: assertions
function expectReplayPageRequestArgs(args: { request: ReplayRequestMock; nth: number; afterCursor: number }) {
  expect(args.request).toHaveBeenNthCalledWith(args.nth, 'thread/replay', {
    threadId: TEST_THREAD_ID,
    after: args.afterCursor,
    limit: REPLAY_REQUEST_DEFAULTS.pageSize,
  })
}

function expectReplayCursor(ctx: ReplayThreadEventsContext, cursor: number) {
  expect(ctx.replayCursorByThreadRef.current[TEST_THREAD_ID]).toBe(cursor)
}

function expectRuntimeLastReplaySeq(ctx: ReplayThreadEventsContext, replaySeq: number) {
  expect(ctx.runtimeStateByThreadRef.current[TEST_THREAD_ID]?.lastReplaySeq).toBe(replaySeq)
}

// Helpers: warnings
function replayInvariantWarning(details: string) {
  return `Replay invariant issues detected (${details})`
}

function replayAnomalyWarning(count: number) {
  return `Replay canonical protocol anomalies detected (count=${count})`
}

function toReplayLogMock(log: ReplayThreadEventsContext['log']): ReplayMockFn {
  return log as unknown as ReplayMockFn
}

function expectSingleWarning(log: ReplayThreadEventsContext['log'], message: string) {
  const replayLogMock = toReplayLogMock(log)
  expect(replayLogMock).toHaveBeenCalledTimes(1)
  expect(replayLogMock).toHaveBeenCalledWith(message, 'warn')
}

function expectWarningSequence(log: ReplayThreadEventsContext['log'], messages: string[]) {
  const replayLogMock = toReplayLogMock(log)
  expect(replayLogMock).toHaveBeenCalledTimes(messages.length)
  messages.forEach((message, index) => {
    expect(replayLogMock).toHaveBeenNthCalledWith(index + 1, message, 'warn')
  })
}

// Helpers: replay fixtures
function createReplayState(overrides: Partial<ReplayStateSnapshot> = {}): ReplayStateSnapshot {
  return {
    mode: 'normal',
    activeTurnId: null,
    lastTurnId: null,
    lastTurnStatus: null,
    pendingInputCount: 0,
    canonicalProtocolAnomalyCount: 0,
    pendingInputs: [],
    invariantIssues: [],
    projection: null,
    toolNameByUseId: {},
    updatedAt: REPLAY_STATE_UPDATED_AT,
    ...overrides,
  }
}

function createReplayContext(overrides: Partial<ReplayThreadEventsContext> = {}): ReplayThreadEventsContext {
  return {
    request: vi.fn(),
    parseThreadReplayResponse: (value) => value as ReplayPage,
    toRuntimePendingInputsById: vi.fn().mockReturnValue({}),
    replayCursorByThreadRef: { current: { [TEST_THREAD_ID]: INITIAL_REPLAY_CURSOR } },
    replayAnomalyCountSeenByThreadRef: { current: {} },
    runtimeStateByThreadRef: { current: {} },
    activeThreadIdRef: { current: TEST_THREAD_ID },
    logsByThreadIdRef: { current: { [TEST_THREAD_ID]: [{ id: 'cached-log' }] } },
    stateLogsRef: { current: [{ id: 'active-log' }] },
    transcriptSourceByThreadRef: { current: { [TEST_THREAD_ID]: 'history' } },
    cacheLatestCompactBoundary: vi.fn(),
    cacheDurableSnip: vi.fn(),
    cacheLatestRequestCollapse: vi.fn(),
    dispatch: vi.fn(),
    setMode: vi.fn(),
    cacheThreadMode: vi.fn(),
    setThreadTranscriptSource: vi.fn(),
    clearThreadHistoryCursor: vi.fn(),
    syncPendingInputsFromReplayState: vi.fn(),
    loadThreadHistory: vi.fn().mockResolvedValue(true),
    handleNotification: vi.fn(),
    log: vi.fn(),
    ...overrides,
  }
}

function createReplayPage(overrides: Partial<ReplayPage> = {}): ReplayPage {
  return {
    data: [],
    nextCursor: REPLAY_CURSOR_FROM_START,
    latestCursor: REPLAY_CURSOR_FROM_START,
    hasGap: false,
    state: null,
    ...overrides,
  } as ReplayPage
}

it('caches latest compact and collapse summaries from replay responses', async () => {
  const latestCompactBoundary = {
    schemaVersion: 1 as const,
    trigger: 'auto' as const,
    triggerReason: { kind: 'auto_threshold' as const },
    preTokens: 1536,
    summaryKind: 'session_memory' as const,
    preservedSegment: {
      schemaVersion: 1 as const,
      continuationMessageCount: 3,
      preservedTailMessageCount: 2,
      summaryFingerprint: 'summary-fp',
      headFingerprint: 'head-fp',
      tailFingerprint: 'tail-fp',
    },
  }
  const latestRequestCollapse = {
    phase: 'reactive_retry' as const,
    collapsedHeadMessageCount: 2,
    estimatedTokensSaved: 96,
    recapFingerprint: 'fedcba9876543210',
  }
  const request = createReplayPagesRequest(
    createReplayPage({
      nextCursor: 10,
      latestCursor: 10,
      latestCompactBoundary,
      latestRequestCollapse,
      state: createReplayState(),
    }),
  )
  const cacheLatestCompactBoundary = vi.fn()
  const cacheDurableSnip = vi.fn()
  const cacheLatestRequestCollapse = vi.fn()
  const ctx = createReplayContext({ request, cacheLatestCompactBoundary, cacheDurableSnip, cacheLatestRequestCollapse })

  const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

  expect(ok).toBe(true)
  expect(cacheLatestCompactBoundary).toHaveBeenCalledWith(TEST_THREAD_ID, latestCompactBoundary)
  expect(cacheDurableSnip).toHaveBeenCalledWith(TEST_THREAD_ID, undefined)
  expect(cacheLatestRequestCollapse).toHaveBeenCalledWith(TEST_THREAD_ID, latestRequestCollapse)
})

it('caches replay latest compact boundary while replaying the live compact event', async () => {
  const latestCompactBoundary = {
    schemaVersion: 1 as const,
    trigger: 'auto' as const,
    triggerReason: { kind: 'auto_threshold' as const },
    preTokens: 1536,
    summaryKind: 'session_memory' as const,
  }
  const compactEventParams = createReplayTurnEventEnvelope({
    replaySeq: 11,
    eventId: 'evt-11',
    event: {
      type: 'compact_boundary',
      boundary: latestCompactBoundary,
    } as any,
  })
  const request = createReplayPagesRequest(
    createReplayPage({
      data: [{ replaySeq: 11, method: 'turn/event', params: compactEventParams }],
      nextCursor: 11,
      latestCursor: 11,
      latestCompactBoundary,
      state: createReplayState(),
    }),
  )
  const cacheLatestCompactBoundary = vi.fn()
  const handleNotification = vi.fn()
  const ctx = createReplayContext({ request, cacheLatestCompactBoundary, handleNotification })

  const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

  expect(ok).toBe(true)
  expect(cacheLatestCompactBoundary).toHaveBeenCalledWith(TEST_THREAD_ID, latestCompactBoundary, {
    replayCompactBoundaryTurnIds: [TEST_TURN_ID],
  })
  expect(handleNotification).toHaveBeenCalledWith({
    jsonrpc: '2.0',
    method: 'turn/event',
    params: compactEventParams,
  })
})

it('keeps replay compact metadata when it differs from an in-flight compact event', async () => {
  const previousCompactBoundary = {
    schemaVersion: 1 as const,
    trigger: 'manual' as const,
    triggerReason: { kind: 'manual' as const },
    preTokens: 1024,
    summaryKind: 'model_summary' as const,
  }
  const liveCompactBoundary = {
    schemaVersion: 1 as const,
    trigger: 'auto' as const,
    triggerReason: { kind: 'auto_threshold' as const },
    preTokens: 1536,
    summaryKind: 'session_memory' as const,
  }
  const compactEventParams = createReplayTurnEventEnvelope({
    replaySeq: 11,
    eventId: 'evt-11',
    event: {
      type: 'compact_boundary',
      boundary: liveCompactBoundary,
    } as any,
  })
  const request = createReplayPagesRequest(
    createReplayPage({
      data: [{ replaySeq: 11, method: 'turn/event', params: compactEventParams }],
      nextCursor: 11,
      latestCursor: 11,
      latestCompactBoundary: previousCompactBoundary,
      state: createReplayState(),
    }),
  )
  const cacheLatestCompactBoundary = vi.fn()
  const handleNotification = vi.fn()
  const ctx = createReplayContext({ request, cacheLatestCompactBoundary, handleNotification })

  const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

  expect(ok).toBe(true)
  expect(cacheLatestCompactBoundary).toHaveBeenCalledWith(TEST_THREAD_ID, previousCompactBoundary, {
    replayCompactBoundaryTurnIds: [TEST_TURN_ID],
  })
  expect(handleNotification).toHaveBeenCalledWith({
    jsonrpc: '2.0',
    method: 'turn/event',
    params: compactEventParams,
  })
})

it('caches replay compact metadata before empty replay history fallback returns', async () => {
  const latestCompactBoundary = {
    schemaVersion: 1 as const,
    trigger: 'manual' as const,
    triggerReason: { kind: 'manual' as const },
    preTokens: 1024,
    summaryKind: 'model_summary' as const,
  }
  const request = createReplayPagesRequest(
    createReplayPage({
      data: [],
      nextCursor: 0,
      latestCursor: 0,
      latestCompactBoundary,
      state: createReplayState(),
    }),
  )
  const cacheLatestCompactBoundary = vi.fn()
  const ctx = createReplayContext({ request, cacheLatestCompactBoundary })

  const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

  expect(ok).toBe(true)
  expect(cacheLatestCompactBoundary).toHaveBeenCalledWith(TEST_THREAD_ID, latestCompactBoundary)
})

function createReplayTurnEvent(replaySeq: number, method: ReplayTurnEventMethod = 'turn/started'): ReplayTurnEventPayload {
  return {
    replaySeq,
    method,
    params: { replaySeq },
  }
}

function createProjectionSnapshot(text = 'rebuilt'): NonNullable<ReplayStateSnapshot['projection']> {
  return {
    segments: [
      {
        id: 's1',
        kind: 'assistant',
        turnId: TEST_TURN_ID,
        text,
      },
    ],
    lastReplaySeq: REPLAY_SEQ_REBUILD_COMPLETE,
    toolNameByUseId: {},
    openAssistantSegmentIdByTurn: {},
    openThinkingSegmentIdByTurn: {},
  }
}

function createReplayPagesRequest(...pages: ReplayPage[]) {
  const request = vi.fn()
  pages.forEach((page) => {
    request.mockResolvedValueOnce(page)
  })
  return request
}

function createHasGapBaselineReplayPages(args: {
  gapState: ReplayStateSnapshot | null
  baselineState: ReplayStateSnapshot | null
  baselineCursor?: number
}) {
  const baselineCursor = args.baselineCursor ?? REPLAY_REQUEST_DEFAULTS.baselineCursor
  return [
    createReplayPage({
      nextCursor: INITIAL_REPLAY_CURSOR,
      latestCursor: baselineCursor,
      hasGap: true,
      state: args.gapState,
    }),
    createReplayPage({
      nextCursor: baselineCursor,
      latestCursor: baselineCursor,
      state: args.baselineState,
    }),
  ] as const
}

function createReplayCursorProgressRequest(args: {
  state?: ReplayStateSnapshot
  latestCursor: number
  step?: number
}) {
  const step = args.step ?? REPLAY_REQUEST_DEFAULTS.progressStep
  const createPageForAfterCursor = (afterCursor: number) =>
    createReplayPage({
      nextCursor: afterCursor + step,
      latestCursor: args.latestCursor,
      state: args.state ?? createReplayState(),
    })
  return vi.fn().mockImplementation((_method: string, params?: unknown) => {
    const readAfterCursorParam = (value?: unknown) =>
      Number((value as ReplayCursorParams | undefined)?.after ?? REPLAY_CURSOR_FROM_START)
    const afterCursor = readAfterCursorParam(params)
    return Promise.resolve(createPageForAfterCursor(afterCursor))
  })
}

function createNotificationProjectionCapture() {
  const appliedCanonicalEvents: any[] = []
  const dispatch = vi.fn((action: any) => {
    if (action?.type === 'apply_canonical_event') {
      appliedCanonicalEvents.push(action.event)
    }
  })
  const context: ProcessNotificationContext = {
    runtimeStateByThreadRef: { current: {} },
    replayCursorByThreadRef: { current: {} },
    activeThreadIdRef: { current: TEST_THREAD_ID },
    commandByTurnRef: { current: new Map<string, string>() },
    createInitialThreadRuntimeState,
    shouldProcessSequencedNotification: () => true,
    dispatch,
    setMode: vi.fn(),
    cacheThreadMode: vi.fn(),
    isReplMode: (value): value is 'normal' | 'acceptEdits' | 'plan' =>
      value === 'normal' || value === 'acceptEdits' || value === 'plan',
    refreshThreads: vi.fn(async () => {}),
    refreshWorkspaceDiff: vi.fn(async () => {}),
    log: vi.fn(),
    setAskDockOpenByInputId: vi.fn(),
    setAskPageIndexByInputId: vi.fn(),
    setAskDraftByInputId: vi.fn(),
    setSubmitStatusByInputId: vi.fn(),
    reduceThreadRuntimeState,
  }
  return { appliedCanonicalEvents, context }
}

function toReplayEntriesFromNotifications(notifications: Array<{ method: string; params: Record<string, unknown> }>) {
  return notifications.map((notification) => ({
    replaySeq: Number(notification.params.replaySeq ?? 0),
    method: notification.method,
    params: notification.params,
  }))
}

describe('resolveReplayCursorProgress', () => {
  it('continues when next cursor advances but remains below latest cursor', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 11, latestCursor: 20 })).toEqual({
      nextAfter: 11,
      shouldContinue: true,
    })
  })

  it('stops when next cursor stalls or rewinds', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 10, latestCursor: 20 })).toEqual({
      nextAfter: 10,
      shouldContinue: false,
    })
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 9, latestCursor: 20 })).toEqual({
      nextAfter: 9,
      shouldContinue: false,
    })
  })

  it('stops when next cursor reaches latest cursor or falls back to latest cursor', () => {
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 20, latestCursor: 20 })).toEqual({
      nextAfter: 20,
      shouldContinue: false,
    })
    expect(resolveReplayCursorProgress({ after: 10, nextCursor: 0, latestCursor: 20 })).toEqual({
      nextAfter: 20,
      shouldContinue: false,
    })
  })
})

describe('replayThreadEvents', () => {
  it('[rebuild] uses replay-first rebuild on hasGap and clears cached logs', async () => {
    const gapState = createReplayState()
    const request = createReplayPagesRequest(
      ...createHasGapBaselineReplayPages({
        gapState,
        baselineState: gapState,
      }),
    )
    const ctx = createReplayContext({ request })

    const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

    expect(ok).toBe(true)
    expectReplayPageRequestArgs({ request, nth: 1, afterCursor: INITIAL_REPLAY_CURSOR })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: TEST_THREAD_ID })
    expect(ctx.dispatch).toHaveBeenCalledWith({ type: 'replace_logs', logs: [] })
    expect(ctx.setThreadTranscriptSource).toHaveBeenCalledWith(TEST_THREAD_ID, 'replay')
    expect(ctx.clearThreadHistoryCursor).toHaveBeenCalledWith(TEST_THREAD_ID)
    expectReplayCursor(ctx, 120)
    expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith(TEST_THREAD_ID, gapState)
    expect(ctx.handleNotification).not.toHaveBeenCalled()
  })

  describe('history paths', () => {
    it('[history] loads history and keeps cursor at zero for fromStart empty replay', async () => {
      const replayState = createReplayState()
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          state: replayState,
        }),
      )
      const ctx = createReplayContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expectReplayPageRequestArgs({ request, nth: 1, afterCursor: REPLAY_CURSOR_FROM_START })
      expect(ctx.loadThreadHistory).toHaveBeenCalledWith(TEST_THREAD_ID)
      expectReplayCursor(ctx, REPLAY_CURSOR_FROM_START)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith(TEST_THREAD_ID, replayState)
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    })

    it('[history] returns false when fromStart empty replay cannot load history', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          state: null,
        }),
      )
      const ctx = createReplayContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(false),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

      expect(ok).toBe(false)
      expect(ctx.loadThreadHistory).toHaveBeenCalledWith(TEST_THREAD_ID)
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR)
      expect(ctx.syncPendingInputsFromReplayState).not.toHaveBeenCalled()
    })

    it('[history-boundary] does not load history when fromStart is false and replay page is empty', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({
        request,
        replayCursorByThreadRef: { current: { [TEST_THREAD_ID]: 0 } },
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(ctx.loadThreadHistory).not.toHaveBeenCalled()
      expectReplayCursor(ctx, 0)
    })

    it('[history-boundary] does not load history in hasGap replay-first rebuild path', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          hasGap: true,
          nextCursor: 120,
          latestCursor: 120,
          state: createReplayState({
            projection: {
              segments: [],
              lastReplaySeq: 120,
              toolNameByUseId: {},
              openAssistantSegmentIdByTurn: {},
              openThinkingSegmentIdByTurn: {},
            },
          }),
        }),
      )
      const ctx = createReplayContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expect(ctx.loadThreadHistory).not.toHaveBeenCalled()
      expect(ctx.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hydrate_projection_snapshot',
        }),
      )
    })

    it('[invariant:history-fallback] falls back to history after fromStart replay loop with no entries', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          data: [],
          nextCursor: 60,
          latestCursor: 100,
          state: createReplayState(),
        }),
        createReplayPage({
          data: [],
          nextCursor: 100,
          latestCursor: 100,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expect(ctx.loadThreadHistory).toHaveBeenCalledTimes(1)
      expect(ctx.loadThreadHistory).toHaveBeenCalledWith(TEST_THREAD_ID)
      expect(ctx.handleNotification).not.toHaveBeenCalled()
      expectReplayCursor(ctx, 100)
    })

    it('[invariant:history-fallback] does not fall back to history when fromStart replay already received entries', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_BASELINE)],
          nextCursor: REPLAY_SEQ_BASELINE,
          latestCursor: REPLAY_SEQ_BASELINE,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({
        request,
        loadThreadHistory: vi.fn().mockResolvedValue(true),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expect(ctx.loadThreadHistory).not.toHaveBeenCalled()
      expect(ctx.handleNotification).toHaveBeenCalledTimes(1)
      expectReplayCursor(ctx, REPLAY_SEQ_BASELINE)
    })
  })

  describe('pagination paths', () => {
    it('[pagination] stops at page limit when replay stream keeps advancing without terminal cursor', async () => {
      const request = createReplayCursorProgressRequest({ latestCursor: 1000, step: 1 })
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(100)
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR + 100)
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
    })

    it('[pagination] exits loop when next cursor does not advance beyond current after', async () => {
      const replayState = createReplayState()
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 50,
          latestCursor: 200,
          state: replayState,
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith(TEST_THREAD_ID, replayState)
    })

    it('[pagination] exits loop when next cursor reaches latest cursor', async () => {
      const replayState = createReplayState()
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 120,
          latestCursor: 120,
          state: replayState,
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expectReplayCursor(ctx, REPLAY_CURSOR_REBUILD_COMPLETE)
      expect(ctx.syncPendingInputsFromReplayState).toHaveBeenCalledWith(TEST_THREAD_ID, replayState)
    })

    it('[pagination] logs invariant and anomaly warnings once on page-limit termination', async () => {
      const request = createReplayCursorProgressRequest({
        state: createReplayState({
          canonicalProtocolAnomalyCount: 2,
          invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: TEST_TURN_ID, toolUseId: 'tool-1' }],
        }),
        latestCursor: 1000,
        step: 1,
      })
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(100)
      expectWarningSequence(ctx.log, [
        replayInvariantWarning('running_tool_after_terminal_turn=1'),
        replayAnomalyWarning(2),
      ])
    })

    it('[pagination] does not log anomaly warning on boundary exit when anomaly count was already seen', async () => {
      const replayState = createReplayState({
        canonicalProtocolAnomalyCount: 3,
      })
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: INITIAL_REPLAY_CURSOR,
          latestCursor: 200,
          state: replayState,
        }),
      )
      const ctx = createReplayContext({
        request,
        replayAnomalyCountSeenByThreadRef: { current: { [TEST_THREAD_ID]: 3 } },
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(ctx.log).not.toHaveBeenCalled()
    })
  })

  describe('logging basics', () => {
    it('[logging] logs replay invariant issues once per replay request', async () => {
      const replayState = createReplayState({
        invariantIssues: [
          { kind: 'running_tool_after_terminal_turn', turnId: TEST_TURN_ID, toolUseId: 'tool-1' },
          { kind: 'pending_input_after_terminal_turn', turnId: TEST_TURN_ID, inputId: 'input-1', toolUseId: 'tool-1' },
        ],
      })
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          data: [createReplayTurnEvent(REPLAY_SEQ_BASELINE)],
          nextCursor: REPLAY_SEQ_BASELINE,
          latestCursor: REPLAY_SEQ_BASELINE,
          hasGap: false,
          state: replayState,
        })
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expectSingleWarning(ctx.log, replayInvariantWarning('running_tool_after_terminal_turn=1, pending_input_after_terminal_turn=1'))
    })

    it('[logging] logs canonical protocol anomaly count once per replay request', async () => {
      const replayState = createReplayState({
        canonicalProtocolAnomalyCount: 3,
      })
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          data: [createReplayTurnEvent(REPLAY_SEQ_BASELINE)],
          nextCursor: REPLAY_SEQ_BASELINE,
          latestCursor: REPLAY_SEQ_BASELINE,
          hasGap: false,
          state: replayState,
        })
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expectSingleWarning(ctx.log, replayAnomalyWarning(3))
    })
  })

  describe('rebuild and promotion paths', () => {
    it('[consistency] keeps replayThreadEvents canonical projection identical to direct notification path for contract fixture', async () => {
      const fixtureNotifications = [...CROSS_PATH_CONTRACT_FIXTURE.notifications]
      const directCapture = createNotificationProjectionCapture()
      directCapture.context.activeThreadIdRef.current = CROSS_PATH_CONTRACT_FIXTURE.threadId
      for (const notification of fixtureNotifications) {
        processNotification(
          {
            jsonrpc: '2.0',
            method: notification.method,
            params: notification.params,
          },
          directCapture.context,
        )
      }

      const replayCapture = createNotificationProjectionCapture()
      replayCapture.context.activeThreadIdRef.current = CROSS_PATH_CONTRACT_FIXTURE.threadId
      const replayEntries = toReplayEntriesFromNotifications(fixtureNotifications)
      const lastReplaySeq = replayEntries[replayEntries.length - 1]?.replaySeq ?? 0
      const request = createReplayPagesRequest(
        createReplayPage({
          data: replayEntries,
          nextCursor: lastReplaySeq,
          latestCursor: lastReplaySeq,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({
        request,
        replayCursorByThreadRef: {
          current: { [CROSS_PATH_CONTRACT_FIXTURE.threadId]: 0 },
        },
        activeThreadIdRef: { current: CROSS_PATH_CONTRACT_FIXTURE.threadId },
        handleNotification: (notification) => processNotification(notification as RpcNotification, replayCapture.context),
      })

      const ok = await replayThreadEvents(CROSS_PATH_CONTRACT_FIXTURE.threadId, { fromStart: true }, ctx)

      expect(ok).toBe(true)
      expect(directCapture.appliedCanonicalEvents.length).toBeGreaterThan(0)
      expect(replayCapture.appliedCanonicalEvents).toEqual(directCapture.appliedCanonicalEvents)
    })

    it('[consistency] forwards replay notifications into the same canonical projection as direct notifications', async () => {
      const params = createReplayTurnEventEnvelope({
        event: { type: 'assistant_delta', text: 'hello from consistency fixture' },
      })
      const directCapture = createNotificationProjectionCapture()
      processNotification(
        {
          jsonrpc: '2.0',
          method: 'turn/event',
          params,
        },
        directCapture.context,
      )

      const replayCapture = createNotificationProjectionCapture()
      const request = createReplayPagesRequest(
        createReplayPage({
          data: [{ replaySeq: REPLAY_SEQ_BASELINE, method: 'turn/event', params }],
          nextCursor: REPLAY_SEQ_BASELINE,
          latestCursor: REPLAY_SEQ_BASELINE,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({
        request,
        handleNotification: (notification) => processNotification(notification as RpcNotification, replayCapture.context),
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(directCapture.appliedCanonicalEvents).toHaveLength(1)
      expect(replayCapture.appliedCanonicalEvents).toEqual(directCapture.appliedCanonicalEvents)
    })

    it('[rebuild] logs invariant issues once on hasGap projection hydration path', async () => {
      const gapState = createReplayState({
        invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: TEST_TURN_ID, toolUseId: 'tool-1' }],
        projection: createProjectionSnapshot(),
      })
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 50,
          latestCursor: 120,
          hasGap: true,
          state: gapState,
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expectSingleWarning(ctx.log, replayInvariantWarning('running_tool_after_terminal_turn=1'))
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: 'hydrate_projection_snapshot',
        threadId: TEST_THREAD_ID,
        snapshot: gapState.projection,
      })
    })

    it('[rebuild] keeps hasGap cursor floor when baseline replay has no projection/state', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 20,
          latestCursor: 30,
          hasGap: true,
          state: null,
        }),
        createReplayPage({
          nextCursor: 0,
          latestCursor: 0,
          hasGap: false,
          state: null,
        }),
      )
      const ctx = createReplayContext({
        request,
        replayCursorByThreadRef: { current: { [TEST_THREAD_ID]: 0 } },
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expectReplayPageRequestArgs({ request, nth: 1, afterCursor: 0 })
      expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: TEST_THREAD_ID })
      expectReplayCursor(ctx, 30)
      expect(ctx.handleNotification).not.toHaveBeenCalled()
    })

    it('[rebuild] does not consume incremental replay data from a hasGap page', async () => {
      const gapProjection = createProjectionSnapshot('gap-rebuild')
      const request = createReplayPagesRequest(
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_INCREMENTAL)],
          nextCursor: REPLAY_SEQ_INCREMENTAL,
          latestCursor: REPLAY_SEQ_INCREMENTAL,
          hasGap: true,
          state: createReplayState({
            projection: gapProjection,
          }),
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(ctx.handleNotification).not.toHaveBeenCalled()
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: 'hydrate_projection_snapshot',
        threadId: TEST_THREAD_ID,
        snapshot: gapProjection,
      })
      expectReplayCursor(ctx, REPLAY_SEQ_INCREMENTAL)
    })

    it('[rebuild] defers hasGap projection hydration for non-active threads', async () => {
      const gapState = createReplayState({
        projection: createProjectionSnapshot(),
      })
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 50,
          latestCursor: 120,
          hasGap: true,
          state: gapState,
        }),
      )
      const ctx = createReplayContext({
        request,
        activeThreadIdRef: { current: 'thread-2' },
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(ctx.dispatch).not.toHaveBeenCalledWith({
        type: 'hydrate_projection_snapshot',
        threadId: TEST_THREAD_ID,
        snapshot: gapState.projection,
      })
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
      expect(ctx.clearThreadHistoryCursor).not.toHaveBeenCalled()
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR)
      expectRuntimeLastReplaySeq(ctx, REPLAY_SEQ_REBUILD_COMPLETE)
    })

    it('[rebuild] hydrates deferred projection after thread becomes active', async () => {
      const projection = createProjectionSnapshot()
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 50,
          latestCursor: 120,
          hasGap: true,
          state: createReplayState({ projection }),
        }),
        createReplayPage({
          nextCursor: 50,
          latestCursor: 120,
          hasGap: true,
          state: createReplayState({ projection }),
        }),
      )
      const activeThreadIdRef: ReplayThreadEventsContext['activeThreadIdRef'] = { current: 'thread-2' }
      const ctx = createReplayContext({
        request,
        activeThreadIdRef,
      })

      const firstOk = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      expect(firstOk).toBe(true)
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR)

      activeThreadIdRef.current = TEST_THREAD_ID
      const secondOk = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(secondOk).toBe(true)
      expect(ctx.dispatch).toHaveBeenCalledWith({
        type: 'hydrate_projection_snapshot',
        threadId: TEST_THREAD_ID,
        snapshot: projection,
      })
      expect(ctx.setThreadTranscriptSource).toHaveBeenCalledWith(TEST_THREAD_ID, 'replay')
      expect(ctx.clearThreadHistoryCursor).toHaveBeenCalledWith(TEST_THREAD_ID)
      expectReplayCursor(ctx, REPLAY_CURSOR_REBUILD_COMPLETE)
    })

    it('[rebuild] logs invariant issues once across hasGap baseline replay double-request path', async () => {
      const gapState = createReplayState({
        invariantIssues: [{ kind: 'running_tool_after_terminal_turn', turnId: TEST_TURN_ID, toolUseId: 'tool-1' }],
        projection: null,
      })
      const baselineState = createReplayState({
        invariantIssues: [
          { kind: 'running_tool_after_terminal_turn', turnId: TEST_TURN_ID, toolUseId: 'tool-1' },
          { kind: 'pending_input_after_terminal_turn', turnId: TEST_TURN_ID, inputId: 'input-1', toolUseId: 'tool-1' },
        ],
        projection: null,
      })
      const request = createReplayPagesRequest(
        ...createHasGapBaselineReplayPages({
          gapState,
          baselineState,
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(2)
      expectSingleWarning(ctx.log, replayInvariantWarning('running_tool_after_terminal_turn=1'))
    })

    it('[rebuild] defers baseline projection hydration for non-active threads after hasGap', async () => {
      const baselineProjection = createProjectionSnapshot('baseline-rebuilt')
      const request = createReplayPagesRequest(
        ...createHasGapBaselineReplayPages({
          gapState: createReplayState({ projection: null }),
          baselineState: createReplayState({ projection: baselineProjection }),
        }),
      )
      const ctx = createReplayContext({
        request,
        activeThreadIdRef: { current: 'thread-2' },
      })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(2)
      expect(ctx.dispatch).not.toHaveBeenCalledWith({
        type: 'hydrate_projection_snapshot',
        threadId: TEST_THREAD_ID,
        snapshot: baselineProjection,
      })
      expect(ctx.setThreadTranscriptSource).not.toHaveBeenCalled()
      expect(ctx.clearThreadHistoryCursor).not.toHaveBeenCalled()
      expectReplayCursor(ctx, INITIAL_REPLAY_CURSOR)
      expectRuntimeLastReplaySeq(ctx, REPLAY_SEQ_REBUILD_COMPLETE)
    })

    it('[rebuild] logs canonical protocol anomalies once across hasGap baseline replay double-request path', async () => {
      const gapState = createReplayState({
        canonicalProtocolAnomalyCount: 2,
        projection: null,
      })
      const baselineState = createReplayState({
        canonicalProtocolAnomalyCount: 5,
        projection: null,
      })
      const request = createReplayPagesRequest(
        ...createHasGapBaselineReplayPages({
          gapState,
          baselineState,
        }),
      )
      const ctx = createReplayContext({ request })

      const ok = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ok).toBe(true)
      expect(request).toHaveBeenCalledTimes(2)
      expectSingleWarning(ctx.log, replayAnomalyWarning(5))
    })

    it('[logging] logs canonical protocol anomalies only when replay count increases across calls', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          nextCursor: 51,
          latestCursor: 51,
          state: createReplayState({ canonicalProtocolAnomalyCount: 2 }),
        }),
        createReplayPage({
          nextCursor: 52,
          latestCursor: 52,
          state: createReplayState({ canonicalProtocolAnomalyCount: 2 }),
        }),
        createReplayPage({
          nextCursor: 53,
          latestCursor: 53,
          state: createReplayState({ canonicalProtocolAnomalyCount: 3 }),
        }),
      )
      const ctx = createReplayContext({ request })

      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expectWarningSequence(ctx.log, [replayAnomalyWarning(2), replayAnomalyWarning(3)])
    })

    it('[rebuild] continues incremental replay after hasGap rebuild without duplicate anomaly warnings', async () => {
      const request = createReplayPagesRequest(
        ...createHasGapBaselineReplayPages({
          gapState: createReplayState({
            canonicalProtocolAnomalyCount: 2,
            projection: null,
          }),
          baselineState: createReplayState({
            canonicalProtocolAnomalyCount: 2,
            projection: null,
          }),
        }),
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_INCREMENTAL)],
          nextCursor: REPLAY_SEQ_INCREMENTAL,
          latestCursor: REPLAY_SEQ_INCREMENTAL,
          state: createReplayState({
            canonicalProtocolAnomalyCount: 2,
          }),
        }),
      )
      const ctx = createReplayContext({ request })

      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expectReplayPageRequestArgs({ request, nth: 1, afterCursor: INITIAL_REPLAY_CURSOR })
      expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: TEST_THREAD_ID })
      expectReplayPageRequestArgs({ request, nth: 3, afterCursor: REPLAY_CURSOR_REBUILD_COMPLETE })
      expect(ctx.handleNotification).toHaveBeenCalledTimes(1)
      expectSingleWarning(ctx.log, replayAnomalyWarning(2))
      expectReplayCursor(ctx, REPLAY_SEQ_INCREMENTAL)
    })

    it('[rebuild] advances cursor after hasGap projection rebuild and only consumes new tail once', async () => {
      const request = createReplayPagesRequest(
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_REBUILD_COMPLETE)],
          nextCursor: REPLAY_SEQ_REBUILD_COMPLETE,
          latestCursor: REPLAY_SEQ_REBUILD_COMPLETE,
          hasGap: true,
          state: createReplayState({
            projection: createProjectionSnapshot('projection-rebuild'),
          }),
        }),
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_INCREMENTAL)],
          nextCursor: REPLAY_SEQ_INCREMENTAL,
          latestCursor: REPLAY_SEQ_INCREMENTAL,
          state: createReplayState(),
        }),
      )
      const ctx = createReplayContext({ request })

      const firstOk = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      expect(firstOk).toBe(true)
      expectReplayCursor(ctx, REPLAY_SEQ_REBUILD_COMPLETE)
      expect(ctx.handleNotification).not.toHaveBeenCalled()

      const secondOk = await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      expect(secondOk).toBe(true)
      expect(ctx.handleNotification).toHaveBeenCalledTimes(1)
      expectReplayCursor(ctx, REPLAY_SEQ_INCREMENTAL)
      expectReplayPageRequestArgs({ request, nth: 1, afterCursor: INITIAL_REPLAY_CURSOR })
      expectReplayPageRequestArgs({ request, nth: 2, afterCursor: REPLAY_SEQ_REBUILD_COMPLETE })
    })

    it('[promotion] promotes transcript source from history after rebuild followed by incremental entries', async () => {
      const request = createReplayPagesRequest(
        ...createHasGapBaselineReplayPages({
          gapState: createReplayState({ projection: null }),
          baselineState: createReplayState({ projection: null }),
        }),
        createReplayPage({
          data: [createReplayTurnEvent(REPLAY_SEQ_INCREMENTAL)],
          nextCursor: REPLAY_SEQ_INCREMENTAL,
          latestCursor: REPLAY_SEQ_INCREMENTAL,
          state: createReplayState(),
        }),
      )
      const transcriptSourceByThreadRef: ReplayThreadEventsContext['transcriptSourceByThreadRef'] = {
        current: { [TEST_THREAD_ID]: 'history' },
      }
      const setThreadTranscriptSource = vi.fn((threadId: string, source: 'replay' | 'history') => {
        transcriptSourceByThreadRef.current[threadId] = source
      })
      const ctx = createReplayContext({
        request,
        transcriptSourceByThreadRef,
        setThreadTranscriptSource,
      })

      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)
      expect(ctx.setThreadTranscriptSource).toHaveBeenCalledTimes(1)

      await replayThreadEvents(TEST_THREAD_ID, undefined, ctx)

      expect(ctx.setThreadTranscriptSource).toHaveBeenCalledTimes(2)
      expect(ctx.setThreadTranscriptSource).toHaveBeenNthCalledWith(2, TEST_THREAD_ID, 'replay')
    })
  })
})
