import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { getTheme } from '../../shared/utils/theme'

export function dimHexColor(hex: string, factor: number): string | null {
  const raw = String(hex || '').trim()
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null

  let digits = match[1]!.toLowerCase()
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((c) => c + c)
      .join('')
  }

  const r = Number.parseInt(digits.slice(0, 2), 16)
  const g = Number.parseInt(digits.slice(2, 4), 16)
  const b = Number.parseInt(digits.slice(4, 6), 16)

  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0')

  const f = Number.isFinite(factor) ? Math.max(0, Math.min(1, factor)) : 1
  return `#${toHex(r * f)}${toHex(g * f)}${toHex(b * f)}`
}

export function PulsingDot({
  color,
  pulse = false,
  intervalMs = 600,
  // Claude Code style shows a single space after the bullet, e.g. `⏺ Read(...)`.
  // Default to a trailing space and keep call sites free of leading spaces so we don't
  // accidentally end up with `⏺  Read` (double space).
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
  const shimmerFactors = [0.45, 0.65, 0.85, 1] as const
  const factor = pulse ? shimmerFactors[phase % shimmerFactors.length] : 1
  const shaded = dimHexColor(dotColor, factor) ?? dotColor

  return (
    <Text color={shaded}>{`⏺${trailingSpace ? ' ' : ''}`}</Text>
  )
}
