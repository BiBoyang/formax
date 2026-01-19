import React from 'react'
import { Box, Text } from 'ink'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import TextInput from './TextInput.js'

export function InlineTextEditorRow({
  prefix,
  labelPrefix,
  placeholder,
  value,
  typing,
  active,
  color,
  placeholderColor,
  onChange,
  onSubmit,
  scope,
}: {
  prefix: string
  labelPrefix: string
  placeholder: string
  value: string
  typing: boolean
  active: boolean
  color: string
  placeholderColor: string
  onChange: (next: string) => void
  onSubmit: () => void
  scope?: InputScopeId
}): React.ReactNode {
  const hasValue = Boolean((value || '').trim())
  const showPlaceholder = !typing && !hasValue

  return (
    <Box>
      <Text>{prefix}</Text>
      <Text color={color}>{labelPrefix}</Text>
      {showPlaceholder ? (
        <Text color={placeholderColor}>{placeholder}</Text>
      ) : typing ? (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          cursorStyle="bar"
          cursorChar="▏"
          focus={active}
          scope={scope}
        />
      ) : (
        <Text color={color}>{value || ''}</Text>
      )}
    </Box>
  )
}

