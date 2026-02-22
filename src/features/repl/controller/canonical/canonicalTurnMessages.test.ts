import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../../semantics/projection/transcriptProjection'
import type { Msg } from '../../../../components/tool/ToolMessage'
import {
  appendCanonicalTailFinalRows,
  assertNoDuplicateToolUseIdsInTurn,
  appendCanonicalTurnFinalRows,
  canonicalTurnSegmentsToMessages,
  computeCanonicalTurnAppend,
  mergeCanonicalTurnIntoMessages,
  replaceTurnTailWithCanonicalMessages,
  resolveCanonicalTurnTailInsertIndex,
  tailSegmentsForTurn,
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
      id: 'canonical:turn-1:tool:tool-1',
      role: 'tool',
      content: 'total 1',
      surfaceOwner: 'static',
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

  it('does not expand Read rows from multiline summary when raw result is present', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-read:tool:1:read-1',
        kind: 'tool',
        turnId: 'turn-read',
        toolUseId: 'read-1',
        toolName: 'Read',
        status: 'completed',
        summary: '1\tfirst line\n2\tsecond line\n3\tthird line',
        detailLines: [],
        result: '1\tfirst line\n2\tsecond line\n3\tthird line',
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({ turnId: 'turn-read', segments })
    expect(msgs[0]).toMatchObject({
      content: 'Read 3 lines',
      toolInfo: {
        middleLines: [],
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
      isStreaming: true,
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

  it('keeps completed tools in transient-only mode', () => {
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
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({
      role: 'tool',
      toolInfo: { toolUseId: 'tool-3', status: 'completed' },
      surfaceOwner: 'static',
    })
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'continuing', isStreaming: true })
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

  it('keeps closed assistant segments visible in transient-only mode when assistant streaming is disabled', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'turn-3:assistant:1',
        kind: 'assistant',
        turnId: 'turn-3',
        text: "I'll run pwd first.",
      },
      {
        id: 'turn-3:tool:2:tool-3',
        kind: 'tool',
        turnId: 'turn-3',
        toolUseId: 'tool-3',
        toolName: 'Bash',
        status: 'running',
        summary: 'Bash running',
        detailLines: [],
      },
    ]

    const msgs = canonicalTurnSegmentsToMessages({
      turnId: 'turn-3',
      segments,
      transientOnly: true,
      openAssistantSegmentId: undefined,
      includeAssistantStreaming: false,
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({
      role: 'assistant',
      content: "I'll run pwd first.",
      surfaceOwner: 'static',
    })
    expect(msgs[1]).toMatchObject({
      role: 'tool',
      toolInfo: { name: 'Bash', status: 'running' },
      surfaceOwner: 'transient',
      isStreaming: true,
    })
  })

  it('keeps closed assistant segments visible while streaming in transient-only mode', () => {
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

    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toMatchObject({ role: 'assistant', content: 'closed segment', surfaceOwner: 'static' })
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      content: 'open segment',
      surfaceOwner: 'transient',
      isStreaming: true,
    })
    expect(msgs[2]).toMatchObject({
      role: 'tool',
      toolInfo: { name: 'Bash', status: 'running' },
      surfaceOwner: 'transient',
      isStreaming: true,
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
      timestamp: new Date(20),
      toolInfo: {
        toolUseId: 'tool-1',
        name: 'Bash',
        status: 'completed',
        input: { command: 'pwd' },
      },
    }
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [{ id: 'u1', role: 'user', content: 'run pwd', timestamp: new Date(10) }, legacyTool],
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

  it('collapses duplicated legacy tool rows with the same toolUseId', () => {
    const replaced = replaceTurnTailWithCanonicalMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'run', timestamp: new Date(100) },
        {
          id: 'legacy-tool-1',
          role: 'tool',
          content: '/repo',
          timestamp: new Date(200),
          toolInfo: { toolUseId: 'tool-dup', name: 'Bash', status: 'completed', input: {} },
        },
        {
          id: 'legacy-tool-2',
          role: 'tool',
          content: '/repo',
          timestamp: new Date(201),
          toolInfo: { toolUseId: 'tool-dup', name: 'Bash', status: 'completed', input: {} },
        },
      ],
      userMessageId: 'u1',
      canonicalTurnMessages: [
        {
          id: 'canonical-tool',
          role: 'tool',
          content: '/repo',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-dup', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(replaced.map((message) => message.id)).toEqual(['u1', 'legacy-tool-1'])
    expect(replaced.filter((message) => message.role === 'tool')).toHaveLength(1)
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

describe('computeCanonicalTurnAppend', () => {
  it('skips aborted turns when no stable assistant output remains', () => {
    const { canonicalRowsForAppend, shouldAppendCanonicalFinal } = computeCanonicalTurnAppend({
      turnOutcome: 'aborted',
      canonicalFinalMessages: [
        {
          id: 't1',
          role: 'tool',
          content: '',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(canonicalRowsForAppend).toEqual([])
    expect(shouldAppendCanonicalFinal).toBe(false)
  })

  it('keeps aborted turns when assistant output exists after tool filtering', () => {
    const { canonicalRowsForAppend, shouldAppendCanonicalFinal } = computeCanonicalTurnAppend({
      turnOutcome: 'aborted',
      canonicalFinalMessages: [
        { id: 'a1', role: 'assistant', content: 'answer', timestamp: new Date(0) },
        {
          id: 't1',
          role: 'tool',
          content: '',
          timestamp: new Date(0),
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: {} },
        },
      ],
    })

    expect(canonicalRowsForAppend.map((m) => m.id)).toEqual(['a1'])
    expect(shouldAppendCanonicalFinal).toBe(true)
  })
})

describe('mergeCanonicalTurnIntoMessages', () => {
  it('preserves legacy tool row identity/content while applying canonical tool info', () => {
    const legacyTimestamp = new Date(200)
    const merged = mergeCanonicalTurnIntoMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'run', timestamp: new Date(100) },
        {
          id: 'legacy-tool',
          role: 'tool',
          content: '/repo',
          timestamp: legacyTimestamp,
          toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'running', input: { command: 'pwd' } },
        },
      ],
      userMessageId: 'u1',
      canonicalRowsForAppend: [
        {
          id: 'canonical-tool',
          role: 'tool',
          content: 'canonical',
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
      turnOutcome: 'completed',
      isFailureSubline: () => false,
    })

    expect(merged.map((m) => m.id)).toEqual(['u1', 'legacy-tool'])
    expect(merged[1]?.timestamp).toBe(legacyTimestamp)
    expect(merged[1]?.content).toBe('/repo')
    expect(merged[1]?.toolInfo?.status).toBe('completed')
    expect(merged[1]?.toolInfo?.middleLines).toEqual(['Running PostToolUse hook…'])
  })

  it('inserts failed canonical rows before trailing failure sublines', () => {
    const merged = mergeCanonicalTurnIntoMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        {
          id: 'subline-err',
          role: 'assistant',
          content: 'Error: failed',
          timestamp: new Date(200),
          ui: { kind: 'command_subline' },
        },
      ],
      userMessageId: 'u1',
      canonicalRowsForAppend: [{ id: 'canonical-a', role: 'assistant', content: 'final', timestamp: new Date(0) }],
      turnOutcome: 'failed',
      isFailureSubline: (message) =>
        Boolean(message && message.role === 'assistant' && message.ui?.kind === 'command_subline'),
    })

    expect(merged.map((m) => m.id)).toEqual(['u1', 'canonical-a', 'subline-err'])
  })
})

describe('assertNoDuplicateToolUseIdsInTurn', () => {
  it('throws in non-production env when one turn has duplicate tool_use_id rows', () => {
    expect(() =>
      assertNoDuplicateToolUseIdsInTurn({
        messages: [
          { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
          {
            id: 'tool-1a',
            role: 'tool',
            content: 'running',
            timestamp: new Date(101),
            toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'running', input: { command: 'pwd' } },
          },
          {
            id: 'tool-1b',
            role: 'tool',
            content: 'done',
            timestamp: new Date(102),
            toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'completed', input: { command: 'pwd' } },
          },
        ],
        userIndex: 0,
      }),
    ).toThrow(/duplicate tool rows in one turn/i)
  })
})

describe('appendCanonicalTurnFinalRows', () => {
  it('returns original messages when userMessageId is null', () => {
    const messages: Msg[] = [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) }]
    const next = appendCanonicalTurnFinalRows({
      messages,
      userMessageId: null,
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [],
      isFailureSubline: () => false,
    })
    expect(next).toBe(messages)
  })

  it('skips aborted turns when canonical tail has only tool rows', () => {
    const messages: Msg[] = [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) }]
    const projectionSegments: TranscriptSegment[] = [
      {
        id: 'turn-1:tool:1:tool-1',
        kind: 'tool',
        turnId: 'turn-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'completed',
        summary: 'ok',
        detailLines: [],
      },
    ]

    const next = appendCanonicalTurnFinalRows({
      messages,
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'aborted',
      projectionSegments,
      isFailureSubline: () => false,
    })
    expect(next).toBe(messages)
  })

  it('keeps aborted turns when canonical tail still has assistant output', () => {
    const next = appendCanonicalTurnFinalRows({
      messages: [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) }],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'aborted',
      projectionSegments: [
        { id: 'turn-1:assistant:1', kind: 'assistant', turnId: 'turn-1', text: 'partial answer' },
        {
          id: 'turn-1:tool:2:tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'done',
          detailLines: [],
        },
      ],
      isFailureSubline: () => false,
    })

    expect(next.map((message) => message.id)).toEqual(['u1', 'canonical:turn-1:assistant:1'])
    expect(next[1]).toMatchObject({ role: 'assistant', content: 'partial answer' })
  })

  it('inserts failed canonical assistant rows before trailing failure sublines', () => {
    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        {
          id: 'subline-err',
          role: 'assistant',
          content: 'Error: failed',
          timestamp: new Date(200),
          ui: { kind: 'command_subline' },
        },
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'failed',
      projectionSegments: [{ id: 'turn-1:assistant:1', kind: 'assistant', turnId: 'turn-1', text: 'final answer' }],
      isFailureSubline: (message) =>
        Boolean(message && message.role === 'assistant' && message.ui?.kind === 'command_subline'),
    })

    expect(next.map((m) => m.id)).toEqual(['u1', 'canonical:turn-1:assistant:1', 'subline-err'])
  })

  it('appends canonical command sublines emitted as system_message rows', () => {
    const next = appendCanonicalTurnFinalRows({
      messages: [{ id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) }],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'failed',
      projectionSegments: [
        {
          id: 'turn-1:system:1',
          kind: 'system',
          turnId: 'turn-1',
          role: 'assistant',
          text: 'Error: failed',
          messageKind: 'command_subline',
        },
      ],
      isFailureSubline: (message) =>
        Boolean(message && message.role === 'assistant' && message.ui?.kind === 'command_subline'),
    })

    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({
      role: 'assistant',
      content: 'Error: failed',
      ui: { kind: 'command_subline' },
    })
  })

  it('dedupes canonical command sublines when legacy subline already exists in tail', () => {
    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        {
          id: 'subline-legacy',
          role: 'assistant',
          content: 'Conversation history auto-compacted (summary kept for future turns).',
          timestamp: new Date(200),
          ui: { kind: 'command_subline' },
        },
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'turn-1:system:1',
          kind: 'system',
          turnId: 'turn-1',
          role: 'assistant',
          text: 'Conversation history auto-compacted (summary kept for future turns).',
          messageKind: 'command_subline',
        },
      ],
      isFailureSubline: (message) =>
        Boolean(message && message.role === 'assistant' && message.ui?.kind === 'command_subline'),
    })

    expect(next.map((message) => message.id)).toEqual(['u1', 'subline-legacy'])
  })

  it('preserves legacy tool row identity while applying canonical final tool info', () => {
    const legacyTimestamp = new Date(200)
    const legacyTool: Msg = {
      id: 'legacy-tool',
      role: 'tool',
      content: '/repo',
      timestamp: legacyTimestamp,
      toolInfo: { toolUseId: 'tool-1', name: 'Bash', status: 'running', input: { command: 'pwd' } },
    }
    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        legacyTool,
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'turn-1:tool:1:tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'done',
          detailLines: ['line-1'],
          paramsText: 'command="pwd"',
        },
      ],
      isFailureSubline: () => false,
    })

    expect(next.map((m) => m.id)).toEqual(['u1', 'legacy-tool'])
    expect(next[1]?.timestamp).toBe(legacyTimestamp)
    expect(next[1]?.content).toBe('/repo')
    expect(next[1]?.toolInfo?.status).toBe('completed')
    expect(next[1]?.toolInfo?.middleLines).toEqual(['line-1'])
    expect(next[1]).not.toBe(legacyTool)
  })

  it('keeps completed legacy tool object stable when canonical tool row is equivalent', () => {
    const legacyTimestamp = new Date(200)
    const legacyTool: Msg = {
      id: 'legacy-tool',
      role: 'tool',
      content: '/repo',
      timestamp: legacyTimestamp,
      surfaceOwner: 'static',
      toolInfo: {
        toolUseId: 'tool-1',
        name: 'Bash',
        status: 'completed',
        input: { command: 'pwd' },
        middleLines: ['line-1'],
      },
    }
    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        legacyTool,
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'turn-1:tool:1:tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'done',
          detailLines: ['line-1'],
          paramsText: 'command="pwd"',
        },
      ],
      isFailureSubline: () => false,
    })

    expect(next.map((m) => m.id)).toEqual(['u1', 'legacy-tool'])
    expect(next[1]).toBe(legacyTool)
  })

  it('does not re-append completed legacy tool rows on finalize when canonical includes same tool + assistant', () => {
    const legacyTool: Msg = {
      id: 'legacy-tool',
      role: 'tool',
      content: '/repo',
      timestamp: new Date(200),
      surfaceOwner: 'static',
      toolInfo: {
        toolUseId: 'tool-1',
        name: 'Bash',
        status: 'completed',
        input: { command: 'pwd' },
      },
    }

    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        legacyTool,
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'turn-1:tool:1:tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'done',
          detailLines: [],
          paramsText: 'command=\"pwd\"',
        },
        {
          id: 'turn-1:assistant:2',
          kind: 'assistant',
          turnId: 'turn-1',
          text: '当前工作目录：/repo',
        },
      ],
      isFailureSubline: () => false,
    })

    const toolRows = next.filter((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 'tool-1')
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]).toBe(legacyTool)
    expect(next.some((m) => m.role === 'assistant' && String(m.content).includes('当前工作目录'))).toBe(true)
  })

  it('keeps canonical relative order when reusing completed legacy tool rows', () => {
    const legacyTool: Msg = {
      id: 'legacy-tool',
      role: 'tool',
      content: '/repo',
      timestamp: new Date(200),
      surfaceOwner: 'static',
      toolInfo: {
        toolUseId: 'tool-1',
        name: 'Bash',
        status: 'completed',
        input: { command: 'pwd' },
      },
    }

    const next = appendCanonicalTurnFinalRows({
      messages: [
        { id: 'u1', role: 'user', content: 'ask', timestamp: new Date(100) },
        legacyTool,
      ],
      userMessageId: 'u1',
      turnId: 'turn-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'turn-1:assistant:1',
          kind: 'assistant',
          turnId: 'turn-1',
          text: "I'll execute `pwd`.",
        },
        {
          id: 'turn-1:tool:2:tool-1',
          kind: 'tool',
          turnId: 'turn-1',
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          summary: 'done',
          detailLines: [],
          paramsText: 'command=\"pwd\"',
        },
        {
          id: 'turn-1:assistant:3',
          kind: 'assistant',
          turnId: 'turn-1',
          text: '/repo',
        },
      ],
      isFailureSubline: () => false,
    })

    expect(next.map((m) => m.id)).toEqual(['u1', 'canonical:turn-1:assistant:1', 'legacy-tool', 'canonical:turn-1:assistant:3'])
    expect(next[2]).toBe(legacyTool)
  })
})

