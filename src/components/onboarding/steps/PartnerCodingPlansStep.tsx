import React from 'react'
import { Box, Text, Newline } from 'ink'
import { Select } from '../../ui/Select'
import { getTheme } from '../../../utils/theme'
import { providers, type ProviderKey } from '../../../constants/providers'
import models from '../../../constants/models'

type PartnerCodingPlansStepProps = {
  onSelect: (provider: string) => void
}

function getProviderLabel(provider: ProviderKey, modelCount: number): string {
  if (providers[provider]) {
    return `${providers[provider].name} (${modelCount} models)`
  }
  return `${provider}`
}

export function PartnerCodingPlansStep({ onSelect }: PartnerCodingPlansStepProps) {
  const theme = getTheme()

  // Define partner coding plans
  const codingPlanProviders = (Object.keys(providers) as ProviderKey[]).filter((provider) =>
    provider.includes('coding'),
  )

  // Create provider options for coding plans submenu
  const codingPlanOptions = codingPlanProviders.map((provider) => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return {
      label,
      value: provider,
    }
  })

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Partner Coding Plans</Text>
      <Box flexDirection="column" gap={1}>
        <Text bold>Select a partner coding plan for specialized programming assistance:</Text>
        <Box flexDirection="column" width={70}>
          <Text color={theme.secondaryText}>
            These are specialized models optimized for coding and development tasks.
            <Newline />
            They require specific coding plan subscriptions from the respective providers.
          </Text>
        </Box>

        <Select options={codingPlanOptions} onChange={onSelect} />

        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color={theme.suggestion}>Esc</Text> to go back to main menu
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
