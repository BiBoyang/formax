import React from 'react'
import { Box, Text } from 'ink'
import { Select } from '../../ui/Select'
import { getTheme } from '../../../utils/theme'
import { providers, type ProviderKey } from '../../../constants/providers'
import models from '../../../constants/models'

type PartnerProvidersStepProps = {
  onSelect: (provider: string) => void
}

function getProviderLabel(provider: ProviderKey, modelCount: number): string {
  if (providers[provider]) {
    return `${providers[provider].name} (${modelCount} models)`
  }
  return `${provider}`
}

export function PartnerProvidersStep({ onSelect }: PartnerProvidersStepProps) {
  const theme = getTheme()

  // Define partner providers with custom ranking
  const rankedProviders = [
    'openai',
    'anthropic',
    'gemini',
    'glm',
    'kimi',
    'minimax',
    'qwen',
    'deepseek',
    'openrouter',
    'burncloud',
    'siliconflow',
    'baidu-qianfan',
    'mistral',
    'xai',
    'groq',
    'azure',
  ]

  // Filter to only include providers that exist and aren't coding/custom
  const partnerProviders = rankedProviders.filter(
    (provider) =>
      providers[provider as ProviderKey] &&
      !provider.includes('coding') &&
      provider !== 'custom-openai' &&
      provider !== 'ollama' &&
      models[provider as keyof typeof models] !== undefined,
  )

  // Create provider options for partner providers submenu
  const partnerProviderOptions = partnerProviders.map((provider) => {
    const modelCount = models[provider as keyof typeof models]?.length || 0
    const label = getProviderLabel(provider as ProviderKey, modelCount)
    return {
      label,
      value: provider,
    }
  })

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Partner Providers</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Select a partner AI provider for this model profile:</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>
            Choose from official partner providers to access their models and services.
          </Text>
        </Box>

        <Select options={partnerProviderOptions} onChange={onSelect} />

        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={theme.suggestion}>Esc</Text> to go back to main menu
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
