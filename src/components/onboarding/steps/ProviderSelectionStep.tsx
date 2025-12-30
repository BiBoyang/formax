import React from 'react'
import { Box, Text } from 'ink'
import { Select } from '../../ui/Select'
import { getTheme } from '../../../utils/theme'
import { providers, type ProviderKey } from '../../../constants/providers'
import models from '../../../constants/models'

type ProviderSelectionStepProps = {
  onSelect: (provider: string) => void
}

function getProviderLabel(provider: ProviderKey, modelCount: number): string {
  if (providers[provider]) {
    return `${providers[provider].name} (${modelCount} models)`
  }
  return `${provider}`
}

export function ProviderSelectionStep({ onSelect }: ProviderSelectionStepProps) {
  const theme = getTheme()

  const mainMenuOptions = [
    { value: 'custom-openai', label: 'Custom OpenAI-Compatible API' },
    { value: 'custom-anthropic', label: 'Custom Anthropic-Compatible API' },
    { value: 'partnerProviders', label: 'Partner Providers →' },
    { value: 'partnerCodingPlans', label: 'Partner Coding Plans →' },
    { value: 'ollama', label: getProviderLabel('ollama', models.ollama?.length || 0) },
  ]

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Select AI Provider:</Text>
      <Text color={theme.secondaryText}>Choose your preferred AI provider</Text>
      <Select options={mainMenuOptions} onChange={onSelect} />
      <Text dimColor>Press Escape to cancel</Text>
    </Box>
  )
}
