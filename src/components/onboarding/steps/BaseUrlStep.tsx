import React from 'react'
import { Box, Text, Newline } from 'ink'
import TextInput from '../../ui/TextInput'
import { getTheme } from '../../../utils/theme'
import { providers, type ProviderKey } from '../../../constants/providers'

type BaseUrlStepProps = {
  provider: ProviderKey
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  isLoading?: boolean
  error?: string | null
}

export function BaseUrlStep({
  provider,
  value,
  onChange,
  onSubmit,
  isLoading = false,
  error = null,
}: BaseUrlStepProps) {
  const theme = getTheme()
  const isCustomOpenAI = provider === 'custom-openai'
  const providerName = providers[provider]?.name || provider
  const defaultUrl = providers[provider]?.baseURL || ''

  if (isCustomOpenAI) {
    return (
      <Box flexDirection="column" gap={1}>
        <Box
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={theme.secondaryBorder}
          paddingX={2}
          paddingY={1}
        >
          <Text bold>Custom API Server Setup</Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Enter your custom API URL:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                This is the base URL for your OpenAI-compatible API.
                <Newline />
                For example: https://api.example.com/v1
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="https://api.example.com/v1"
                value={value}
                onChange={onChange}
                onSubmit={onSubmit}
                focus={!isLoading}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text color={isLoading ? theme.secondaryText : theme.suggestion}>
                  [Submit Base URL]
                </Text>
                <Text> - Press Enter or click to continue</Text>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        flexDirection="column"
        gap={1}
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>{providerName} API Configuration</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Configure the API endpoint for {providerName}:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              {provider === 'ollama' ? (
                <>
                  This is the URL of your Ollama server.
                  <Newline />
                  Default is http://localhost:11434/v1 for local Ollama installations.
                </>
              ) : (
                <>
                  This is the base URL for the {providerName} API.
                  <Newline />
                  You can modify this URL or press Enter to use the default.
                </>
              )}
            </Text>
          </Box>

          <Box>
            <TextInput
              placeholder={defaultUrl}
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              focus={!isLoading}
            />
          </Box>

          <Box marginTop={1}>
            <Text>
              <Text color={isLoading ? theme.secondaryText : theme.suggestion}>
                [Submit Base URL]
              </Text>
              <Text> - Press Enter or click to continue</Text>
            </Text>
          </Box>

          {isLoading && (
            <Box marginTop={1}>
              <Text color={theme.success}>
                {provider === 'ollama'
                  ? 'Connecting to Ollama server...'
                  : `Connecting to ${providerName}...`}
              </Text>
            </Box>
          )}

          {error && (
            <Box marginTop={1}>
              <Text color="red">Error: {error}</Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
              <Text color={theme.suggestion}>Esc</Text> to go back
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
