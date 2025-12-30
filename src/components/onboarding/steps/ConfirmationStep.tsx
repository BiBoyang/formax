import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'
import type { ProviderKey } from '../../../constants/providers'

type ConfirmationStepProps = {
  provider: ProviderKey
  modelName: string
  maxTokens: number
  contextLength: number
  reasoningEffort?: string | null
  onConfirm: () => void
}

export function ConfirmationStep({
  provider,
  modelName,
  maxTokens,
  contextLength,
  reasoningEffort,
}: ConfirmationStepProps) {
  const theme = getTheme()

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configuration Confirmation</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Confirm your model configuration:</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>Please review your selections before saving.</Text>
        </Box>

        <Box flexDirection="column" marginY={1} paddingX={1}>
          <Text>
            <Text bold>Provider:</Text> {provider}
          </Text>
          <Text>
            <Text bold>Model:</Text> {modelName}
          </Text>
          <Text>
            <Text bold>Max Tokens:</Text> {maxTokens}
          </Text>
          <Text>
            <Text bold>Context Length:</Text> {contextLength}
          </Text>
          {reasoningEffort && (
            <Text>
              <Text bold>Reasoning Effort:</Text> {reasoningEffort}
            </Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text>
            <Text color={theme.suggestion}>Press Enter</Text> to save configuration
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={theme.suggestion}>Esc</Text> to go back
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
