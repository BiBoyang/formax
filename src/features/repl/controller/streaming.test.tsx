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
