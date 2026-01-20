import React, { useState, useEffect, useRef } from 'react'
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
  multiline?: boolean
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
  multiline = false,
  cursorStyle = 'block',
  cursorChar = '▏',
  scope,
}: TextInputProps) {
  const theme = getTheme()
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const lastValueRef = useRef(value)

  // Keep cursor in-bounds without forcing it to the end.
  // This avoids surprising cursor jumps when the user edits in the middle while the input is controlled.
  useEffect(() => {
    setCursorOffset((prev) => {
      const prevValue = lastValueRef.current
      const clamped = Math.max(0, Math.min(prev, value.length))
      const prevAtEnd = prev === prevValue.length
      if (prevAtEnd && value.length > prevValue.length) return value.length
      return clamped
    })
    lastValueRef.current = value
  }, [value])

  const handler = (input: string, key: any) => {
    if (!focus) return

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const raw = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof key?.name === 'string' ? (key.name as string) : ''
    const isSubmit = key.return || input === '\r' || seq === '\r'
    const isNewline = input === '\n' || seq === '\n'
    const wantsNewline = multiline && (isNewline || (isSubmit && Boolean(key.shift)))

    // Tab is reserved for higher-level navigation (e.g. mode/menus). Treat it as non-text input here.
    if (key.tab || input === '\t') return

    const isForwardDelete = keyName === 'delete' || raw === '\u001B[3~'
    const isBackspace =
      keyName === 'backspace' ||
      Boolean(key.backspace) ||
      raw === '\b' ||
      raw === '\x7f' ||
      // On macOS terminals the Backspace key is often reported as "delete" with no sequence.
      (Boolean(key.delete) && !isForwardDelete && raw === '')
    if (isBackspace) {
      if (value.length > 0 && cursorOffset > 0) {
        const newValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
        onChange(newValue)
        setCursorOffset(Math.max(0, cursorOffset - 1))
      }
      return
    }

    if (isForwardDelete) {
      if (value.length > 0 && cursorOffset < value.length) {
        const newValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1)
        onChange(newValue)
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

    if (wantsNewline) {
      const newValue = value.slice(0, cursorOffset) + '\n' + value.slice(cursorOffset)
      onChange(newValue)
      setCursorOffset(cursorOffset + 1)
      return
    }

    if (isSubmit || isNewline) {
      if (onSubmit) onSubmit(value)
      return
    }

    // Insert text at cursor position.
    // Prefer `raw` (sequence) because in some terminals Ink may surface the printable character via
    // `key.sequence` with an empty `input` string.
    if (raw && !raw.startsWith('\u001b') && !key.ctrl && !key.meta) {
      const newValue = value.slice(0, cursorOffset) + raw + value.slice(cursorOffset)
      onChange(newValue)
      setCursorOffset(cursorOffset + raw.length)
    }
  }

  useScopedInput(scope ?? 'repl', handler, { enabled: Boolean(scope) && focus })
  useInput(handler, { isActive: Boolean(focus) && !scope })

  const displayValue = mask ? value.replace(/./g, mask) : value
  const showPlaceholder = value.length === 0 && placeholder

  // Ensure cursor offset is within bounds
  const safeCursorOffset = Math.max(0, Math.min(cursorOffset, displayValue.length))

  const beforeCursor = displayValue.slice(0, safeCursorOffset)
  const afterCursorBar = displayValue.slice(safeCursorOffset)

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
          {cursorStyle === 'block' ? (
            <>
              {beforeCursor}
              {focus ? (
                <Text inverse>{displayValue[safeCursorOffset] ?? '\u00A0'}</Text>
              ) : safeCursorOffset < displayValue.length ? (
                displayValue[safeCursorOffset]
              ) : (
                ''
              )}
              {safeCursorOffset + 1 <= displayValue.length ? displayValue.slice(safeCursorOffset + 1) : ''}
            </>
          ) : (
            <>
              {beforeCursor}
              {focus ? <Text color={theme.text}>{cursorChar}</Text> : null}
              {afterCursorBar}
            </>
          )}
        </>
      )}
    </Text>
  )
}
