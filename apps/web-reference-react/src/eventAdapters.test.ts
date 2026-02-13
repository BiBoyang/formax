import { describe, expect, it } from 'vitest'
import { mapThreadHistoryToCanonicalLogs } from './eventAdapters'
import type { ThreadMessage } from './types'

describe('mapThreadHistoryToCanonicalLogs', () => {
  it('keeps user messages and maps assistant/tool rows through canonical projection', () => {
    const messages: ThreadMessage[] = [
      { id: 'm-user', kind: 'message', role: 'user', text: 'hello' },
      { id: 'm-assistant', kind: 'message', role: 'assistant', text: 'world' },
      {
        id: 'm-tool',
        kind: 'tool',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'completed',
        summary: 'done',
        detailLines: ['line-1', 'line-2'],
      },
    ]

    const logs = mapThreadHistoryToCanonicalLogs({ threadId: 'thread-1', messages })
    expect(logs).toHaveLength(3)
    expect(logs[0]).toMatchObject({ kind: 'message', role: 'user', text: 'hello' })
    expect(logs[1]).toMatchObject({ kind: 'message', role: 'assistant', text: 'world' })
    expect(logs[2]).toMatchObject({
      kind: 'tool_call',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      status: 'completed',
      summary: 'done',
      detailLines: ['line-1', 'line-2'],
    })
  })

  it('maps tool params and error status', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'm-tool',
        kind: 'tool',
        toolUseId: 'tool-err',
        toolName: 'Write',
        status: 'error',
        summary: 'permission denied',
        paramsText: 'path=".claude/plan.md"',
      },
    ]

    const logs = mapThreadHistoryToCanonicalLogs({ threadId: 'thread-2', messages })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      kind: 'tool_call',
      toolUseId: 'tool-err',
      toolName: 'Write',
      status: 'error',
      summary: 'permission denied',
      paramsText: 'path=".claude/plan.md"',
      detailLines: [],
    })
  })

  it('preserves running status and summary for history tool rows', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'm-tool-running',
        kind: 'tool',
        toolUseId: 'tool-running',
        toolName: 'Bash',
        status: 'running',
        summary: 'Running command for 16s',
        detailLines: ['pwd'],
      },
    ]

    const logs = mapThreadHistoryToCanonicalLogs({ threadId: 'thread-3', messages })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      kind: 'tool_call',
      toolUseId: 'tool-running',
      toolName: 'Bash',
      status: 'running',
      summary: 'Running command for 16s',
      detailLines: ['pwd'],
    })
  })
})
