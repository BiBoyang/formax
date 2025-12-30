import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../../utils/theme'

type ConnectionTestResult = {
  success: boolean
  message: string
  endpoint?: string
  details?: string
}

type ConnectionTestStepProps = {
  providerName: string
  isTestingConnection: boolean
  result: ConnectionTestResult | null
  onTest: () => void
}

export function ConnectionTestStep({
  providerName,
  isTestingConnection,
  result,
  onTest,
}: ConnectionTestStepProps) {
  const theme = getTheme()

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Connection Test</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Testing connection to {providerName}...</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>
            This will verify your configuration by sending a test request to the API.
          </Text>
        </Box>

        {!result && !isTestingConnection && (
          <Box marginY={1}>
            <Text>
              <Text color={theme.suggestion}>Press Enter</Text> to start the connection test
            </Text>
          </Box>
        )}

        {isTestingConnection && (
          <Box marginY={1}>
            <Text color={theme.suggestion}>🔄 Testing connection...</Text>
          </Box>
        )}

        {result && (
          <Box flexDirection="column" marginY={1} paddingX={1}>
            <Text color={result.success ? theme.success : 'red'}>{result.message}</Text>

            {result.endpoint && (
              <Text color={theme.secondaryText}>Endpoint: {result.endpoint}</Text>
            )}

            {result.details && <Text color={theme.secondaryText}>Details: {result.details}</Text>}

            {result.success ? (
              <Box marginTop={1}>
                <Text color={theme.success}>✅ Automatically proceeding to confirmation...</Text>
              </Box>
            ) : (
              <Box marginTop={1}>
                <Text>
                  <Text color={theme.suggestion}>Press Enter</Text> to retry test, or{' '}
                  <Text color={theme.suggestion}>Esc</Text> to go back
                </Text>
              </Box>
            )}
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={theme.suggestion}>Esc</Text> to go back to context length
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
