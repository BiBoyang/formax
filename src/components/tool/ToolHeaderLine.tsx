import React from 'react'
import { Text } from 'ink'
import { getTheme } from '../../tui/theme'
import { PulsingDot } from '../ui/PulsingDot'
import type { ToolHeaderStatus } from '../../shared/toolMessageTypes'

export type { ToolHeaderStatus } from '../../shared/toolMessageTypes'

export function ToolHeaderLine({
  status,
  label,
  params,
  suffix,
  labelColor,
  labelBackgroundColor,
  labelBold = true,
  pulse,
  dotColor,
}: {
  status: ToolHeaderStatus
  label: string
  params?: string | null
  suffix?: string | null
  labelColor?: string
  labelBackgroundColor?: string
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
    <Text>
      <PulsingDot color={resolvedDotColor} pulse={resolvedPulse} trailingSpace />
      <Text bold={labelBold} color={labelColor ?? theme.text} backgroundColor={labelBackgroundColor}>
        {label}
      </Text>
      {suffix ? <Text color={theme.secondaryText}>{`(${suffix})`}</Text> : null}
      {params ? <Text color={theme.secondaryText}>{`(${params})`}</Text> : null}
    </Text>
  )
}
