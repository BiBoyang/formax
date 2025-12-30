import React, { useState } from 'react'
import { Box, Text, Newline, useInput } from 'ink'
import { ModelSelector } from './ModelSelector'
import { PressEnterToContinue } from '../ui/PressEnterToContinue'
import { getTheme } from '../../utils/theme'

type ModelStepProps = {
  onNext: () => void
}

export function ModelStep({ onNext }: ModelStepProps) {
  const theme = getTheme()
  const [showModelSelector, setShowModelSelector] = useState(false)

  // Handle Enter key to show ModelSelector
  useInput((_input, key) => {
    if (key.return && !showModelSelector) {
      setShowModelSelector(true)
    }
  })

  if (showModelSelector) {
    return <ModelSelector onDone={onNext} isOnboarding={true} />
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configure your models:</Text>
      <Box flexDirection="column" width={70}>
        <Text>
          You can customize which models Formax uses for different tasks.
          <Newline />
          <Text color={theme.secondaryText}>
            Let&apos;s set up your preferred models for large and small tasks.
          </Text>
        </Text>
        <Box marginTop={1}>
          <Text>
            Press <Text color={theme.suggestion}>Enter</Text> to continue to the
            model selection screen.
          </Text>
        </Box>
      </Box>
      <PressEnterToContinue />
    </Box>
  )
}

