import { describe, expect, it, vi } from 'vitest'
import {
  replayThreadEvents,
  resolveReplayCursorProgress,
  type ReplayThreadEventsContext,
} from './replayThreadEvents'
import type { ReplayStateSnapshot } from '../core/rpcParsers'

type ReplayPage = ReturnType<ReplayThreadEventsContext['asThreadReplay']>
type ReplayRequestMock = ReturnType<typeof vi.fn>
type ReplayLogMock = ReturnType<typeof vi.fn>
const TEST_THREAD_ID = 'thread-1'
const TEST_TURN_ID = 'turn-1'

// Replay sequence/time constants
const REPLAY_STATE_UPDATED_AT = '2026-02-17T00:00:00.000Z'
const REPLAY_SEQ_BASELINE = 51
const REPLAY_SEQ_INCREMENTAL = 121
const REPLAY_SEQ_REBUILD_COMPLETE = 120

// Replay cursor constants
const INITIAL_REPLAY_CURSOR = 50
const REPLAY_CURSOR_FROM_START = 0
const REPLAY_CURSOR_REBUILD_COMPLETE = REPLAY_SEQ_REBUILD_COMPLETE

// Replay request constants
const REPLAY_PAGE_SIZE = 200
const REPLAY_REQUEST_DEFAULTS = {
  baselineCursor: REPLAY_CURSOR_REBUILD_COMPLETE,
  progressStep: 1,
  pageSize: REPLAY_PAGE_SIZE,
} as const

// Assertion helpers
function expectReplayPageRequestArgs(args: { request: ReplayRequestMock; nth: number; after: number }) {
  expect(args.request).toHaveBeenNthCalledWith(args.nth, 'thread/replay', {
    threadId: TEST_THREAD_ID,
    after: args.after,
    limit: REPLAY_REQUEST_DEFAULTS.pageSize,
  })
}

function expectReplayCursor(ctx: ReplayThreadEventsContext, cursor: number) {
  expect(ctx.replayCursorByThreadRef.current[TEST_THREAD_ID]).toBe(cursor)
}

function expectRuntimeLastReplaySeq(ctx: ReplayThreadEventsContext, replaySeq: number) {
  expect(ctx.runtimeStateByThreadRef.current[TEST_THREAD_ID]?.lastReplaySeq).toBe(replaySeq)
}

// Warning helpers
function replayInvariantWarning(details: string) {
  return `Replay invariant issues detected (${details})`
}

function replayAnomalyWarning(count: number) {
  return `Replay canonical protocol anomalies detected (count=${count})`
}

function expectSingleWarning(log: ReplayLogMock, message: string) {
  expect(log).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith(message, 'warn')
}

function expectWarningSequence(log: ReplayLogMock, messages: string[]) {
  expect(log).toHaveBeenCalledTimes(messages.length)
  for (const [index, message] of messages.entries()) {
    expect(log).toHaveBeenNthCalledWith(index + 1, message, 'warn')
  }
}

// Replay fixture builders
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
    asThreadReplay: (value) => value as ReturnType<ReplayThreadEventsContext['asThreadReplay']>,
    toRuntimePendingInputsById: vi.fn().mockReturnValue({}),
    replayCursorByThreadRef: { current: { [TEST_THREAD_ID]: INITIAL_REPLAY_CURSOR } },
    replayAnomalyCountSeenByThreadRef: { current: {} },
    runtimeStateByThreadRef: { current: {} },
    activeThreadIdRef: { current: TEST_THREAD_ID },
    logsByThreadIdRef: { current: { [TEST_THREAD_ID]: [{ id: 'cached-log' }] } },
    stateLogsRef: { current: [{ id: 'active-log' }] },
    transcriptSourceByThreadRef: { current: { [TEST_THREAD_ID]: 'history' } },
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
    nextCursor: 0,
    latestCursor: 0,
    hasGap: false,
    state: null,
    ...overrides,
  } as ReplayPage
}

function createReplayTurnEvent(replaySeq: number, method: 'turn/started' | 'turn/progress' = 'turn/started') {
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
  for (const page of pages) {
    request.mockResolvedValueOnce(page)
  }
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
  const createPageForCursor = (after: number) =>
    createReplayPage({
      nextCursor: after + step,
      latestCursor: args.latestCursor,
      state: args.state ?? createReplayState(),
    })
  return vi.fn().mockImplementation((_method: string, params?: unknown) => {
    const after = Number((params as { after?: number } | undefined)?.after ?? 0)
    return Promise.resolve(createPageForCursor(after))
  })
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
    expectReplayPageRequestArgs({ request, nth: 1, after: INITIAL_REPLAY_CURSOR })
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
      expectReplayPageRequestArgs({ request, nth: 1, after: REPLAY_CURSOR_FROM_START })
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

      expectReplayPageRequestArgs({ request, nth: 1, after: INITIAL_REPLAY_CURSOR })
      expect(request).toHaveBeenNthCalledWith(2, 'thread/replay', { threadId: TEST_THREAD_ID })
      expectReplayPageRequestArgs({ request, nth: 3, after: REPLAY_CURSOR_REBUILD_COMPLETE })
      expect(ctx.handleNotification).toHaveBeenCalledTimes(1)
      expectSingleWarning(ctx.log, replayAnomalyWarning(2))
      expectReplayCursor(ctx, REPLAY_SEQ_INCREMENTAL)
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
