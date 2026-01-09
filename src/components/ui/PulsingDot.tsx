import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'

export function PulsingDot({
  color,
  pulse = false,
  intervalMs = 600,
  trailingSpace = true,
}: {
  color?: string
  pulse?: boolean
  intervalMs?: number
  trailingSpace?: boolean
}): React.ReactNode {
  const theme = getTheme()
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    if (!pulse) return
    const timer = setInterval(() => setPhase((p) => (p + 1) % 4), intervalMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }, [intervalMs, pulse])

  const dotColor = color ?? theme.secondaryText
  const dim = pulse ? phase % 2 === 0 : false

  return (
    <Text color={dotColor} dimColor={dim}>
      ⏺{trailingSpace ? ' ' : ''}
    </Text>
  )
}
