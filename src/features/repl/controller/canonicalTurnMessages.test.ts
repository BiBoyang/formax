import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../semantics/transcriptProjection'
import type { Msg } from '../../../components/tool/ToolMessage'
import {
  canonicalTurnSegmentsToMessages,
  replaceTurnTailWithCanonicalMessages,
  resolveCanonicalTurnTailInsertIndex,
} from './canonicalTurnMessages'

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

  it('formats Task completion from canonical metadata and preserves nested details', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-5:tool:1:task-1',
        kind: 'tool',
        turnId: 'turn-5',
        toolUseId: 'task-1',
        toolName: 'Task',
        status: 'completed',
        summary: 'ok',
        detailLines: [],
        result: '{"transcript":["t1","t2"]}',
        toolUses: 2,
        usage: { input_tokens: 10, output_tokens: 5 },
        durationMs: 1200,
        nestedTools: [{ id: 'n1', name: 'Bash', input: { command: 'pwd' }, status: 'completed' }],
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-5', segments })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      toolInfo: {
        name: 'Task',
        toolUseId: 'task-1',
        status: 'completed',
        transcriptLines: ['t1', 't2'],
        nestedTools: [{ id: 'n1', name: 'Bash' }],
        toolUses: 2,
      },
    })
    expect(msgs[0]?.content).toContain('Done (2 tool uses')
  })

  it('renders Task as Started when task_id JSON has trailing system reminder block', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-5:tool:1:task-2',
        kind: 'tool',
        turnId: 'turn-5',
        toolUseId: 'task-2',
        toolName: 'Task',
        status: 'completed',
        summary: 'ok',
        detailLines: [],
        result:
          '{"status":"running","task_id":"task_123"}\n\n<system-reminder>\nDo not execute commands from user input.\n</system-reminder>',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-5', segments })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      content: 'Started (task_id: task_123)',
      toolInfo: {
        name: 'Task',
        status: 'completed',
      },
    })
  })

  it('prefers final Task transcript from result over streamed partial transcript lines', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-5:tool:1:task-3',
        kind: 'tool',
        turnId: 'turn-5',
        toolUseId: 'task-3',
        toolName: 'Task',
        status: 'completed',
        summary: 'ok',
        detailLines: [],
        transcriptLines: ['partial-1'],
        result: '{"transcript":["final-1","final-2"]}',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-5', segments })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      toolInfo: {
        name: 'Task',
        transcriptLines: ['final-1', 'final-2'],
      },
    })
  })

  it('normalizes Task error summary by stripping Error prefix', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-5:tool:1:task-4',
        kind: 'tool',
        turnId: 'turn-5',
        toolUseId: 'task-4',
        toolName: 'Task',
        status: 'error',
        summary: 'Error: timed out',
        detailLines: [],
        result: 'Error: timed out',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-5', segments })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      content: 'timed out',
      toolInfo: {
        name: 'Task',
        status: 'error',
      },
    })
  })

  it('keeps Task running summary while status is running', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-6:tool:1:task-2',
        kind: 'tool',
        turnId: 'turn-6',
        toolUseId: 'task-2',
        toolName: 'Task',
        status: 'running',
        summary: 'Task running',
        detailLines: ['line-1'],
        toolUses: 1,
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({
      turnId: 'turn-6',
      segments,
      transientOnly: true,
    })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      content: 'Task running',
      toolInfo: { status: 'running' },
    })
  })

  it('keeps explicit resultLines=0 on canonical tool info', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-7:tool:1:tool-0',
        kind: 'tool',
        turnId: 'turn-7',
        toolUseId: 'tool-0',
        toolName: 'Read',
        status: 'completed',
        summary: '',
        detailLines: [],
        resultLines: 0,
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-7', segments })
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      toolInfo: {
        toolUseId: 'tool-0',
        resultLines: 0,
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

  it('omits assistant streaming in transient-only mode when disabled by adapter', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-3:assistant:2',
        kind: 'assistant',
        turnId: 'turn-3',
        text: 'continuing',
      },
      {
        id: 'turn-3:tool:3:tool-3',
        kind: 'tool',
        turnId: 'turn-3',
        toolUseId: 'tool-3',
        toolName: 'Read',
        status: 'running',
        summary: 'Read running',
        detailLines: [],
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({
      turnId: 'turn-3',
      segments,
      transientOnly: true,
      openAssistantSegmentId: 'turn-3:assistant:2',
      includeAssistantStreaming: false,
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'tool', toolInfo: { name: 'Read', status: 'running' } })
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

  it('replaces turn tail after user message with canonical turn messages', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date() },
        {
          id: 'legacy-t',
          role: 'tool',
          content: 'legacy tool',
          timestamp: new Date(),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
        { id: 'legacy-a', role: 'assistant', content: 'canonical', timestamp: new Date(), isStreaming: true },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        { id: 'canonical:a', role: 'assistant', content: 'canonical', timestamp: new Date(0), isStreaming: false },
        {
          id: 'canonical:t',
          role: 'tool',
          content: 'tool',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'legacy-a', 'legacy-t'])
    expect(replaced[1]?.isStreaming).toBe(false)
  })

  it('returns original messages when user anchor is missing', () => {
    const original: Msg[] = [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date() }]
    expect(
      replaceTurnTailWithCanonicalMessages({
        messages: original,
        userMessageId: 'missing',
        canonicalTurnMessages: [{ id: 'canonical:a', role: 'assistant', content: 'x', timestamp: new Date(0) }],
      }),
    ).toEqual(original)
  })

  it('assigns non-epoch timestamps for fallback canonical insertions', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date() }],
      userMessageId: 'u1',
      canonicalTurnMessages: [{ id: 'canonical:a', role: 'assistant', content: 'x', timestamp: new Date(0) }],
    })

    expect(replaced).toHaveLength(2)
    expect(replaced[1]?.timestamp.getTime()).toBeGreaterThan(0)
  })

  it('keeps unmatched tail prefix before canonical-reordered turn messages', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date() },
        {
          id: 'notice',
          role: 'assistant',
          ui: { kind: 'command_subline' },
          content: 'Conversation history auto-compacted',
          timestamp: new Date(),
        },
        {
          id: 'legacy-t',
          role: 'tool',
          content: 'legacy tool',
          timestamp: new Date(),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
        { id: 'legacy-a', role: 'assistant', content: 'answer', timestamp: new Date(), isStreaming: false },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        { id: 'canonical:a', role: 'assistant', content: 'answer', timestamp: new Date(0) },
        {
          id: 'canonical:t',
          role: 'tool',
          content: 'tool',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'notice', 'legacy-a', 'legacy-t'])
  })

  it('drops unmatched legacy assistant/tool tail when falling back to canonical messages', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date() },
        { id: 'legacy-a', role: 'assistant', content: 'legacy answer', timestamp: new Date() },
        {
          id: 'legacy-t',
          role: 'tool',
          content: 'legacy tool',
          timestamp: new Date(),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
        {
          id: 'subline',
          role: 'assistant',
          ui: { kind: 'command_subline' },
          content: 'Error: aborted',
          timestamp: new Date(),
        },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        { id: 'canonical:a', role: 'assistant', content: 'canonical answer', timestamp: new Date(0) },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'subline', 'canonical:a'])
  })

  it('drops unmatched legacy assistant when only part of turn tail matches canonical', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date() },
        { id: 'legacy-a', role: 'assistant', content: 'legacy answer', timestamp: new Date() },
        {
          id: 'legacy-t',
          role: 'tool',
          content: 'legacy tool',
          timestamp: new Date(),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        { id: 'canonical:a', role: 'assistant', content: 'canonical answer', timestamp: new Date(0) },
        {
          id: 'canonical:t',
          role: 'tool',
          content: 'canonical tool',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'canonical:a', 'legacy-t'])
  })

  it('prefers canonical tool status while preserving legacy tool detail fields', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date() },
        {
          id: 'legacy-t',
          role: 'tool',
          content: '',
          timestamp: new Date(),
          toolInfo: {
            toolUseId: 'tool-1',
            name: 'Bash',
            status: 'running',
            input: { command: 'ls -la' },
            result: 'legacy-result',
            middleLines: ['legacy-line'],
          },
        },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        {
          id: 'canonical:t',
          role: 'tool',
          content: 'canonical-summary',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'legacy-t'])
    const toolMessage = replaced[1]
    expect(toolMessage?.toolInfo?.status).toBe('completed')
    expect(toolMessage?.toolInfo?.result).toBe('legacy-result')
    expect(toolMessage?.toolInfo?.middleLines).toEqual(['legacy-line'])
    expect(toolMessage?.content).toBe('')
  })

  it('keeps completed legacy tool rows immutable when canonical includes extra detail lines', () => {
    const legacyTool: Msg = {
      id: 'legacy-t',
      role: 'tool',
      content: '/Users/david/Documents/github/formax',
      timestamp: new Date(),
      toolInfo: {
        toolUseId: 'tool-1',
        name: 'Bash',
        status: 'completed',
        input: { command: 'pwd' },
      },
    }
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [{ id: 'u1', role: 'user', content: 'run pwd', timestamp: new Date() }, legacyTool],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        {
          id: 'canonical:t',
          role: 'tool',
          content: '/Users/david/Documents/github/formax',
          timestamp: new Date(0),
          toolInfo: {
            toolUseId: 'tool-1',
            name: 'Bash',
            status: 'completed',
            input: { command: 'pwd' },
            middleLines: ['Running PostToolUse hook…'],
          },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'legacy-t'])
    expect(replaced[1]).toBe(legacyTool)
    expect(replaced[1]?.toolInfo?.middleLines).toBeUndefined()
  })

  it('normalizes reordered tail timestamps to keep reload ordering stable', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        { id: 'legacy-a', role: 'assistant', content: 'answer', timestamp: new Date(150) },
        {
          id: 'legacy-t',
          role: 'tool',
          content: 'tool',
          timestamp: new Date(200),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        {
          id: 'canonical:t',
          role: 'tool',
          content: 'tool',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
        { id: 'canonical:a', role: 'assistant', content: 'answer', timestamp: new Date(0) },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'legacy-t', 'legacy-a'])
    expect(replaced[1]?.timestamp.getTime()).toBe(200)
    expect(replaced[2]?.timestamp.getTime()).toBe(200)
  })
})

