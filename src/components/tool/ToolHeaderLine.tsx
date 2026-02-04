import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../utils/theme'
import { PulsingDot } from '../ui/PulsingDot'

export type ToolHeaderStatus = 'running' | 'completed' | 'error'

export function ToolHeaderLine({
  status,
  label,
  params,
  labelColor,
  labelBold = true,
  pulse,
  dotColor,
}: {
  status: ToolHeaderStatus
  label: string
  params?: string | null
  labelColor?: string
  labelBold?: boolean
  pulse?: boolean
  dotColor?: string
}): React.ReactNode {
  const theme = getTheme()

  const resolvedDotColor =
    dotColor ??
    (status === 'error'
      ? theme.error
      : status === 'completed'
        ? theme.success
        : theme.secondaryText)

  const resolvedPulse = pulse ?? status === 'running'

  return (
    <Text><PulsingDot color={resolvedDotColor} pulse={resolvedPulse} trailingSpace /><Text bold={labelBold} color={labelColor ?? theme.text}>{label}</Text>{params ? <Text color={theme.secondaryText}>{`(${params})`}</Text> : null}</Text>
  )
}
