import React, { useState, useEffect } from 'react'
import { Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'

type TextInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  mask?: string
  focus?: boolean
}

export default function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  mask,
  focus = true,
}: TextInputProps) {
  const theme = getTheme()
  const [cursorOffset, setCursorOffset] = useState(value.length)

  // Update cursor offset when value changes externally
  useEffect(() => {
    setCursorOffset(Math.min(cursorOffset, value.length))
  }, [value.length, cursorOffset])

  useInput(
    (input, key) => {
      if (!focus) return

      if (key.backspace || key.delete) {
        if (value.length > 0 && cursorOffset > 0) {
          const newValue =
            value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
          onChange(newValue)
          setCursorOffset(Math.max(0, cursorOffset - 1))
        }
        return
      }

      if (key.leftArrow && cursorOffset > 0) {
        setCursorOffset(cursorOffset - 1)
        return
      }

      if (key.rightArrow && cursorOffset < value.length) {
        setCursorOffset(cursorOffset + 1)
        return
      }

      if (key.return && onSubmit) {
        onSubmit(value)
        return
      }

      // Insert character at cursor position
      if (input && !key.ctrl && !key.meta) {
        const newValue =
          value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
        onChange(newValue)
        setCursorOffset(cursorOffset + input.length)
      }
    },
    { isActive: focus },
  )

  const displayValue = mask ? value.replace(/./g, mask) : value
  const showPlaceholder = value.length === 0 && placeholder

  // Ensure cursor offset is within bounds
  const safeCursorOffset = Math.max(0, Math.min(cursorOffset, displayValue.length))

  // 计算光标前后的文本
  const beforeCursor = displayValue.slice(0, safeCursorOffset)
  const afterCursor = displayValue.slice(safeCursorOffset)

  return (
    <Text>
      {showPlaceholder ? (
        <>
          {focus ? (
            <Text inverse>{placeholder.slice(0, 1) || ' '}</Text>
          ) : (
            <Text color={theme.secondaryText}>{placeholder.slice(0, 1) || ' '}</Text>
          )}
          <Text color={theme.secondaryText}>{placeholder.slice(1)}</Text>
        </>
      ) : (
        <>
          {beforeCursor}
          {focus && <Text inverse> </Text>}
          {afterCursor}
        </>
      )}
    </Text>
  )
}