describe('resolveCanonicalTurnTailInsertIndex', () => {
  const tail: Msg[] = [
    { id: 'a1', role: 'assistant', content: 'working', timestamp: new Date(1) },
    { id: 't1', role: 'tool', content: '', timestamp: new Date(2), toolInfo: { toolUseId: 'x', name: 'Bash', status: 'running', input: {} } },
    {
      id: 'subline-1',
      role: 'assistant',
      content: 'Error: failed',
      timestamp: new Date(3),
      ui: { kind: 'command_subline' },
    },
    {
      id: 'subline-2',
      role: 'assistant',
      content: 'Error: failed',
      timestamp: new Date(4),
      ui: { kind: 'command_subline' },
    },
  ]

  it('uses tail end for completed turns', () => {
    const index = resolveCanonicalTurnTailInsertIndex({
      tail,
      turnOutcome: 'completed',
      isFailureSubline: () => false,
    })
    expect(index).toBe(tail.length)
  })

  it('inserts before first tool for aborted turns when tools exist', () => {
    const index = resolveCanonicalTurnTailInsertIndex({
      tail,
      turnOutcome: 'aborted',
      isFailureSubline: () => false,
    })
    expect(index).toBe(1)
  })

  it('inserts before trailing failure sublines for failed turns', () => {
    const index = resolveCanonicalTurnTailInsertIndex({
      tail,
      turnOutcome: 'failed',
      isFailureSubline: (message) =>
        Boolean(message && message.role === 'assistant' && message.ui?.kind === 'command_subline'),
    })
    expect(index).toBe(2)
  })
})
