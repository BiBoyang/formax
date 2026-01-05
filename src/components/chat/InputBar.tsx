import React, { memo } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../ui/TextInput'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  placeholder?: string
  disabled?: boolean
}

function InputBarImpl({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
}: Props) {
  const cols = Math.max((process.stdout.columns || 80), 40)
  const line = '─'.repeat(cols)

  return (
    <Box flexDirection="column" width="100%">
      <Text color="gray">{line}</Text>
      <Box>
        <Text color="cyan" bold>
          {'> '}
        </Text>
        <Box flexGrow={1}>
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={placeholder}
            focus={!disabled}
          />
        </Box>
      </Box>
      <Text color="gray">{line}</Text>
    </Box>
  )
}

export const InputBar = memo(InputBarImpl)
