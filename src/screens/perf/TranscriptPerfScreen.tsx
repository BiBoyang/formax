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
 *   Space  toggle streaming updates
 *   r      reset (regenerate messages + restart streaming)
 *   q      quit
 *   ctrl+c quit
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import type { Msg } from '../../components/tool/ToolMessage'
import { InputScopeProvider, useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { getTheme } from '../../utils/theme'
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
  const [streaming, setStreaming] = useState(true)
  const [transientTick, setTransientTick] = useState(0)
  const [transcriptSeq, setTranscriptSeq] = useState(0)

  const staticMessages = useMemo(() => buildMessages(count), [count, seed])

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

  const renderMessage = useMemo(
    () => (msg: Msg) => {
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

    if (input === 'q') {
      onExit ? onExit() : process.exit(0)
      return true
    }

    if (input === ' ') {
      setStreaming((v) => !v)
      return true
    }

    if (input === 'r') {
      setSeed((n) => n + 1)
      setTransientTick(0)
      setStreaming(true)
      // Remount Ink <Static> surface so this behaves like a fresh "session".
      setTranscriptSeq((n) => n + 1)
      return true
    }
  })

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Transcript Perf Harness</Text>
        <Text dimColor>
          {count} messages · streaming {streaming ? 'on' : 'off'} · Space toggle · r reset · q quit
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
    </Box>
  )
}
