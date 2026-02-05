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
  inputMode?: 'normal' | 'bash'
  onBackspaceAtStart?: () => void
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
  inputMode = 'normal',
  onBackspaceAtStart,
  suggestions = [],
}: Props) {
  const theme = getTheme()
  const cols = Math.max((process.stdout.columns || 80), 40)
  const line = '─'.repeat(cols)
  const isBashMode = inputMode === 'bash'
  const borderColor = isBashMode ? theme.bashBorder : 'gray'
  const promptPrefix = isBashMode ? '! ' : '> '
  const promptColor = isBashMode ? theme.bashBorder : 'cyan'
  const reservedChars = !isBashMode && value.length === 0 ? ['!'] : undefined
  const maxCmdLen = suggestions.reduce((max, s) => Math.max(max, s.command.length), 0)
  const cmdWidth = Math.min(Math.max(maxCmdLen, 10), 28) + 2

  return (
    <Box flexDirection="column" width="100%">
      <Text color={borderColor}>{line}</Text>
      <Box>
        <Text color={promptColor} bold>
          {promptPrefix}
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
            reservedChars={reservedChars}
            onBackspaceAtStart={isBashMode ? onBackspaceAtStart : undefined}
          />
        </Box>
      </Box>
      <Text color={borderColor}>{line}</Text>
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
