import { describe, expect, it, vi } from 'vitest'
import type { Msg } from '../../../../components/tool/ToolMessage'
import { createLegacyTranscriptMutator } from './streamingLegacyTranscript'
import {
  writeLegacyToolEndFallback,
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

describe('streamingLegacyCompat', () => {
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
})
