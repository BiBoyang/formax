import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { createLegacyTranscriptMutator } from './streamingLegacyTranscript'
import {
  writeLegacyAssistantDeltaFallback,
  writeLegacyExploreSummaryFallback,
  writeLegacyToolEndFallback,
  writeLegacyThinkingStartFallback,
  writeLegacyThinkingUpdateFallback,
  writeLegacyToolInputFallback,
  writeLegacyToolStartFallback,
  writeLegacyToolUpdateFallback,
} from './streamingLegacyCompat'

function createHarness() {
  let messages: Msg[] = []
  const setMessages = vi.fn((next: any) => {
    messages = typeof next === 'function' ? next(messages) : next
  })
  const legacyTranscript = createLegacyTranscriptMutator({
    canWriteLegacyTranscript: true,
    setMessages,
  })
  return {
    getMessages: () => messages,
    legacyTranscript,
  }
}

function createReadOnlyHarness() {
  let messages: Msg[] = []
  const setMessages = vi.fn((next: any) => {
    messages = typeof next === 'function' ? next(messages) : next
  })
  const legacyTranscript = createLegacyTranscriptMutator({
    canWriteLegacyTranscript: false,
    setMessages,
  })
  return {
    getMessages: () => messages,
    legacyTranscript,
    setMessages,
  }
}