describe('appendCanonicalTailFinalRows', () => {
  it('replaces legacy tool rows with canonical final rows at transcript tail', () => {
    const legacyTimestamp = new Date(200)
    const next = appendCanonicalTailFinalRows({
      messages: [
        { id: 'assistant-1', role: 'assistant', content: 'prev', timestamp: new Date(100) },
        {
          id: 'legacy-tool',
          role: 'tool',
          content: '$ pwd',
          timestamp: legacyTimestamp,
          toolInfo: { toolUseId: 'tool-1', name: 'LocalBash', status: 'running', input: { command: 'pwd' } },
        },
      ],
      turnId: 'local-bash-1',
      turnOutcome: 'completed',
      projectionSegments: [
        {
          id: 'local-bash-1:tool:1:tool-1',
          kind: 'tool',
          turnId: 'local-bash-1',
          toolUseId: 'tool-1',
          toolName: 'LocalBash',
          status: 'completed',
          summary: '/repo',
          detailLines: [],
          paramsText: 'command="pwd"',
        },
      ],
    })

    expect(next.map((message) => message.id)).toEqual(['assistant-1', 'legacy-tool'])
    expect(next[1]?.timestamp).toBe(legacyTimestamp)
    expect(next[1]?.toolInfo?.status).toBe('completed')
    expect(next[1]?.content).toBe('$ pwd')
  })

  it('skips append when aborted tail has only tool rows', () => {
    const messages: Msg[] = [{ id: 'assistant-1', role: 'assistant', content: 'prev', timestamp: new Date(100) }]
    const next = appendCanonicalTailFinalRows({
      messages,
      turnId: 'local-bash-2',
      turnOutcome: 'aborted',
      projectionSegments: [
        {
          id: 'local-bash-2:tool:1:tool-2',
          kind: 'tool',
          turnId: 'local-bash-2',
          toolUseId: 'tool-2',
          toolName: 'LocalBash',
          status: 'error',
          summary: 'Error: Request aborted',
          detailLines: [],
        },
      ],
    })

    expect(next).toBe(messages)
  })
})

describe('tailSegmentsForTurn', () => {
  it('returns only the contiguous tail block for the target turn', () => {
    const segments: TranscriptSegment[] = [
      { id: 'turn-1:user:1', kind: 'user', turnId: 'turn-1', text: 'u1' },
      { id: 'turn-1:assistant:2', kind: 'assistant', turnId: 'turn-1', text: 'a1' },
      { id: 'turn-2:user:3', kind: 'user', turnId: 'turn-2', text: 'u2' },
      { id: 'turn-2:assistant:4', kind: 'assistant', turnId: 'turn-2', text: 'a2' },
      { id: 'turn-2:tool:5:t1', kind: 'tool', turnId: 'turn-2', toolUseId: 't1', toolName: 'Bash', status: 'running', summary: '', detailLines: [] },
      { id: 'turn-3:user:6', kind: 'user', turnId: 'turn-3', text: 'u3' },
    ]

    const tail = tailSegmentsForTurn(segments, 'turn-2')
    expect(tail.map((segment) => segment.id)).toEqual(['turn-2:user:3', 'turn-2:assistant:4', 'turn-2:tool:5:t1'])
  })
})
