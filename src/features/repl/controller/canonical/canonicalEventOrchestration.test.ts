import { describe, expect, it } from 'vitest'
import { appendCanonicalTurnFinalRows } from './canonicalTurnMessages'
import { projectCanonicalEventToTransientMessages } from './canonicalEventOrchestration'
import { createInitialTranscriptProjectionState } from '../../../semantics/projection/projection'
import type { CanonicalEvent } from '../../../semantics/core/core'
import type { Msg } from '../../../../components/tool/ToolMessage'

function canonicalEvent(replaySeq: number, payload: Record<string, unknown>): CanonicalEvent {
  return {
    threadId: 'thread-1',
    replaySeq,
    eventId: `e-${replaySeq}`,
    ts: '2026-02-17T00:00:00.000Z',
    source: 'engine',
    ...payload,
  } as CanonicalEvent
}

describe('canonical event orchestration', () => {
  it('keeps one tool row per tool_use_id and retains assistant output in final rows', () => {
    const turnId = 'turn-1'
    let projection = createInitialTranscriptProjectionState({ threadId: 'thread-1' })

    const events: CanonicalEvent[] = [
      canonicalEvent(1, { kind: 'assistant_delta', turnId, textDelta: 'planning...' }),
      canonicalEvent(2, { kind: 'tool_event', turnId, toolUseId: 'tool-1', phase: 'start', toolName: 'Bash' }),
      canonicalEvent(3, { kind: 'tool_event', turnId, toolUseId: 'tool-1', phase: 'update', line: 'OUT pwd' }),
      canonicalEvent(4, { kind: 'tool_event', turnId, toolUseId: 'tool-1', phase: 'end', summary: 'ok', result: 'ok' }),
      canonicalEvent(5, { kind: 'assistant_delta', turnId, textDelta: 'done' }),
      canonicalEvent(6, { kind: 'turn_footer', turnId, status: 'completed' }),
    ]

    for (const event of events) {
      const projected = projectCanonicalEventToTransientMessages({
        projection,
        event,
        activeTurnId: turnId,
        includeAssistantStreaming: true,
      })
      projection = projected.projection
      const toolRows = projected.messages.filter((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 'tool-1')
      expect(toolRows.length).toBeLessThanOrEqual(1)
    }

    const baselineMessages: Msg[] = [
      { id: 'u1', role: 'user', content: 'run', timestamp: new Date('2026-02-17T00:00:00.000Z') },
    ]
    const finalRows = appendCanonicalTurnFinalRows({
      messages: baselineMessages,
      userMessageId: 'u1',
      turnId,
      turnOutcome: 'completed',
      projectionSegments: projection.segments,
      isFailureSubline: () => false,
    })

    const finalToolRows = finalRows.filter((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 'tool-1')
    expect(finalToolRows).toHaveLength(1)
    expect(finalRows.some((m) => m.role === 'assistant' && String(m.content).includes('done'))).toBe(true)
  })

  it('reuses previous transient messages when projection change does not affect rows', () => {
    const turnId = 'turn-2'
    let projection = createInitialTranscriptProjectionState({ threadId: 'thread-1' })

    const first = projectCanonicalEventToTransientMessages({
      projection,
      event: canonicalEvent(1, { kind: 'assistant_delta', turnId, textDelta: 'hello' }),
      activeTurnId: turnId,
      includeAssistantStreaming: true,
      previousTransient: null,
    })
    projection = first.projection
    expect(first.changed).toBe(true)

    const duplicateEventId = projectCanonicalEventToTransientMessages({
      projection,
      event: { ...canonicalEvent(2, { kind: 'assistant_delta', turnId, textDelta: 'ignored' }), eventId: 'e-1' },
      activeTurnId: turnId,
      includeAssistantStreaming: true,
      previousTransient: {
        turnId,
        includeAssistantStreaming: true,
        messages: first.messages,
      },
    })

    expect(duplicateEventId.changed).toBe(false)
    expect(duplicateEventId.messages).toBe(first.messages)
  })
})
