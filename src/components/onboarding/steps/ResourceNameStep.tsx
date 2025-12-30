import React from 'react'
import { Box, Text, Newline } from 'ink'
import TextInput from '../../ui/TextInput'
import { getTheme } from '../../../utils/theme'

type ResourceNameStepProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}

export function ResourceNameStep({ value, onChange, onSubmit }: ResourceNameStepProps) {
  const theme = getTheme()

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
        <Text bold>Azure Resource Name</Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Enter your Azure OpenAI deployment name:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This is the deployment name for your Azure OpenAI resource.
              <Newline />
              For example: "gpt-4", "gpt-35-turbo", etc.
            </Text>
          </Box>

          <Box>
            <TextInput
              placeholder="gpt-4"
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              focus={true}
            />
          </Box>

          <Box marginTop={1}>
            <Text>
              <Text color={theme.suggestion} dimColor={!value}>
                [Submit Resource Name]
              </Text>
              <Text> - Press Enter to continue</Text>
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
