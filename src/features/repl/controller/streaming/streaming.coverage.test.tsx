import React, { useEffect, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import type { StreamEvent } from '../../../../streaming/types'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useReplStreaming } from './streaming'
import * as streamingTaskState from './streamingTaskState'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

type HarnessOptions = {
  assistantTextMode: 'buffered' | 'stream'
  contextBudgetConfig?: any
  reminderService?: { recordToolResult: (args: { toolName: string; ok: boolean }) => void } | null
  canonical?: {
    threadId: string
    getTurnId: () => string | null
    nextReplaySeq: () => number
    onEvent: (event: any) => void
  }
}

async function setupHarness(options: HarnessOptions) {
  const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
  const messagesRef = { current: [] as Msg[] }
  const thinkingTextRef = { current: '' }
  const contextRef = { current: null as any }
  const errorRef = { current: null as string | null }

  function Harness(): React.ReactNode {
    const [messages, setMessages] = useState<Msg[]>([])
    const [thinkingText, setThinkingText] = useState('')
    const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
    const [loadingText, setLoadingText] = useState('')
    const [context, setContext] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      messagesRef.current = messages
    }, [messages])
    useEffect(() => {
      thinkingTextRef.current = thinkingText
    }, [thinkingText])
    useEffect(() => {
      contextRef.current = context
    }, [context])
    useEffect(() => {
      errorRef.current = error
    }, [error])

    const currentAssistantIdRef = useRef<string | null>(null)
    const assistantBufferRef = useRef('')
    const thinkingBufferRef = useRef('')
    const currentThinkingMessageIdRef = useRef<string | null>(null)
    const thinkingLastFlushAtRef = useRef(0)
    const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({ startedAtMs: null })
    const toolNameByIdRef = useRef(new Map<string, string>())
    const toolInputByIdRef = useRef(new Map<string, unknown>())
    const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
    const taskKindByToolUseIdRef = useRef(new Map<string, any>())
    const exploreBatchRef = useRef<any>(null)
    const reminderServiceRef = useRef<any>(options.reminderService ?? null)
    const contextBudgetConfigRef = useRef<any>(options.contextBudgetConfig ?? null)

    const { handleEvent } = useReplStreaming({
      assistantTextMode: options.assistantTextMode,
      setMessages,
      setThinkingText,
      setThinkingStartedAtMs,
      setLoadingText,
      setContext,
      setError,
      turnStreamingRefs: {
        currentAssistantIdRef,
        assistantBufferRef,
        thinkingRefs: {
          bufferRef: thinkingBufferRef,
          messageIdRef: currentThinkingMessageIdRef,
          lastFlushAtRef: thinkingLastFlushAtRef,
          timingRef: thinkingTimingRef,
        },
      },
      toolRuntimeRefs: {
        nameByIdRef: toolNameByIdRef,
        inputByIdRef: toolInputByIdRef,
        statsByToolUseIdRef: taskStatsByToolUseIdRef,
        kindByToolUseIdRef: taskKindByToolUseIdRef,
        exploreBatchRef,
      },
      turnFlowRefs: {
        reminderServiceRef,
        contextBudgetConfigRef,
      },
      canonical: options.canonical,
    })

    useEffect(() => {
      handleEventRef.current = handleEvent
    }, [handleEvent])

    void thinkingStartedAtMs
    void loadingText

    return null
  }

  render(<Harness />)
  await tick()
  await tick()

  return {
    emit: (ev: StreamEvent | any) => {
      if (!handleEventRef.current) throw new Error('handleEvent not ready')
      handleEventRef.current(ev)
    },
    messagesRef,
    thinkingTextRef,
    contextRef,
    errorRef,
  }
}

