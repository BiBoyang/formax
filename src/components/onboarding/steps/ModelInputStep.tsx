import React from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../ui/TextInput'
import { getTheme } from '../../../utils/theme'
import type { ProviderKey } from '../../../constants/providers'

type ModelInputStepProps = {
  provider: ProviderKey
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  error?: string | null
  resourceName?: string
}

function getModelInputInfo(provider: ProviderKey) {
  switch (provider) {
    case 'anthropic':
      return {
        placeholder: 'claude-3-5-sonnet-latest',
        examples: 'For example: "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"',
      }
    case 'openai':
      return {
        placeholder: 'gpt-4o',
        examples: 'For example: "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"',
      }
    default:
      return {
        placeholder: 'model-name',
        examples: 'Enter the model name as supported by your API',
      }
  }
}

export function ModelInputStep({
  provider,
  value,
  onChange,
  onSubmit,
  error = null,
  resourceName = '',
}: ModelInputStepProps) {
  const theme = getTheme()
  const { placeholder, examples } = getModelInputInfo(provider)

  // Determine the screen title and description based on provider
  let screenTitle = 'Manual Model Setup'
  let description = 'Enter the model name manually'

  if (provider === 'azure') {
    screenTitle = 'Azure Model Setup'
    description = `Enter your Azure OpenAI deployment name${resourceName ? ` (Resource: ${resourceName})` : ''}:`
  } else if (provider === 'anthropic') {
    screenTitle = 'Claude Model Setup'
    description = 'Enter the Claude model name:'
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>{screenTitle}</Text>
      <Text color={theme.secondaryText}>
        {error ? `Failed to fetch models: ${error}. Please enter the model name manually.` : description}
      </Text>
      <Box flexDirection="column" width={70}>
        <Text color={theme.secondaryText} dimColor>
          {examples}
        </Text>
      </Box>
      <Box>
        <Text>Model Name: </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          focus={true}
        />
      </Box>
      <Text dimColor>Press Enter to confirm, Escape to go back</Text>
    </Box>
  )
}
