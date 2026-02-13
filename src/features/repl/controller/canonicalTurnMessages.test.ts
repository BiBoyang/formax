import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../semantics/transcriptProjection'
import { canonicalTurnSegmentsToMessages } from './canonicalTurnMessages'

describe('canonicalTurnSegmentsToMessages', () => {
  it('maps assistant/thinking/tool segments into transcript messages', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-1:thinking:1',
        kind: 'thinking',
        turnId: 'turn-1',
        text: 'thinking...',
        status: 'running',
      },
      {
        id: 'turn-1:assistant:2',
        kind: 'assistant',
        turnId: 'turn-1',
        text: 'answer',
      },
      {
        id: 'turn-1:tool:3:tool-1',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'completed',
        summary: 'total 1',
        detailLines: ['OUT total 1'],
        paramsText: 'command="ls -la", cwd="/repo"',
      },
      {
        id: 'turn-1:turn_footer:4',
        kind: 'turn_footer',
        turnId: 'turn-1',
        status: 'completed',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-1', segments })
    expect(msgs).toHaveLength(3)

    expect(msgs[0]).toMatchObject({
      id: 'canonical:turn-1:thinking:1',
      role: 'assistant',
      ui: { kind: 'thinking_block' },
      content: 'thinking...',
    })
    expect(msgs[1]).toMatchObject({
      id: 'canonical:turn-1:assistant:2',
      role: 'assistant',
      content: 'answer',
      isStreaming: true,
    })
    expect(msgs[2]).toMatchObject({
      id: 'canonical:turn-1:tool:3:tool-1',
      role: 'tool',
      content: 'total 1',
      toolInfo: {
        name: 'Bash',
        toolUseId: 'tool-1',
        status: 'completed',
        input: { command: 'ls -la', cwd: '/repo' },
        middleLines: ['OUT total 1'],
      },
    })
  })

  it('keeps unparseable json fragments as strings in tool input', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-1:tool:1:tool-1',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Write',
        status: 'running',
        summary: 'Write running',
        detailLines: [],
        paramsText: 'content={"a":1...',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-1', segments })
    expect(msgs[0]?.toolInfo?.input).toEqual({ content: '{"a":1...' })
  })

  it('flattens multiline tool summaries into first-line summary plus middle lines', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-2:tool:1:tool-2',
        kind: 'tool',
        turnId: 'turn-2',
        toolUseId: 'tool-2',
        toolName: 'Bash',
        status: 'completed',
        summary: 'OUT first\nOUT second\nOUT third',
        detailLines: [],
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-2', segments })
    expect(msgs[0]).toMatchObject({
      content: 'OUT first',
      toolInfo: {
        middleLines: ['OUT second', 'OUT third'],
      },
    })
  })

  it('omits completed tools in transient-only mode', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-3:tool:1:tool-3',
        kind: 'tool',
        turnId: 'turn-3',
        toolUseId: 'tool-3',
        toolName: 'Read',
        status: 'completed',
        summary: 'Read 10 lines',
        detailLines: [],
      },
      {
        id: 'turn-3:assistant:2',
        kind: 'assistant',
        turnId: 'turn-3',
        text: 'continuing',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({
      turnId: 'turn-3',
      segments,
      transientOnly: true,
      openAssistantSegmentId: 'turn-3:assistant:2',
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'assistant', content: 'continuing' })
  })

  it('keeps only open assistant + running tool in transient-only mode', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-4:assistant:1',
        kind: 'assistant',
        turnId: 'turn-4',
        text: 'closed segment',
      },
      {
        id: 'turn-4:thinking:2',
        kind: 'thinking',
        turnId: 'turn-4',
        text: 'hidden thinking',
        status: 'running',
      },
      {
        id: 'turn-4:assistant:3',
        kind: 'assistant',
        turnId: 'turn-4',
        text: 'open segment',
      },
      {
        id: 'turn-4:tool:4:tool-4',
        kind: 'tool',
        turnId: 'turn-4',
        toolUseId: 'tool-4',
        toolName: 'Bash',
        status: 'running',
        summary: 'Bash running',
        detailLines: [],
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({
      turnId: 'turn-4',
      segments,
      transientOnly: true,
      openAssistantSegmentId: 'turn-4:assistant:3',
    })

    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'assistant', content: 'open segment' })
    expect(msgs[1]).toMatchObject({
      role: 'tool',
      toolInfo: { name: 'Bash', status: 'running' },
    })
  })
})
