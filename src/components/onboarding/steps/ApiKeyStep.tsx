import React from 'react'
import { Box, Text, Newline } from 'ink'
import TextInput from '../../ui/TextInput'
import { getTheme } from '../../../utils/theme'
import { providers, type ProviderKey } from '../../../constants/providers'

type ApiKeyStepProps = {
  provider: ProviderKey
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  isLoading?: boolean
  error?: string | null
  showCleanedNotification?: boolean
  baseUrl?: string
}

function getProviderLabel(provider: ProviderKey): string {
  return providers[provider]?.name || provider
}

function formatApiKeyDisplay(key: string): string {
  if (key.length <= 7) {
    return key
  }
  return `${key.substring(0, 3)}...${key.substring(key.length - 4)}`
}

export function ApiKeyStep({
  provider,
  value,
  onChange,
  onSubmit,
  isLoading = false,
  error = null,
  showCleanedNotification = false,
  baseUrl = '',
}: ApiKeyStepProps) {
  const theme = getTheme()
  const providerLabel = getProviderLabel(provider)

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
        <Text bold>API Key Setup</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Enter your {providerLabel} API key for this model profile:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This key will be stored locally and used to access the {provider} API.
              <Newline />
              Your key is never sent to our servers.
              <Newline />
              <Newline />
              {provider === 'kimi' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://platform.moonshot.cn/console/api-keys
                  </Text>
                </>
              )}
              {provider === 'deepseek' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>https://platform.deepseek.com/api_keys</Text>
                </>
              )}
              {provider === 'siliconflow' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>https://cloud.siliconflow.cn/i/oJWsm6io</Text>
                </>
              )}
              {provider === 'qwen' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://bailian.console.aliyun.com/?tab=model#/api-key
                  </Text>
                </>
              )}
              {provider === 'glm' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>https://open.bigmodel.cn (API Keys section)</Text>
                </>
              )}
              {provider === 'minimax' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://www.minimax.io/platform/user-center/basic-information
                  </Text>
                </>
              )}
              {provider === 'anthropic' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://console.anthropic.com/settings/keys
                  </Text>
                </>
              )}
              {provider === 'openai' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>https://platform.openai.com/api-keys</Text>
                </>
              )}
            </Text>
          </Box>

          <Box flexDirection="column">
            <Box>
              <TextInput
                placeholder="Paste your API key here..."
                value={value}
                onChange={onChange}
                onSubmit={onSubmit}
                mask="*"
                focus={true}
              />
            </Box>

            {value && (
              <Box marginTop={1}>
                <Text color={theme.secondaryText}>
                  Key: {formatApiKeyDisplay(value)} ({value.length} chars)
                </Text>
              </Box>
            )}
          </Box>

          {showCleanedNotification && (
            <Box marginTop={1}>
              <Text color={theme.success}>
                ✓ API key cleaned: removed line breaks and trimmed whitespace
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text>
              <Text color={theme.suggestion} dimColor={!value}>
                [Submit API Key]
              </Text>
              <Text> - Press Enter to validate and continue</Text>
            </Text>
          </Box>

          {isLoading && (
            <Box marginTop={1}>
              <Text color={theme.suggestion}>Validating API key and fetching models...</Text>
              {baseUrl && (
                <Text dimColor>Endpoint: {baseUrl}/v1/models</Text>
              )}
            </Box>
          )}

          {error && (
            <Box marginTop={1} flexDirection="column">
              <Text color="red">❌ API Key Validation Failed</Text>
              <Text color="red">{error}</Text>
              {baseUrl && (
                <Box marginTop={1}>
                  <Text dimColor>Attempted endpoint: {baseUrl}/v1/models</Text>
                </Box>
              )}
              <Box marginTop={1}>
                <Text color={theme.warning}>Please check your API key and try again.</Text>
              </Box>
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
