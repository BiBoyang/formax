import React, { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StreamEvent } from '../../../streaming/types'
import type { Msg } from '../../../components/tool/ToolMessage'
import { useReplStreaming } from './streaming'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('useReplStreaming', () => {
  it('resets thinking timer per thinking segment', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const thinkingStartedAtMsRef = { current: null as number | null }

    let nowMs = 0
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

    function Harness(): React.ReactNode {
      const [messages, setMessages] = useState<Msg[]>([])
      const [thinkingText, setThinkingText] = useState('')
      const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
      const [loadingText, setLoadingText] = useState('')
      const [ctx, setContext] = useState<any>(null)
      const [err, setError] = useState<string | null>(null)

      useEffect(() => {
        thinkingStartedAtMsRef.current = thinkingStartedAtMs
      }, [thinkingStartedAtMs])

      const assistantBufferRef = useRef('')
      const thinkingBufferRef = useRef('')
      const currentAssistantIdRef = useRef<string | null>(null)
      const currentThinkingMessageIdRef = useRef<string | null>(null)
      const thinkingLastFlushAtRef = useRef(0)
      const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({
        startedAtMs: null,
      })
      const toolNameByIdRef = useRef(new Map<string, string>())
      const toolInputByIdRef = useRef(new Map<string, unknown>())
      const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
      const taskKindByToolUseIdRef = useRef(new Map<string, any>())
      const exploreBatchRef = useRef<any>(null)
      const reminderServiceRef = useRef<any>(null)
      const contextBudgetConfigRef = useRef<any>(null)

      const { handleEvent } = useReplStreaming({
        assistantTextMode: 'buffered',
        setMessages,
        setThinkingText,
        setThinkingStartedAtMs,
        setLoadingText,
        setContext,
        setError,
        currentAssistantIdRef,
        assistantBufferRef,
        thinkingBufferRef,
        currentThinkingMessageIdRef,
        thinkingLastFlushAtRef,
        thinkingTimingRef,
        toolNameByIdRef,
        toolInputByIdRef,
        taskStatsByToolUseIdRef,
        taskKindByToolUseIdRef,
        exploreBatchRef,
        reminderServiceRef,
        contextBudgetConfigRef,
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      return null
    }

    render(<Harness />)
    await tick()
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    nowMs = 1000
    handleEvent!({ type: 'thinking_delta', thinking: 'a' })
    await tick()
    await tick()
    expect(thinkingStartedAtMsRef.current).toBe(1000)

    nowMs = 2000
    handleEvent!({ type: 'thinking_delta', thinking: 'b' })
    await tick()
    await tick()
    expect(thinkingStartedAtMsRef.current).toBe(1000)

    nowMs = 2500
    handleEvent!({ type: 'thinking_stop' })
    await tick()
    await tick()
    expect(thinkingStartedAtMsRef.current).toBe(null)

    nowMs = 9000
    handleEvent!({ type: 'thinking_delta', thinking: 'c' })
    await tick()
    await tick()
    expect(thinkingStartedAtMsRef.current).toBe(9000)

    nowMs = 9500
    handleEvent!({ type: 'thinking_stop' })
    await tick()
    await tick()
    expect(thinkingStartedAtMsRef.current).toBe(null)

    dateNowSpy.mockRestore()
  })

  it('sets loadingText to a stable tool label while tool input is still streaming', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const loadingTextRef = { current: '' as string }

    function Harness(): React.ReactNode {
      const [messages, setMessages] = useState<Msg[]>([])
      const [thinkingText, setThinkingText] = useState('')
      const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
      const [loadingText, setLoadingText] = useState('')
      const [ctx, setContext] = useState<any>(null)
      const [err, setError] = useState<string | null>(null)

      useEffect(() => {
        loadingTextRef.current = loadingText
      }, [loadingText])

      const assistantBufferRef = useRef('')
      const thinkingBufferRef = useRef('')
      const currentAssistantIdRef = useRef<string | null>(null)
      const currentThinkingMessageIdRef = useRef<string | null>(null)
      const thinkingLastFlushAtRef = useRef(0)
      const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({
        startedAtMs: null,
      })
      const toolNameByIdRef = useRef(new Map<string, string>())
      const toolInputByIdRef = useRef(new Map<string, unknown>())
      const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
      const taskKindByToolUseIdRef = useRef(new Map<string, any>())
      const exploreBatchRef = useRef<any>(null)
      const reminderServiceRef = useRef<any>(null)
      const contextBudgetConfigRef = useRef<any>(null)

      const { handleEvent } = useReplStreaming({
        assistantTextMode: 'buffered',
        setMessages,
        setThinkingText,
        setThinkingStartedAtMs,
        setLoadingText,
        setContext,
        setError,
        currentAssistantIdRef,
        assistantBufferRef,
        thinkingBufferRef,
        currentThinkingMessageIdRef,
        thinkingLastFlushAtRef,
        thinkingTimingRef,
        toolNameByIdRef,
        toolInputByIdRef,
        taskStatsByToolUseIdRef,
        taskKindByToolUseIdRef,
        exploreBatchRef,
        reminderServiceRef,
        contextBudgetConfigRef,
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      // Keep eslint/ts from complaining about unused state setters in the harness.
      void messages
      void thinkingText
      void thinkingStartedAtMs
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 't1', name: 'Write' })
    await tick()
    await tick()
    expect(loadingTextRef.current).toBe('Preparing write')

    handleEvent!({ type: 'tool_input', id: 't1', input: { file_path: '/tmp/minesweeper/style.css' } })
    await tick()
    await tick()
    expect(loadingTextRef.current).toBe('Writing style.css')

    handleEvent!({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'OK' } })
    await tick()
    await tick()
    expect(loadingTextRef.current).toBe('Working')
  })

  it('preserves tool input on tool_end (used by Edit presenter + patchStartLineNumber)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-stream-'))
    try {
      const filePath = path.join(tmpDir, 'demo.txt')
      const prefix = Array.from({ length: 21 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
      await fsp.writeFile(filePath, prefix + 'hello world\n', 'utf8')

      const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
      const messagesRef = { current: [] as Msg[] }

      function Harness(): React.ReactNode {
        const [messages, setMessages] = useState<Msg[]>([])
        const [thinkingText, setThinkingText] = useState('')
        const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
        const [loadingText, setLoadingText] = useState('')
        const [ctx, setContext] = useState<any>(null)
        const [err, setError] = useState<string | null>(null)

        useEffect(() => {
          messagesRef.current = messages
        }, [messages])

        const assistantBufferRef = useRef('')
        const thinkingBufferRef = useRef('')
        const currentAssistantIdRef = useRef<string | null>(null)
        const currentThinkingMessageIdRef = useRef<string | null>(null)
        const thinkingLastFlushAtRef = useRef(0)
        const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({
          startedAtMs: null,
        })
        const toolNameByIdRef = useRef(new Map<string, string>())
        const toolInputByIdRef = useRef(new Map<string, unknown>())
        const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
        const taskKindByToolUseIdRef = useRef(new Map<string, any>())
        const exploreBatchRef = useRef<any>(null)
        const reminderServiceRef = useRef<any>(null)
        const contextBudgetConfigRef = useRef<any>(null)

        const { handleEvent } = useReplStreaming({
          assistantTextMode: 'buffered',
          setMessages,
          setThinkingText,
          setThinkingStartedAtMs,
          setLoadingText,
          setContext,
          setError,
          currentAssistantIdRef,
          assistantBufferRef,
          thinkingBufferRef,
          currentThinkingMessageIdRef,
          thinkingLastFlushAtRef,
          thinkingTimingRef,
          toolNameByIdRef,
          toolInputByIdRef,
          taskStatsByToolUseIdRef,
          taskKindByToolUseIdRef,
          exploreBatchRef,
          reminderServiceRef,
          contextBudgetConfigRef,
        })

        useEffect(() => {
          handleEventRef.current = handleEvent
        }, [handleEvent])

        return null
      }

      render(<Harness />)
      await tick()

      const handleEvent = handleEventRef.current
      expect(handleEvent).not.toBeNull()

      handleEvent!({ type: 'tool_start', id: 't1', name: 'Edit' })
      await tick()
      handleEvent!({
        type: 'tool_input',
        id: 't1',
        input: {
          file_path: filePath,
          old_string: 'hello world\n',
          new_string: '   22  hello world\n',
        },
      })
      await tick()
      handleEvent!({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'OK' } })
      await tick()
      await tick()

      const toolMsg = messagesRef.current.find((m) => m.id === 'tool-t1')
      expect(toolMsg?.toolInfo?.input).toMatchObject({ file_path: filePath })
      expect(toolMsg?.toolInfo?.patchStartLineNumber).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
