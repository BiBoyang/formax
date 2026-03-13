import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { getTheme } from '../../tui/theme'

const STAR_SYMBOLS = ['·', '✢', '✳', '✶', '✻', '✽'] as const

export function RotatingStar({
  color,
  intervalMs = 130,
}: {
  color?: string
  intervalMs?: number
}): React.ReactNode {
  const theme = getTheme()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % STAR_SYMBOLS.length)
    }, intervalMs)
    ;(timer as any).unref?.()
    return () => clearInterval(timer)
  }, [intervalMs])

  const symbol = STAR_SYMBOLS[index]
  const resolvedColor = color ?? theme.text

  return <Text color={resolvedColor}>{symbol}</Text>
}
