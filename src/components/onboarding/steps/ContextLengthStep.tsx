import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'

type ContextLengthOption = {
  label: string
  value: number
}

const CONTEXT_LENGTH_OPTIONS: ContextLengthOption[] = [
  { label: '32K tokens', value: 32000 },
  { label: '64K tokens', value: 64000 },
  { label: '128K tokens (recommended)', value: 128000 },
  { label: '200K tokens', value: 200000 },
  { label: '256K tokens', value: 256000 },
  { label: '300K tokens', value: 300000 },
  { label: '512K tokens', value: 512000 },
  { label: '1000K tokens', value: 1000000 },
  { label: '2000K tokens', value: 2000000 },
  { label: '3000K tokens', value: 3000000 },
  { label: '5000K tokens', value: 5000000 },
  { label: '10000K tokens', value: 10000000 },
]

const DEFAULT_CONTEXT_LENGTH = 128000

type ContextLengthStepProps = {
  value: number
  onSubmit: () => void
}

export function ContextLengthStep({ value }: ContextLengthStepProps) {
  const theme = getTheme()

  const selectedOption =
    CONTEXT_LENGTH_OPTIONS.find((opt) => opt.value === value) || CONTEXT_LENGTH_OPTIONS[2]

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Context Length Configuration</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Choose the context window length for your model:</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>
            This determines how much conversation history and context the model can process at once.
            Higher values allow for longer conversations but may increase costs.
          </Text>
        </Box>

        <Box flexDirection="column" marginY={1}>
          {CONTEXT_LENGTH_OPTIONS.map((option) => {
            const isSelected = option.value === value
            return (
              <Box key={option.value} flexDirection="row">
                <Text color={isSelected ? 'blue' : undefined}>
                  {isSelected ? '→ ' : '  '}
                  {option.label}
                  {option.value === DEFAULT_CONTEXT_LENGTH ? ' (recommended)' : ''}
                </Text>
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text dimColor>
            Selected: <Text color={theme.suggestion}>{selectedOption.label}</Text>
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑/↓ to select · Enter to continue · Esc to go back</Text>
        </Box>
      </Box>
    </Box>
  )
}

export { CONTEXT_LENGTH_OPTIONS }
