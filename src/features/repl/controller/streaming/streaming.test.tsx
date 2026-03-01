import React, { useEffect, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { StreamEvent } from '../../../../streaming/types'
import type { Msg } from '../../../../shared/toolMessageTypes'
import { useReplStreaming } from './streaming'
import {
  createInitialTranscriptProjectionState,
  reduceTranscriptProjection,
} from '../../../semantics/projection/transcriptProjection'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForCondition(check: () => boolean, description = 'condition', timeoutMs = 10000): Promise<void> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (check()) return
    await tick()
  }
  throw new Error(`Timed out waiting for ${description}`)
}

describe('useReplStreaming', () => {
  it('resets thinking timer per thinking segment', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const thinkingStartedAtMsRef = { current: null as number | null }
    const thinkingTextRef = { current: '' as string }

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
      useEffect(() => {
        thinkingTextRef.current = thinkingText
      }, [thinkingText])

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

    try {
      const handleEvent = handleEventRef.current
      expect(handleEvent).not.toBeNull()

      nowMs = 1000
      handleEvent!({ type: 'thinking_delta', thinking: 'a' })
      await waitForCondition(() => thinkingStartedAtMsRef.current === 1000, 'thinking timer start at first delta')
      expect(thinkingStartedAtMsRef.current).toBe(1000)

      nowMs = 2000
      handleEvent!({ type: 'thinking_delta', thinking: 'b' })
      await waitForCondition(() => thinkingTextRef.current === 'ab', 'thinking text flush after second delta')
      expect(thinkingStartedAtMsRef.current).toBe(1000)

      nowMs = 2500
      handleEvent!({ type: 'thinking_stop' })
      await waitForCondition(() => thinkingStartedAtMsRef.current === null, 'thinking timer cleared on stop')
      expect(thinkingStartedAtMsRef.current).toBe(null)

      nowMs = 9000
      handleEvent!({ type: 'thinking_delta', thinking: 'c' })
      await waitForCondition(() => thinkingStartedAtMsRef.current === 9000, 'thinking timer start at new segment')
      expect(thinkingStartedAtMsRef.current).toBe(9000)

      nowMs = 9500
      handleEvent!({ type: 'thinking_stop' })
      await waitForCondition(() => thinkingStartedAtMsRef.current === null, 'thinking timer cleared on second stop')
      expect(thinkingStartedAtMsRef.current).toBe(null)
    } finally {
      dateNowSpy.mockRestore()
    }
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
    await waitForCondition(() => loadingTextRef.current === 'Preparing write', 'loading text after tool_start')
    expect(loadingTextRef.current).toBe('Preparing write')

    handleEvent!({ type: 'tool_input', id: 't1', input: { file_path: '/tmp/minesweeper/style.css' } })
    await waitForCondition(() => loadingTextRef.current === 'Writing style.css', 'loading text after tool_input')
    expect(loadingTextRef.current).toBe('Writing style.css')

    handleEvent!({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'OK' } })
    await waitForCondition(() => loadingTextRef.current === 'Working', 'loading text after tool_end')
    expect(loadingTextRef.current).toBe('Working')
  })

  it('finalizes an active assistant stream when a tool ends', async () => {
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
        assistantTextMode: 'stream',
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

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 't1', name: 'Skill' })
    handleEvent!({ type: 'assistant_delta', text: 'Working on it' })

    await waitForCondition(
      () => messagesRef.current.some((m) => m.role === 'assistant' && m.isStreaming === true),
      'assistant streaming after delta',
    )

    handleEvent!({ type: 'tool_end', id: 't1', result: { tool_use_id: 't1', content: 'ok' } })

    await waitForCondition(
      () =>
        messagesRef.current.some(
          (m) => m.role === 'assistant' && String(m.content).includes('Working on it') && m.isStreaming === false,
        ),
      'assistant stream finalized on tool_end',
    )
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

      let toolMsg = messagesRef.current.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')
      for (let i = 0; i < 40 && toolMsg?.toolInfo?.status !== 'completed'; i++) {
        await tick()
        toolMsg = messagesRef.current.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 't1')
      }

      expect(toolMsg?.toolInfo?.status).toBe('completed')
      expect(toolMsg?.toolInfo?.input).toMatchObject({ file_path: filePath })
      expect(toolMsg?.toolInfo?.patchStartLineNumber).toBe(22)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('preserves Task nestedTools from tool_update when tool_end finalizes', async () => {
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

    handleEvent!({ type: 'tool_start', id: 'task-1', name: 'Task' })
    handleEvent!({
      type: 'tool_update',
      id: 'task-1',
      nestedTools: [{ id: 'nested-1', name: 'Bash', input: { command: 'pwd' }, status: 'completed' }],
    })
    handleEvent!({ type: 'tool_end', id: 'task-1', result: { tool_use_id: 'task-1', content: 'ok' } })
    await tick()
    await tick()

    const toolMsg = messagesRef.current.find((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 'task-1')
    expect(toolMsg?.toolInfo?.status).toBe('completed')
    expect(toolMsg?.toolInfo?.nestedTools?.[0]?.name).toBe('Bash')
  })

  it('does not append duplicate tool rows when tool_start repeats for the same id', async () => {
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

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 'dup-1', name: 'Bash' })
    handleEvent!({ type: 'tool_start', id: 'dup-1', name: 'Bash' })
    handleEvent!({ type: 'tool_end', id: 'dup-1', result: { tool_use_id: 'dup-1', content: 'ok' } })
    await tick()
    await tick()

    const toolRows = messagesRef.current.filter((m) => m.role === 'tool' && m.toolInfo?.toolUseId === 'dup-1')
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]?.toolInfo?.status).toBe('completed')
  })

  it('does not append Explore batch summary rows when canonical bridge is enabled', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const messagesRef = { current: [] as Msg[] }
    const exploreBatchSnapshotRef = { current: null as any }
    const projectionRef = { current: createInitialTranscriptProjectionState({ threadId: 'tui-live' }) }

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
      const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({ startedAtMs: null })
      const toolNameByIdRef = useRef(new Map<string, string>())
      const toolInputByIdRef = useRef(new Map<string, unknown>())
      const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
      const taskKindByToolUseIdRef = useRef(new Map<string, any>())
      const exploreBatchRef = useRef<any>(null)
      const reminderServiceRef = useRef<any>(null)
      const contextBudgetConfigRef = useRef<any>(null)
      const replaySeqRef = useRef(0)

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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => 'turn-canonical-explore',
          nextReplaySeq: () => {
            replaySeqRef.current += 1
            return replaySeqRef.current
          },
          onEvent: (event) => {
            projectionRef.current = reduceTranscriptProjection(projectionRef.current, event)
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])
      useEffect(() => {
        exploreBatchSnapshotRef.current = exploreBatchRef.current
      }, [messages])

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 'task-1', name: 'Task' })
    handleEvent!({ type: 'tool_input', id: 'task-1', input: { subagent_type: 'Explore' } })
    handleEvent!({ type: 'tool_start', id: 'task-2', name: 'Task' })
    handleEvent!({ type: 'tool_input', id: 'task-2', input: { subagent_type: 'Explore' } })
    handleEvent!({ type: 'tool_end', id: 'task-1', result: { tool_use_id: 'task-1', content: 'ok' } })
    handleEvent!({ type: 'tool_end', id: 'task-2', result: { tool_use_id: 'task-2', content: 'ok' } })
    await tick()
    await tick()

    expect(messagesRef.current).toEqual([])
    expect(exploreBatchSnapshotRef.current).toBeNull()
  })

  it('writes legacy transcript rows when canonical bridge is not configured (fallback path)', async () => {
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
      const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({ startedAtMs: null })
      const toolNameByIdRef = useRef(new Map<string, string>())
      const toolInputByIdRef = useRef(new Map<string, unknown>())
      const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
      const taskKindByToolUseIdRef = useRef(new Map<string, any>())
      const exploreBatchRef = useRef<any>(null)
      const reminderServiceRef = useRef<any>(null)
      const contextBudgetConfigRef = useRef<any>(null)

      const { handleEvent } = useReplStreaming({
        assistantTextMode: 'stream',
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

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'thinking_delta', thinking: 'analysis' })
    handleEvent!({ type: 'thinking_stop' })
    handleEvent!({ type: 'assistant_delta', text: 'done' })
    handleEvent!({ type: 'tool_start', id: 'legacy-tool', name: 'Bash' })
    handleEvent!({ type: 'tool_input', id: 'legacy-tool', input: { command: 'pwd' } })
    handleEvent!({ type: 'tool_end', id: 'legacy-tool', result: { tool_use_id: 'legacy-tool', content: 'ok' } })
    handleEvent!({ type: 'complete' })
    await waitForCondition(
      () =>
        messagesRef.current.some((message) => message.ui?.kind === 'thinking_block') &&
        messagesRef.current.some((message) => message.role === 'assistant' && String(message.content).includes('done')) &&
        messagesRef.current.some(
          (message) =>
            message.role === 'tool' &&
            message.toolInfo?.toolUseId === 'legacy-tool' &&
            message.toolInfo?.status === 'completed',
        ),
      'legacy fallback transcript rows',
    )

    expect(messagesRef.current.some((message) => message.ui?.kind === 'thinking_block')).toBe(true)
    expect(messagesRef.current.some((message) => message.role === 'assistant' && String(message.content).includes('done'))).toBe(true)
    expect(
      messagesRef.current.some(
        (message) =>
          message.role === 'tool' &&
          message.toolInfo?.toolUseId === 'legacy-tool' &&
          message.toolInfo?.status === 'completed',
      ),
    ).toBe(true)
  })

  it('does not write legacy transcript rows when canonical bridge is configured without active turn', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const messagesRef = { current: [] as Msg[] }
    const canonicalKindsRef = { current: [] as string[] }

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
      const thinkingTimingRef = useRef<{ startedAtMs: number | null }>({ startedAtMs: null })
      const toolNameByIdRef = useRef(new Map<string, string>())
      const toolInputByIdRef = useRef(new Map<string, unknown>())
      const taskStatsByToolUseIdRef = useRef(new Map<string, any>())
      const taskKindByToolUseIdRef = useRef(new Map<string, any>())
      const exploreBatchRef = useRef<any>(null)
      const reminderServiceRef = useRef<any>(null)
      const contextBudgetConfigRef = useRef<any>(null)

      const { handleEvent } = useReplStreaming({
        assistantTextMode: 'stream',
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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => null,
          nextReplaySeq: () => 1,
          onEvent: (event) => {
            canonicalKindsRef.current = [...canonicalKindsRef.current, event.kind]
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'assistant_delta', text: 'hello' })
    handleEvent!({ type: 'tool_start', id: 'tool-1', name: 'Bash' })
    handleEvent!({ type: 'tool_end', id: 'tool-1', result: { tool_use_id: 'tool-1', content: 'ok' } })
    handleEvent!({ type: 'complete' })
    await tick()

    expect(messagesRef.current).toEqual([])
    expect(canonicalKindsRef.current).toEqual([])
  })

  it('forwards stream events into canonical projection when canonical bridge is enabled', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const canonicalKindsRef = { current: [] as string[] }
    const projectionRef = { current: createInitialTranscriptProjectionState({ threadId: 'tui-live' }) }
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
      const replaySeqRef = useRef(0)

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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => 'turn-canonical',
          nextReplaySeq: () => {
            replaySeqRef.current += 1
            return replaySeqRef.current
          },
          onEvent: (event) => {
            canonicalKindsRef.current = [...canonicalKindsRef.current, event.kind]
            projectionRef.current = reduceTranscriptProjection(projectionRef.current, event)
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'assistant_delta', text: 'hello ' })
    handleEvent!({ type: 'tool_start', id: 'tool-1', name: 'Bash' })
    handleEvent!({ type: 'tool_end', id: 'tool-1', result: { tool_use_id: 'tool-1', content: 'ok' } })
    handleEvent!({ type: 'error', error: new Error('Request aborted by user') })
    handleEvent!({ type: 'assistant_delta', text: 'done' })
    handleEvent!({ type: 'complete' })
    await tick()

    expect(canonicalKindsRef.current).toEqual([
      'assistant_delta',
      'tool_event',
      'tool_event',
      'assistant_delta',
      'thinking_finalized',
      'turn_footer',
    ])

    const normalizedSegments = projectionRef.current.segments.map((segment) => {
      if (segment.kind === 'user') return { kind: 'user', text: segment.text }
      if (segment.kind === 'system') return { kind: 'system', role: segment.role, text: segment.text }
      if (segment.kind === 'assistant') return { kind: 'assistant', text: segment.text }
      if (segment.kind === 'tool') return { kind: 'tool', tool: segment.toolName, status: segment.status }
      if (segment.kind === 'turn_footer') return { kind: 'turn_footer', status: segment.status }
      return { kind: 'thinking', text: segment.text, status: segment.status }
    })
    expect(normalizedSegments).toEqual([
      { kind: 'assistant', text: 'hello ' },
      { kind: 'tool', tool: 'Bash', status: 'completed' },
      { kind: 'assistant', text: 'done' },
      { kind: 'turn_footer', status: 'completed' },
    ])

    // With canonical bridge active, stream events should not also create legacy transcript rows.
    expect(messagesRef.current.some((message) => message.role === 'assistant')).toBe(false)
    expect(messagesRef.current.some((message) => message.role === 'tool')).toBe(false)
  })

  it('does not mutate legacy transcript for Task lifecycle when canonical bridge is enabled', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const messagesRef = { current: [] as Msg[] }
    const projectionRef = { current: createInitialTranscriptProjectionState({ threadId: 'tui-live' }) }

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
      const replaySeqRef = useRef(0)

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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => 'turn-canonical-task',
          nextReplaySeq: () => {
            replaySeqRef.current += 1
            return replaySeqRef.current
          },
          onEvent: (event) => {
            projectionRef.current = reduceTranscriptProjection(projectionRef.current, event)
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 'task-1', name: 'Task' })
    handleEvent!({ type: 'tool_input', id: 'task-1', input: { description: 'run checks' } })
    handleEvent!({
      type: 'tool_update',
      id: 'task-1',
      middleLines: ['Progress: 50%'],
      nestedTools: [{ id: 'nested-1', name: 'Bash', input: { command: 'ls' }, status: 'running' }],
      toolUses: 1,
      usage: { input_tokens: 12, output_tokens: 3 },
    })
    handleEvent!({ type: 'tool_end', id: 'task-1', result: { tool_use_id: 'task-1', content: 'ok' } })
    await tick()
    await tick()

    expect(messagesRef.current).toEqual([])
    const toolSegment = projectionRef.current.segments.find(
      (segment) => segment.kind === 'tool' && segment.toolUseId === 'task-1',
    )
    expect(toolSegment?.kind).toBe('tool')
    if (toolSegment?.kind === 'tool') {
      expect(toolSegment.status).toBe('completed')
      expect(toolSegment.middleLines).toEqual(['Progress: 50%'])
      expect(toolSegment.nestedTools?.[0]?.name).toBe('Bash')
      expect(toolSegment.toolUses).toBe(1)
      expect(toolSegment.usage?.input_tokens).toBe(12)
    }
  })

  it('writes Edit patchStartLineNumber into canonical tool segment at tool_end', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'formax-streaming-edit-'))
    const filePath = path.join(tmpDir, 'sample.ts')
    await fsp.writeFile(filePath, 'line1\nconst value = 1\nline3\n', 'utf8')

    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const projectionRef = { current: createInitialTranscriptProjectionState({ threadId: 'tui-live' }) }

    function Harness(): React.ReactNode {
      const [messages, setMessages] = useState<Msg[]>([])
      const [thinkingText, setThinkingText] = useState('')
      const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
      const [loadingText, setLoadingText] = useState('')
      const [ctx, setContext] = useState<any>(null)
      const [err, setError] = useState<string | null>(null)

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
      const replaySeqRef = useRef(0)

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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => 'turn-canonical-edit',
          nextReplaySeq: () => {
            replaySeqRef.current += 1
            return replaySeqRef.current
          },
          onEvent: (event) => {
            projectionRef.current = reduceTranscriptProjection(projectionRef.current, event)
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      void messages
      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    try {
      render(<Harness />)
      await tick()

      const handleEvent = handleEventRef.current
      expect(handleEvent).not.toBeNull()

      handleEvent!({ type: 'tool_start', id: 'edit-1', name: 'Edit' })
      handleEvent!({
        type: 'tool_input',
        id: 'edit-1',
        input: {
          file_path: filePath,
          old_string: 'const value = 1',
          new_string: 'const value = 2',
        },
      })
      handleEvent!({
        type: 'tool_end',
        id: 'edit-1',
        result: { tool_use_id: 'edit-1', content: 'Done', is_error: false },
      })
      await tick()

      const tool = projectionRef.current.segments.find(
        (segment) => segment.kind === 'tool' && segment.toolUseId === 'edit-1',
      )
      expect(tool && tool.kind === 'tool' ? tool.patchStartLineNumber : undefined).toBe(2)
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('keeps canonical tool detail lines when a later update sends empty middleLines', async () => {
    const handleEventRef = { current: null as null | ((ev: StreamEvent) => void) }
    const projectionRef = { current: createInitialTranscriptProjectionState({ threadId: 'tui-live' }) }

    function Harness(): React.ReactNode {
      const [messages, setMessages] = useState<Msg[]>([])
      const [thinkingText, setThinkingText] = useState('')
      const [thinkingStartedAtMs, setThinkingStartedAtMs] = useState<number | null>(null)
      const [loadingText, setLoadingText] = useState('')
      const [ctx, setContext] = useState<any>(null)
      const [err, setError] = useState<string | null>(null)

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
      const replaySeqRef = useRef(0)

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
        canonical: {
          threadId: 'tui-live',
          getTurnId: () => 'turn-canonical-middle-lines',
          nextReplaySeq: () => {
            replaySeqRef.current += 1
            return replaySeqRef.current
          },
          onEvent: (event) => {
            projectionRef.current = reduceTranscriptProjection(projectionRef.current, event)
          },
        },
      })

      useEffect(() => {
        handleEventRef.current = handleEvent
      }, [handleEvent])

      void messages
      void thinkingText
      void thinkingStartedAtMs
      void loadingText
      void ctx
      void err

      return null
    }

    render(<Harness />)
    await tick()

    const handleEvent = handleEventRef.current
    expect(handleEvent).not.toBeNull()

    handleEvent!({ type: 'tool_start', id: 'tool-ml', name: 'Bash' })
    handleEvent!({ type: 'tool_update', id: 'tool-ml', middleLines: ['line-1'] })
    handleEvent!({ type: 'tool_update', id: 'tool-ml', middleLines: [] })
    handleEvent!({ type: 'tool_end', id: 'tool-ml', result: { tool_use_id: 'tool-ml', content: 'done', is_error: false } })
    await tick()

    const tool = projectionRef.current.segments.find(
      (segment) => segment.kind === 'tool' && segment.toolUseId === 'tool-ml',
    )
    expect(tool).toMatchObject({
      kind: 'tool',
      detailLines: ['line-1'],
      middleLines: ['line-1'],
    })
  })

})
