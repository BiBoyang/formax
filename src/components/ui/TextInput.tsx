import React, { useState, useEffect } from 'react'
import { Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopedInput } from '../../features/repl/inputScopeContext'

type TextInputProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  mask?: string
  focus?: boolean
  cursorStyle?: 'block' | 'bar'
  cursorChar?: string
  scope?: InputScopeId
}

export default function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  mask,
  focus = true,
  cursorStyle = 'block',
  cursorChar = '▏',
  scope,
}: TextInputProps) {
  const theme = getTheme()
  const [cursorOffset, setCursorOffset] = useState(value.length)

  // Update cursor offset when value changes externally
  useEffect(() => {
    setCursorOffset(Math.min(cursorOffset, value.length))
  }, [value.length, cursorOffset])

  const handler = (input: string, key: any) => {
    if (!focus) return

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const isReturn = key.return || input === '\r' || input === '\n' || seq === '\r' || seq === '\n'

    // Tab is reserved for higher-level navigation (e.g. mode/menus). Treat it as non-text input here.
    if (key.tab || input === '\t') return

    if (key.backspace || key.delete) {
      if (value.length > 0 && cursorOffset > 0) {
        const newValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
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

    if (isReturn) {
      if (onSubmit) onSubmit(value)
      return
    }

    // Insert character at cursor position
    if (input && !key.ctrl && !key.meta) {
      const newValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
      onChange(newValue)
      setCursorOffset(cursorOffset + input.length)
    }
  }

  useScopedInput(scope ?? 'repl', handler, { enabled: Boolean(scope) && focus })
  useInput(handler, { isActive: Boolean(focus) && !scope })

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
          {focus && cursorStyle === 'block' ? <Text inverse> </Text> : null}
          {focus && cursorStyle === 'bar' ? <Text color={theme.text}>{cursorChar}</Text> : null}
          <Text color={theme.secondaryText}>{placeholder}</Text>
        </>
      ) : (
        <>
          {beforeCursor}
          {focus && cursorStyle === 'block' ? <Text inverse> </Text> : null}
          {focus && cursorStyle === 'bar' ? <Text color={theme.text}>{cursorChar}</Text> : null}
          {afterCursor}
        </>
      )}
    </Text>
  )
}
