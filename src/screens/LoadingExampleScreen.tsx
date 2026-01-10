/**
 * LoadingExampleScreen
 *
 * A small demo screen for the loading UI:
 * - Thinking status line which changes after ~2s
 * - Animated loading line with cycling verbs + shimmer
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { LoadingStatusLine } from '../components/ui/LoadingStatusLine'
import { ThinkingStatusLine } from '../components/ui/ThinkingStatusLine'

type Props = {
  onExit?: () => void
}

export function LoadingExampleScreen({ onExit }: Props): React.ReactNode {
  const [isLoading, setIsLoading] = useState(true)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(() => Date.now())
  const [hasThinkingText, setHasThinkingText] = useState(true)
  const [showThinking, setShowThinking] = useState(false)

  const thinkingText = useMemo(
    () =>
      [
        'This is a placeholder thinking trace.',
        'Press ctrl+o to toggle showing it.',
        'Press t to toggle whether thinking exists.',
      ].join(' '),
    [],
  )

  useEffect(() => {
    if (isLoading) {
      setStartedAtMs((prev) => prev ?? Date.now())
      return
    }
    setStartedAtMs(null)
    setShowThinking(false)
  }, [isLoading])

  useInput((key, meta) => {
    if (meta.ctrl && key === 'c') {
      onExit ? onExit() : process.exit(0)
      return
    }

    if (meta.ctrl && key === 'o') {
      if (!isLoading) return
      if (!hasThinkingText) return
      setShowThinking((v) => !v)
      return
    }

    if (key === ' ') {
      setIsLoading((v) => !v)
      return
    }

    if (key === 'r') {
      setIsLoading(true)
      setStartedAtMs(Date.now())
      setShowThinking(false)
      return
    }

    if (key === 't') {
      setHasThinkingText((v) => !v)
      setShowThinking(false)
      return
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>Loading UI Example</Text>
      <Text dimColor>
        Space: toggle loading · r: restart timer · t: toggle thinking · ctrl+o: show thinking · ctrl+c: exit
      </Text>

      <Box marginTop={1} flexDirection="column">
        {isLoading ? (
          <>
            <ThinkingStatusLine startedAtMs={startedAtMs} showThinkingHint={hasThinkingText} />
            {showThinking && hasThinkingText && (
              <Box marginTop={1}>
                <Text dimColor>{thinkingText}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <LoadingStatusLine cycleWords />
            </Box>
          </>
        ) : (
          <Text color="green">Done</Text>
        )}
      </Box>
    </Box>
  )
}
