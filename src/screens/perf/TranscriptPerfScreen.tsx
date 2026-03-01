/**
 * TranscriptPerfScreen
 *
 * Manual performance harness for REPL transcript rendering.
 *
 * Goal: reproduce "long transcript lag / flicker" without calling a real LLM.
 *
 * Run:
 *   bun run perf:transcript
 *
 * Keys:
 *   Ctrl+S toggle streaming updates
 *   Ctrl+R reset (clear + regenerate)
 *   Ctrl+T insert a tool message (demo)
 *   Ctrl+Q quit
 *   ctrl+c quit
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import type { Msg } from '../../shared/toolMessageTypes'
import { ToolMessage } from '../../components/tool/ToolMessage'
import TextInput from '../../components/ui/TextInput'
import { InputScopeProvider, useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { clearTerminal } from '../../shared/utils/terminal'
import { getTheme } from '../../shared/utils/theme'
import { ReplTranscript } from '../repl/transcript'

type Props = {
  count?: number
  onExit?: () => void
}

function buildMessages(count: number): Msg[] {
  const now = Date.now()
  const out: Msg[] = []

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0
    out.push({
      id: `m-${i}`,
      role: isUser ? 'user' : 'assistant',
      content: isUser ? `user message ${i}` : `assistant message ${i}`,
      timestamp: new Date(now + i),
    })
  }

  return out
}

export function TranscriptPerfScreen({ count = 500, onExit }: Props): React.ReactNode {
  return (
    <InputScopeProvider initialScope="repl">
      <TranscriptPerfInner count={count} onExit={onExit} />
    </InputScopeProvider>
  )
}

function TranscriptPerfInner({ count = 500, onExit }: Props): React.ReactNode {
  const theme = useMemo(() => getTheme(), [])
  const [seed, setSeed] = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [transientTick, setTransientTick] = useState(0)
  const [transcriptSeq, setTranscriptSeq] = useState(0)
  const [draft, setDraft] = useState('')

  const initialMessages = useMemo(() => buildMessages(count), [count, seed])
  const [staticMessages, setStaticMessages] = useState<Msg[]>(() => initialMessages)

  useEffect(() => {
    setStaticMessages(initialMessages)
  }, [initialMessages])

  const transientMessages = useMemo<Msg[]>(
    () => [
      {
        id: 'transient',
        role: 'assistant',
        content: `streaming delta ${transientTick}`,
        timestamp: new Date(),
        isStreaming: true,
      } as Msg,
    ],
    [transientTick],
  )

  useEffect(() => {
    if (!streaming) return
    const id = setInterval(() => setTransientTick((n) => n + 1), 30)
    return () => clearInterval(id)
  }, [streaming])

  const append = (messages: Msg[]) => {
    setStaticMessages((prev) => [...prev, ...messages])
  }

  const insertToolDemo = () => {
    const now = Date.now()
    append([
      {
        id: `tool-${now}`,
        role: 'tool',
        content: 'Read 42 lines',
        timestamp: new Date(),
        toolInfo: {
          name: 'Read',
          status: 'completed',
          input: { file_path: 'src/index.ts' },
          result: 'line 1\nline 2\n...\nline 42',
          resultLines: 42,
          expandInfo: 'ctrl+o to expand',
        },
      },
    ])
  }

  const insertTool = (args: {
    name: 'Bash' | 'Read'
    input: Record<string, any>
    result: string
    status?: 'running' | 'completed' | 'error'
  }) => {
    const now = Date.now()
    append([
      {
        id: `tool-${now}`,
        role: 'tool',
        content: '',
        timestamp: new Date(),
        toolInfo: {
          name: args.name,
          status: args.status ?? 'completed',
          input: args.input,
          result: args.result,
          resultLines: args.result.split('\n').length,
        },
      },
    ])
  }

  const onSubmit = (value: string) => {
    const text = value.trim()
    setDraft('')
    if (!text) return

    if (/^\/bash(?:\s|$)/.test(text)) {
      const command = text.slice('/bash'.length).trim()
      insertTool({
        name: 'Bash',
        input: { command },
        result: command ? `${command}\n(ok)` : '(no command)',
      })
      return
    }

    if (/^\/read(?:\s|$)/.test(text)) {
      const file_path = text.slice('/read'.length).trim()
      insertTool({
        name: 'Read',
        input: { file_path },
        result: file_path ? `Read ${file_path}\n(line 1)\n(line 2)\n...` : '(no file)',
      })
      return
    }

    if (text === '/tool') {
      insertToolDemo()
      return
    }

    const now = Date.now()
    const assistant = Array.from({ length: 10 }, () => text).join(' ')
    append([
      { id: `u-${now}`, role: 'user', content: text, timestamp: new Date() },
      { id: `a-${now}`, role: 'assistant', content: assistant, timestamp: new Date(now + 1) },
    ])
  }

  const renderMessage = useMemo(
    () => (msg: Msg) => {
      if (msg.role === 'tool') return <ToolMessage message={msg} />
      if (msg.role === 'assistant') {
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text>
              ⏺ <Text>{msg.content}</Text>
            </Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.replUserPromptFg} backgroundColor={theme.replUserPromptBg}>
            {`> ${msg.content} `}
          </Text>
        </Box>
      )
    },
    [theme.replUserPromptBg, theme.replUserPromptFg],
  )

  useScopedRoutedInput('repl', (input, key) => {
    if (key.ctrl && input === 'c') {
      onExit ? onExit() : process.exit(0)
      return true
    }

    if (key.ctrl && (input === 'q' || input === 'Q')) {
      onExit ? onExit() : process.exit(0)
      return true
    }

    if (key.ctrl && (input === 's' || input === 'S')) {
      setStreaming((v) => !v)
      return true
    }

    if (key.ctrl && (input === 't' || input === 'T')) {
      insertToolDemo()
      return true
    }

    if (key.ctrl && (input === 'r' || input === 'R')) {
      setSeed((n) => n + 1)
      setTransientTick(0)
      setStreaming(false)
      // Remount Ink <Static> surface so this behaves like a fresh "session".
      setTranscriptSeq((n) => n + 1)
      void clearTerminal()
      return true
    }
  })

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Transcript Perf Harness</Text>
        <Text dimColor>
          {count} messages · streaming {streaming ? 'on' : 'off'} · Ctrl+S toggle · Ctrl+R reset · /tool demo · /bash … · /read … · Ctrl+Q quit
        </Text>
      </Box>

      <ReplTranscript
        transcriptSeq={transcriptSeq}
        version="0.0.0"
        modelLabel="Model: perf"
        cwd={process.cwd()}
        staticMessages={staticMessages}
        transientMessages={transientMessages}
        renderMessage={renderMessage}
      />

      <Box marginTop={1}>
        <Text color={theme.replUserPromptFg} backgroundColor={theme.replUserPromptBg}>
          {'> '}
        </Text>
        <TextInput value={draft} onChange={setDraft} onSubmit={onSubmit} scope="repl" />
      </Box>
    </Box>
  )
}