describe('useReplStreaming coverage branches', () => {
  it('covers buffered fallback paths (usage/error/complete/default/explore summary/reminder fallback)', async () => {
    const finalizeExploreSpy = vi
      .spyOn(streamingTaskState, 'finalizeExploreBatchOnTaskEnd')
      .mockReturnValue({ nextBatch: null, summaryCount: 2 })
    const reminderSpy = vi.fn()
    const harness = await setupHarness({
      assistantTextMode: 'buffered',
      contextBudgetConfig: {
        contextWindowTokens: 100_000,
        effectiveContextWindowPercent: 0.9,
        autoCompactLimitPercent: 0.85,
        baselineTokens: 1000,
      },
      reminderService: { recordToolResult: reminderSpy },
    })

    harness.emit({ type: 'assistant_delta', text: 'buffered-a' })
    harness.emit({ type: 'usage', usage: { input_tokens: 123, output_tokens: 10 } })
    await tick()
    await tick()
    expect(harness.contextRef.current?.source).toBe('usage')

    harness.emit({ type: 'tool_end', id: 'task-1', result: { tool_use_id: 'task-1', content: 'ok' } })
    await tick()
    await tick()
    expect(harness.messagesRef.current.some((m) => String(m.content).includes('2 Explore agents finished'))).toBe(true)

    harness.emit({ type: 'error', error: new Error('stream boom') })
    await tick()
    await tick()
    expect(harness.errorRef.current).toBe('stream boom')

    harness.emit({ type: 'assistant_delta', text: 'buffered-b' })
    harness.emit({ type: 'complete' })
    for (let i = 0; i < 10; i++) {
      await tick()
      if (harness.messagesRef.current.some((m) => String(m.content).includes('buffered-b'))) break
    }
    expect(harness.messagesRef.current.some((m) => String(m.content).includes('buffered-b'))).toBe(true)

    harness.emit({ type: 'tool_end', id: 'missing-tool', result: { tool_use_id: 'missing-tool', content: 'ok' } })
    await tick()
    expect(reminderSpy).toHaveBeenCalledWith({ toolName: 'Tool', ok: true })

    harness.emit({ type: 'not-a-real-event' } as any)
    finalizeExploreSpy.mockRestore()
  })

  it('covers canonical thinking bridge throttling and Edit tool_end mapping without tool_input', async () => {
    const canonicalEvents: any[] = []
    let replaySeq = 0
    let nowMs = 1000
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    const harness = await setupHarness({
      assistantTextMode: 'buffered',
      canonical: {
        threadId: 'tui-live',
        getTurnId: () => 'turn-coverage',
        nextReplaySeq: () => {
          replaySeq += 1
          return replaySeq
        },
        onEvent: (event) => canonicalEvents.push(event),
      },
    })

    try {
      harness.emit({ type: 'thinking_delta', thinking: 'a' })
      await tick()
      await tick()
      expect(harness.thinkingTextRef.current).toBe('a')

      nowMs = 1050
      harness.emit({ type: 'thinking_delta', thinking: 'b' })
      await tick()
      await tick()
      expect(harness.thinkingTextRef.current).toBe('a')

      nowMs = 1301
      harness.emit({ type: 'thinking_delta', thinking: 'c' })
      await tick()
      await tick()
      expect(harness.thinkingTextRef.current).toBe('abc')

      harness.emit({ type: 'assistant_delta', text: 'ignored in canonical-only mode' })
      await tick()
      expect(harness.messagesRef.current).toEqual([])

      harness.emit({ type: 'tool_start', id: 'edit-1', name: 'Edit' })
      harness.emit({ type: 'tool_end', id: 'edit-1', result: { tool_use_id: 'edit-1', content: 'ok' } })
      await tick()
      expect(canonicalEvents.some((event) => event.kind === 'tool_event')).toBe(true)
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('ignores usage events when context budget config is not set', async () => {
    const harness = await setupHarness({
      assistantTextMode: 'buffered',
    })

    harness.emit({ type: 'usage', usage: { input_tokens: 50, output_tokens: 1 } })
    await tick()
    await tick()
    expect(harness.contextRef.current).toBeNull()
  })

  it('throttles non-canonical thinking updates when flush interval is not reached', async () => {
    let nowMs = 1000
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
    const harness = await setupHarness({
      assistantTextMode: 'buffered',
    })

    try {
      harness.emit({ type: 'thinking_delta', thinking: 'a' })
      await tick()
      await tick()
      expect(harness.thinkingTextRef.current).toBe('a')

      nowMs = 1100
      harness.emit({ type: 'thinking_delta', thinking: 'b' })
      await tick()
      await tick()
      expect(harness.thinkingTextRef.current).toBe('a')
    } finally {
      dateNowSpy.mockRestore()
    }
  })
})
