import React, { memo } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../ui/TextInput'
import { getTheme } from '../../utils/theme'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
  placeholder?: string
  disabled?: boolean
  suggestions?: Array<{
    id: string
    command: string
    description: string
    selected?: boolean
    dim?: boolean
  }>
}

function InputBarImpl({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  suggestions = [],
}: Props) {
  const theme = getTheme()
  const cols = Math.max((process.stdout.columns || 80), 40)
  const line = '─'.repeat(cols)
  const maxCmdLen = suggestions.reduce((max, s) => Math.max(max, s.command.length), 0)
  const cmdWidth = Math.min(Math.max(maxCmdLen, 10), 28) + 2

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
            scope="repl"
            multiline
          />
        </Box>
      </Box>
      <Text color="gray">{line}</Text>
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {suggestions.map((s) => {
            const cmdColor = s.selected ? theme.text : s.dim ? theme.secondaryText : theme.suggestion
            const descColor = s.selected ? theme.secondaryText : theme.secondaryText

            return (
              <Box key={s.id}>
                <Text color={cmdColor} bold={Boolean(s.selected)}>
                  {s.command.padEnd(cmdWidth)}
                </Text>
                <Text color={descColor}>{s.description}</Text>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

export const InputBar = memo(InputBarImpl)
