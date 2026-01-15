import React from 'react'
import { Box, Text } from 'ink'

type Props = {
  version: string
  modelLabel: string
  cwd: string
  suggestion?: string
  hint?: string
  context?: null | {
    percentRemaining: number
    usedTokens: number
    limitTokens: number
    source: 'estimate'
  }
}

export function HeaderBanner({
  version,
  modelLabel,
  cwd,
  context,
}: Props) {
  const logoLines = [
    '             ',
    '█▀▀ █▀█ █▀█ █▀▄▀█ ▄▀█ ▀▄▀',
    '█▀  █▄█ █▀▄ █ ▀ █ █▀█ █ █',
    '             ',
  ]

  const contextLine = context
    ? `Context: ${clampPct(context.percentRemaining)}% free (${formatTokens(context.usedTokens)}/${formatTokens(
        context.limitTokens,
      )}, est.)`
    : null

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box>
        <Box flexDirection="column" marginRight={3}>
        {logoLines.map((line, idx) => (
            <Text
              key={idx}
              color={'#d57455'}
            >
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text>&nbsp;</Text>
          <Text bold>{modelLabel}</Text>
          {/* <Text color="gray">v{version}</Text> */}
          <Text color="gray">{cwd}</Text>
          {contextLine ? <Text color="gray">{contextLine}</Text> : null}
        </Box>
      </Box>
    </Box>
  )
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function formatTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  if (v < 1000) return String(v)
  if (v < 100000) return `${(v / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  if (v < 1000000) return `${Math.round(v / 1000)}k`
  return `${(v / 1000000).toFixed(1).replace(/\\.0$/, '')}m`
}
