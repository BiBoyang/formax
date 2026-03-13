import type { StreamEvent } from '@formax/shared/streaming'

export type NotificationFixture = {
  method: 'turn/event' | 'turn/completed' | 'turn/failed' | 'turn/inputRequested' | 'turn/inputResolved'
  params: Record<string, unknown>
}

export const CROSS_PATH_CONTRACT_FIXTURE = {
  threadId: 'thread-contract',
  turnId: 'turn-contract',
  ts: '2026-02-17T00:10:00.000Z',
  streamEvents: [
    { type: 'assistant_delta', text: 'hello' },
    { type: 'tool_start', id: 'tool-1', name: 'Bash' },
    { type: 'tool_end', id: 'tool-1', result: { tool_use_id: 'tool-1', content: 'ok', is_error: false } },
    { type: 'complete' },
  ] satisfies StreamEvent[],
  notifications: [
    {
      method: 'turn/event',
      params: {
        threadId: 'thread-contract',
        turnId: 'turn-contract',
        replaySeq: 1,
        eventId: 'evt-1',
        ts: '2026-02-17T00:10:00.000Z',
        source: 'engine',
        event: { type: 'assistant_delta', text: 'hello' },
      },
    },
    {
      method: 'turn/event',
      params: {
        threadId: 'thread-contract',
        turnId: 'turn-contract',
        replaySeq: 2,
        eventId: 'evt-2',
        ts: '2026-02-17T00:10:00.000Z',
        source: 'engine',
        event: { type: 'tool_start', id: 'tool-1', name: 'Bash' },
      },
    },
    {
      method: 'turn/event',
      params: {
        threadId: 'thread-contract',
        turnId: 'turn-contract',
        replaySeq: 3,
        eventId: 'evt-3',
        ts: '2026-02-17T00:10:00.000Z',
        source: 'engine',
        event: { type: 'tool_end', id: 'tool-1', result: { tool_use_id: 'tool-1', content: 'ok', is_error: false } },
      },
    },
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-contract',
        turn: { id: 'turn-contract', threadId: 'thread-contract' },
        replaySeq: 4,
        eventId: 'evt-4',
        ts: '2026-02-17T00:10:00.000Z',
        source: 'engine',
      },
    },
  ] satisfies NotificationFixture[],
  inputLifecycleNotifications: [
    {
      method: 'turn/inputRequested',
      params: {
        threadId: 'thread-contract',
        turnId: 'turn-contract',
        replaySeq: 5,
        eventId: 'evt-5',
        ts: '2026-02-17T00:10:01.000Z',
        source: 'policy',
        input: {
          inputId: 'input-1',
          threadId: 'thread-contract',
          turnId: 'turn-contract',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'pending',
          payload: { toolName: 'Bash' },
        },
      },
    },
    {
      method: 'turn/inputResolved',
      params: {
        threadId: 'thread-contract',
        turnId: 'turn-contract',
        replaySeq: 6,
        eventId: 'evt-6',
        ts: '2026-02-17T00:10:02.000Z',
        source: 'policy',
        input: {
          inputId: 'input-1',
          threadId: 'thread-contract',
          turnId: 'turn-contract',
          toolUseId: 'tool-1',
          kind: 'approval',
          status: 'submitted',
          payload: { toolName: 'Bash' },
        },
      },
    },
  ] satisfies NotificationFixture[],
  terminalStatusNotifications: [
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-contract',
        turn: { id: 'turn-completed', threadId: 'thread-contract' },
        replaySeq: 20,
        eventId: 'evt-20',
        ts: '2026-02-17T00:10:03.000Z',
        source: 'engine',
      },
    },
    {
      method: 'turn/failed',
      params: {
        threadId: 'thread-contract',
        turn: { id: 'turn-failed', threadId: 'thread-contract', status: 'failed' },
        replaySeq: 30,
        eventId: 'evt-30',
        ts: '2026-02-17T00:10:04.000Z',
        source: 'engine',
        error: 'boom',
      },
    },
  ] satisfies NotificationFixture[],
} as const
