import React, { useEffect, useMemo, useState } from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'

export function ThinkingStatusLine({
  startedAtMs,
  showThinkingHint = false,
  hintAfterMs = 2000,
  updateIntervalMs = 200,
}: {
  startedAtMs: number | null
  showThinkingHint?: boolean
  hintAfterMs?: number
  updateIntervalMs?: number
}): React.ReactNode {
  const theme = getTheme()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (startedAtMs === null) return
    setNowMs(Date.now())

    const timer = setInterval(() => setNowMs(Date.now()), updateIntervalMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }, [startedAtMs, updateIntervalMs])

  const elapsedMs = useMemo(() => (startedAtMs === null ? 0 : Math.max(0, nowMs - startedAtMs)), [nowMs, startedAtMs])
  const seconds = useMemo(() => Math.floor(elapsedMs / 1000), [elapsedMs])

  if (startedAtMs === null) return null

  if (elapsedMs < hintAfterMs) {
    return <Text color={theme.secondaryText}>∴ Thinking…</Text>
  }

  if (!showThinkingHint) {
    return <Text color={theme.secondaryText}>∴ Thought for {seconds}s</Text>
  }

  return (
    <Text color={theme.secondaryText}>
      ∴ Thought for {seconds}s (
      <Text bold color={theme.secondaryText}>
        ctrl+o
      </Text>{' '}
      to show thinking)
    </Text>
  )
}
