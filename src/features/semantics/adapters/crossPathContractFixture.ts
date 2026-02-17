import type { StreamEvent } from '../../../streaming/types'

export type NotificationFixture = {
  method: 'turn/event' | 'turn/completed'
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
} as const
