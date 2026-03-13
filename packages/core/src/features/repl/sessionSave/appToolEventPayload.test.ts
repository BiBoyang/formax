import { describe, expect, it } from 'vitest'
import type { CanonicalToolEvent } from '../../semantics/core/canonicalEvents'
import { toPersistedAppToolEventData } from './appToolEventPayload'

function canonicalToolEvent(
  phase: CanonicalToolEvent['phase'],
  overrides: Partial<CanonicalToolEvent> = {},
): CanonicalToolEvent {
  return {
    threadId: 'tui-live',
    replaySeq: 1,
    eventId: `tui-live:turn-1:tool_event:${phase}`,
    ts: '2026-02-23T00:00:00.000Z',
    source: 'tool',
    kind: 'tool_event',
    turnId: 'turn-1',
    toolUseId: 'tool-1',
    phase,
    ...overrides,
  }
}

describe('toPersistedAppToolEventData', () => {
  it('maps start/update/end canonical tool events to persisted app_tool_event payloads', () => {
    const start = toPersistedAppToolEventData(
      canonicalToolEvent('start', {
        toolName: 'Bash',
      }),
    )
    const update = toPersistedAppToolEventData(
      canonicalToolEvent('update', {
        input: { command: 'pwd' },
        paramsText: 'command="pwd"',
        line: '/repo',
      }),
    )
    const end = toPersistedAppToolEventData(
      canonicalToolEvent('end', {
        toolName: 'Bash',
        summary: '/repo',
        result: '/repo\n',
        isError: false,
      }),
    )

    expect(start).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'start',
      toolName: 'Bash',
      status: 'running',
      summary: 'Bash running',
    })
    expect(update).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'update',
      input: { command: 'pwd' },
      paramsText: 'command="pwd"',
      line: '/repo',
    })
    expect(end).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'end',
      toolName: 'Bash',
      status: 'completed',
      summary: '/repo',
      lines: ['/repo'],
    })
  })

  it('derives end status/summary/lines fallback from result + error flag', () => {
    const payload = toPersistedAppToolEventData(
      canonicalToolEvent('end', {
        result: 'line 1\nline 2\n',
        isError: true,
        patchStartLineNumber: 12.9,
      }),
    )

    expect(payload).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'end',
      status: 'error',
      summary: 'line 1',
      lines: ['line 1', 'line 2'],
      patchStartLineNumber: 12,
    })
  })

  it('uses explicit start summary and trims tool name/summary text', () => {
    const payload = toPersistedAppToolEventData(
      canonicalToolEvent('start', {
        toolName: '  Bash  ',
        summary: '  Running custom summary  ',
      }),
    )

    expect(payload).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'start',
      toolName: 'Bash',
      status: 'running',
      summary: 'Running custom summary',
    })
  })

  it('uses default start summary when toolName and summary are missing', () => {
    const payload = toPersistedAppToolEventData(canonicalToolEvent('start', {}))
    expect(payload).toMatchObject({
      phase: 'start',
      status: 'running',
      summary: 'Tool running',
    })
    expect(payload).not.toHaveProperty('toolName')
  })

  it('filters invalid update payload fields', () => {
    const payload = toPersistedAppToolEventData(
      canonicalToolEvent('update', {
        input: 'not-an-object' as any,
        paramsText: '   ',
        line: 42 as any,
      }),
    )

    expect(payload).toEqual({
      threadId: 'tui-live',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      phase: 'update',
    })
  })

  it('falls back end summary/status and validates patch line + line splitting limits', () => {
    const longResult = Array.from({ length: 120 }, (_, i) => `line ${i + 1}   `).join('\n')
    const completed = toPersistedAppToolEventData(
      canonicalToolEvent('end', {
        result: '',
        isError: false,
        patchStartLineNumber: 0,
      }),
    )
    const errored = toPersistedAppToolEventData(
      canonicalToolEvent('end', {
        result: '',
        isError: true,
        patchStartLineNumber: Number.POSITIVE_INFINITY,
      }),
    )
    const limitedLines = toPersistedAppToolEventData(
      canonicalToolEvent('end', {
        result: longResult,
        isError: false,
      }),
    )

    expect(completed).toMatchObject({
      phase: 'end',
      status: 'completed',
      summary: 'Tool completed',
    })
    expect(completed).not.toHaveProperty('patchStartLineNumber')

    expect(errored).toMatchObject({
      phase: 'end',
      status: 'error',
      summary: 'Tool failed',
    })
    expect(errored).not.toHaveProperty('patchStartLineNumber')

    expect(limitedLines.lines?.length).toBe(80)
    expect(limitedLines.lines?.[0]).toBe('line 1')
  })
})
