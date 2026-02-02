import React from 'react'
import { Box, Text } from 'ink'
import type { Theme } from '../../utils/theme'

export type ThinkingBlockRenderMode = 'primary' | 'expanded'

export function shouldRenderThinkingBlock(args: {
  mode: ThinkingBlockRenderMode
  verboseOutput: boolean
}): boolean {
  if (args.mode === 'expanded') return true
  return args.verboseOutput
}

export function renderThinkingBlock(args: {
  content: string
  theme: Theme
}): React.ReactNode {
  const raw = String(args.content || '').trimEnd()
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0}>
      <Text color={args.theme.secondaryText}>∴ Thinking…</Text>
      <Box>
        <Text> </Text>
      </Box>
      <Box flexDirection="column">
        {raw
          ? raw.split('\n').map((line, idx) => (
              <Text key={idx} color={args.theme.secondaryText}>
                {line ? `  ${line}` : ' '}
              </Text>
            ))
          : null}
      </Box>
    </Box>
  )
}