describe('streamingLegacyCompat', () => {
  it('writes assistant streaming deltas through compat helper', () => {
    const { legacyTranscript, getMessages } = createHarness()

    const assistantId = writeLegacyAssistantDeltaFallback({
      legacyTranscript,
      assistantId: null,
      text: 'hello',
      createAssistantId: () => 'assistant-1',
    })
    const sameAssistantId = writeLegacyAssistantDeltaFallback({
      legacyTranscript,
      assistantId,
      text: ' world',
      createAssistantId: () => 'assistant-2',
    })

    expect(assistantId).toBe('assistant-1')
    expect(sameAssistantId).toBe('assistant-1')
    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]?.role).toBe('assistant')
    expect(getMessages()[0]?.isStreaming).toBe(true)
    expect(getMessages()[0]?.content).toBe('hello world')
  })

  it('writes thinking block rows through compat helpers', () => {
    const { legacyTranscript, getMessages } = createHarness()

    writeLegacyThinkingStartFallback({
      legacyTranscript,
      thinkingId: 'thinking-1',
      text: 'step-1',
    })
    writeLegacyThinkingUpdateFallback({
      legacyTranscript,
      thinkingId: 'thinking-1',
      text: 'step-1 step-2',
    })

    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]?.role).toBe('assistant')
    expect(getMessages()[0]?.ui?.kind).toBe('thinking_block')
    expect(getMessages()[0]?.content).toBe('step-1 step-2')
  })

  it('does not write compat rows when legacy transcript is read-only', () => {
    const { legacyTranscript, getMessages } = createReadOnlyHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()

    const assistantId = writeLegacyAssistantDeltaFallback({
      legacyTranscript,
      assistantId: null,
      text: 'hello',
      createAssistantId: () => 'assistant-1',
    })
    writeLegacyThinkingStartFallback({ legacyTranscript, thinkingId: 'thinking-1', text: 'start' })
    writeLegacyThinkingUpdateFallback({ legacyTranscript, thinkingId: 'thinking-1', text: 'update' })
    writeLegacyExploreSummaryFallback({
      legacyTranscript,
      count: 2,
      createAssistantId: () => 'assistant-summary',
    })
    writeLegacyToolStartFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolMessageIdByToolUseId,
      createToolMessageId: () => 'tool-msg-1',
    })
    writeLegacyToolInputFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      input: { command: 'pwd' },
      toolMessageIdByToolUseId,
    })
    writeLegacyToolUpdateFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      event: { type: 'tool_update', id: 'tool-1', middleLines: ['line'] },
      toolMessageIdByToolUseId,
    })
    writeLegacyToolEndFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolMsgId: 'tool-msg-1',
      toolNameFromStart: 'Bash',
      toolInputFromStart: { command: 'pwd' },
      result: { tool_use_id: 'tool-1', content: '/tmp' },
      taskStats: undefined,
      workingCwd: process.cwd(),
      resolveEditPatchStartLineNumber: () => null,
    })

    expect(assistantId).toBeNull()
    expect(getMessages()).toEqual([])
  })

  it('writes and finalizes tool rows through compat helpers', () => {
    const { legacyTranscript, getMessages } = createHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()

    writeLegacyToolStartFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolMessageIdByToolUseId,
      createToolMessageId: () => 'tool-msg-1',
    })
    writeLegacyToolInputFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      input: { command: 'pwd' },
      toolMessageIdByToolUseId,
    })
    writeLegacyToolUpdateFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      event: { type: 'tool_update', id: 'tool-1', middleLines: ['line'] },
      toolMessageIdByToolUseId,
    })
    writeLegacyToolEndFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolMsgId: 'tool-msg-1',
      toolNameFromStart: 'Bash',
      toolInputFromStart: { command: 'pwd' },
      result: {
        tool_use_id: 'tool-1',
        content: '/tmp',
      },
      taskStats: undefined,
      workingCwd: process.cwd(),
      resolveEditPatchStartLineNumber: () => null,
    })

    const messages = getMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('tool')
    expect(messages[0]?.toolInfo?.toolUseId).toBe('tool-1')
    expect(messages[0]?.toolInfo?.status).toBe('completed')
    expect(messages[0]?.toolInfo?.input).toEqual({ command: 'pwd' })
    expect(messages[0]?.toolInfo?.result).toBe('/tmp')
  })

  it('uses fallback tool message id for input/update and skips update when not applicable', () => {
    const { legacyTranscript, getMessages } = createHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()

    writeLegacyToolInputFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      input: { command: 'pwd' },
      toolMessageIdByToolUseId,
    })
    writeLegacyToolUpdateFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      event: { type: 'tool_update', id: 'tool-1' },
      toolMessageIdByToolUseId,
    })

    expect(getMessages()).toHaveLength(0)
  })

  it('uses fallback ids and preserves unrelated rows when ending unknown tool rows', () => {
    const { legacyTranscript, getMessages } = createHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()
    const createAssistantId = () => 'assistant-1'

    writeLegacyAssistantDeltaFallback({
      legacyTranscript,
      assistantId: null,
      text: 'hello',
      createAssistantId,
    })
    writeLegacyToolUpdateFallback({
      legacyTranscript,
      toolUseId: 'tool-unknown',
      toolName: 'Task',
      event: { type: 'tool_update', id: 'tool-unknown', usage: { input_tokens: 1 } },
      toolMessageIdByToolUseId,
    })

    const resolveEditPatchStartLineNumber = vi.fn(() => null)
    writeLegacyToolEndFallback({
      legacyTranscript,
      toolUseId: 'tool-unknown',
      toolMsgId: 'tool-unknown-msg',
      toolNameFromStart: undefined,
      toolInputFromStart: undefined,
      result: { tool_use_id: 'tool-unknown', content: 'ok' },
      taskStats: undefined,
      workingCwd: '/tmp/project',
      resolveEditPatchStartLineNumber,
    })

    expect(resolveEditPatchStartLineNumber).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      toolName: undefined,
      isError: false,
      toolInput: null,
    })
    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]?.role).toBe('assistant')
    expect(getMessages()[0]?.content).toBe('hello')
  })

  it('writes explore batch summary row through compat helper', () => {
    const { legacyTranscript, getMessages } = createHarness()

    writeLegacyExploreSummaryFallback({
      legacyTranscript,
      count: 2,
      createAssistantId: () => 'assistant-summary',
    })

    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]?.id).toBe('assistant-summary')
    expect(getMessages()[0]?.role).toBe('assistant')
    expect(getMessages()[0]?.content).toBe('2 Explore agents finished (ctrl+o to expand)')
  })

  it('does not duplicate tool rows when tool_start repeats for same toolUseId', () => {
    const { legacyTranscript, getMessages } = createHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()

    writeLegacyToolStartFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolMessageIdByToolUseId,
      createToolMessageId: () => 'tool-msg-1',
    })
    writeLegacyToolStartFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Bash',
      toolMessageIdByToolUseId,
      createToolMessageId: () => 'tool-msg-ignored',
    })

    expect(getMessages()).toHaveLength(1)
    expect(getMessages()[0]?.id).toBe('tool-msg-1')
  })

  it('merges completion info using message fallback fields when start context is missing', () => {
    const { legacyTranscript, getMessages } = createHarness()
    const toolMessageIdByToolUseId = new Map<string, string>()

    writeLegacyToolStartFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolName: 'Edit',
      toolMessageIdByToolUseId,
      createToolMessageId: () => 'tool-msg-1',
    })
    writeLegacyToolInputFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      input: { file_path: 'README.md', old_string: 'a', new_string: 'b' },
      toolMessageIdByToolUseId,
    })

    const resolveEditPatchStartLineNumber = vi.fn(() => 12)
    writeLegacyToolEndFallback({
      legacyTranscript,
      toolUseId: 'tool-1',
      toolMsgId: 'tool-msg-1',
      toolNameFromStart: undefined,
      toolInputFromStart: undefined,
      result: { tool_use_id: 'tool-1', content: 'ok' },
      taskStats: undefined,
      workingCwd: '/tmp/project',
      resolveEditPatchStartLineNumber,
    })

    const finalMessage = getMessages()[0]
    expect(resolveEditPatchStartLineNumber).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      toolName: 'Edit',
      isError: false,
      toolInput: { file_path: 'README.md', old_string: 'a', new_string: 'b' },
    })
    expect(finalMessage?.toolInfo?.patchStartLineNumber).toBe(12)
    expect(finalMessage?.toolInfo?.status).toBe('completed')
  })
})
