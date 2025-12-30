import React from 'react'
import { Box, Text } from 'ink'
import { Select } from '../../ui/Select'
import { getTheme } from '../../../utils/theme'

type MaxTokensOption = {
  label: string
  value: number
}

const MAX_TOKENS_OPTIONS: MaxTokensOption[] = [
  { label: '1K tokens', value: 1024 },
  { label: '2K tokens', value: 2048 },
  { label: '4K tokens', value: 4096 },
  { label: '8K tokens (recommended)', value: 8192 },
  { label: '16K tokens', value: 16384 },
  { label: '32K tokens', value: 32768 },
  { label: '64K tokens', value: 65536 },
  { label: '128K tokens', value: 131072 },
]

type ReasoningEffortOption = 'low' | 'medium' | 'high'

const REASONING_EFFORT_OPTIONS: { label: string; value: ReasoningEffortOption }[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
]

type ModelParamsStepProps = {
  modelName: string
  maxTokens: string
  reasoningEffort: ReasoningEffortOption | null
  supportsReasoningEffort: boolean
  activeFieldIndex: number
  onMaxTokensChange: (value: string, preset: number) => void
  onReasoningEffortChange: (value: ReasoningEffortOption) => void
  onSubmit: () => void
}

export function ModelParamsStep({
  modelName,
  maxTokens,
  reasoningEffort,
  supportsReasoningEffort,
  activeFieldIndex,
  onMaxTokensChange,
  onReasoningEffortChange,
  onSubmit,
}: ModelParamsStepProps) {
  const theme = getTheme()

  const formFields = [
    {
      name: 'maxTokens',
      label: 'Maximum Tokens',
      description: 'Select the maximum number of tokens to generate.',
      component: 'select' as const,
    },
    ...(supportsReasoningEffort
      ? [
          {
            name: 'reasoningEffort',
            label: 'Reasoning Effort',
            description: 'Controls reasoning depth for complex problems.',
            component: 'select' as const,
          },
        ]
      : []),
    {
      name: 'submit',
      label: 'Continue →',
      component: 'button' as const,
    },
  ]

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Model Parameters</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Configure parameters for {modelName}:</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>
            Use <Text color={theme.suggestion}>Tab</Text> to navigate between fields. Press{' '}
            <Text color={theme.suggestion}>Enter</Text> to submit.
          </Text>
        </Box>

        <Box flexDirection="column">
          {formFields.map((field, index) => (
            <Box flexDirection="column" marginY={1} key={field.name}>
              {field.component !== 'button' ? (
                <>
                  <Text bold color={activeFieldIndex === index ? theme.success : undefined}>
                    {field.label}
                  </Text>
                  {field.description && <Text color={theme.secondaryText}>{field.description}</Text>}
                </>
              ) : (
                <Text bold color={activeFieldIndex === index ? theme.success : undefined}>
                  {field.label}
                </Text>
              )}
              <Box marginY={1}>
                {activeFieldIndex === index ? (
                  field.component === 'select' ? (
                    field.name === 'maxTokens' ? (
                      <Select
                        options={MAX_TOKENS_OPTIONS.map((opt) => ({
                          label: opt.label,
                          value: opt.value.toString(),
                        }))}
                        onChange={(value) => {
                          const numValue = parseInt(value)
                          onMaxTokensChange(numValue.toString(), numValue)
                        }}
                        defaultValue={maxTokens}
                      />
                    ) : (
                      <Select
                        options={REASONING_EFFORT_OPTIONS.map((opt) => ({
                          label: opt.label,
                          value: opt.value,
                        }))}
                        onChange={(value) => {
                          onReasoningEffortChange(value as ReasoningEffortOption)
                        }}
                        defaultValue={reasoningEffort || 'medium'}
                      />
                    )
                  ) : null
                ) : field.name === 'maxTokens' ? (
                  <Text color={theme.secondaryText}>
                    Current:{' '}
                    <Text color={theme.suggestion}>
                      {MAX_TOKENS_OPTIONS.find((opt) => opt.value === parseInt(maxTokens))?.label ||
                        `${maxTokens} tokens`}
                    </Text>
                  </Text>
                ) : field.name === 'reasoningEffort' ? (
                  <Text color={theme.secondaryText}>
                    Current: <Text color={theme.suggestion}>{reasoningEffort || 'Not set'}</Text>
                  </Text>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={theme.suggestion}>Tab</Text> to navigate,{' '}
            <Text color={theme.suggestion}>Enter</Text> to continue, or{' '}
            <Text color={theme.suggestion}>Esc</Text> to go back
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
