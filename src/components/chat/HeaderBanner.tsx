import React from 'react'
import { Box, Text } from 'ink'

type Props = {
  version: string
  modelLabel: string
  cwd: string
  suggestion?: string
  hint?: string
}

export function HeaderBanner({
  version,
  modelLabel,
  cwd,
}: Props) {
  const logoLines = [
    '             ',
    '█▀▀ █▀█ █▀█ █▀▄▀█ ▄▀█ ▀▄▀',
    '█▀  █▄█ █▀▄ █ ▀ █ █▀█ █ █',
    '             ',
  ]
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
        </Box>
      </Box>
    </Box>
  )
}
