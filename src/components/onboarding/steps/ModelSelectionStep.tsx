import React from 'react'
import { Box, Text } from 'ink'
import { Select } from '../../ui/Select'
import { getTheme } from '../../../utils/theme'
import type { ProviderKey } from '../../../constants/providers'

export type ModelInfo = {
  model: string
  provider: string
  max_tokens?: number
  supports_reasoning_effort?: boolean
  supports_vision?: boolean
  supports_function_calling?: boolean
}

type ModelSelectionStepProps = {
  provider: ProviderKey
  models: ModelInfo[]
  onSelect: (model: string) => void
}

export function ModelSelectionStep({ provider, models, onSelect }: ModelSelectionStepProps) {
  const theme = getTheme()

  const modelOptions = models.map((model) => ({
    label: model.model,
    value: model.model,
  }))

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Select Model:</Text>
      <Text color={theme.secondaryText}>Choose a model from {provider}</Text>
      {modelOptions.length > 0 ? (
        <Select options={modelOptions} onChange={onSelect} />
      ) : (
        <Text color="yellow">No models available</Text>
      )}
      <Text dimColor>Press Escape to go back</Text>
    </Box>
  )
}
