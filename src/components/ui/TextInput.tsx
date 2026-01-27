import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopedRoutedInput } from '../../features/repl/inputScopeContext'

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
  reservedChars?: string[]
  scope?: InputScopeId
}

export function classifyDeletionKey({
  keyName,
  raw,
  key,
}: {
  keyName: string
  raw: string
  key: any
}): 'backspace' | 'forwardDelete' | null {
  const isForwardDelete = raw === '\u001B[3~'
  if (isForwardDelete) return 'forwardDelete'

  const isBackspace =
    keyName === 'backspace' ||
    Boolean(key?.backspace) ||
    raw === '\b' ||
    raw === '\x7f' ||
    // Ink often reports the Backspace key as "delete" with no printable sequence, especially on macOS.
    // Treat that case as backspace (delete previous char), not forward-delete.
    keyName === 'delete' ||
    (Boolean(key?.delete) && raw === '')
  if (isBackspace) return 'backspace'

  return null
}

export function computeNextCursorOffsetForControlledValue({
  prevValue,
  prevCursorOffset,
  nextValue,
}: {
  prevValue: string
  prevCursorOffset: number
  nextValue: string
}): number {
  const clamped = Math.max(0, Math.min(prevCursorOffset, nextValue.length))
  const prevAtEnd = prevCursorOffset === prevValue.length
  if (prevAtEnd && nextValue.length > prevValue.length) return nextValue.length
  return clamped
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
  reservedChars,
  scope,
}: TextInputProps) {
  const theme = getTheme()
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const lastValueRef = useRef(value)
  const valueRef = useRef(value)
  const cursorOffsetRef = useRef(cursorOffset)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)

  // Keep refs in sync before Ink can process the next input event.
  // `useEffect` can be too late (after a paint) and lead to stale handlers when props change quickly
  // (e.g. slash suggestions update `onSubmit` while the user hits Enter immediately).
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useLayoutEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  // Keep cursor in-bounds without forcing it to the end.
  // This avoids surprising cursor jumps when the user edits in the middle while the input is controlled.
  useEffect(() => {
    valueRef.current = value
    const nextCursorOffset = computeNextCursorOffsetForControlledValue({
      prevValue: lastValueRef.current,
      prevCursorOffset: cursorOffsetRef.current,
      nextValue: value,
    })
    cursorOffsetRef.current = nextCursorOffset
    setCursorOffset(nextCursorOffset)
    lastValueRef.current = value
  }, [value])

  useEffect(() => {
    cursorOffsetRef.current = cursorOffset
  }, [cursorOffset])

  const handler = useCallback((input: string, key: any) => {
    if (!focus) return false

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const raw = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof key?.name === 'string' ? (key.name as string) : ''
    const currentValue = valueRef.current
    const currentCursorOffset = cursorOffsetRef.current
    const isSubmit = key.return || input === '\r' || seq === '\r'
    const isNewline = input === '\n' || seq === '\n'
    const wantsNewline = multiline && (isNewline || (isSubmit && Boolean(key.shift)))

    // Tab is reserved for higher-level navigation (e.g. mode/menus). Treat it as non-text input here.
    if (key.tab || input === '\t') return false

    const deletion = classifyDeletionKey({ keyName, raw, key })
    if (deletion === 'backspace') {
      if (currentValue.length > 0 && currentCursorOffset > 0) {
        const newValue = currentValue.slice(0, currentCursorOffset - 1) + currentValue.slice(currentCursorOffset)
        onChangeRef.current(newValue)
        valueRef.current = newValue
        const nextCursorOffset = Math.max(0, currentCursorOffset - 1)
        cursorOffsetRef.current = nextCursorOffset
        setCursorOffset(nextCursorOffset)
      }
      return true
    }

    if (deletion === 'forwardDelete') {
      if (currentValue.length > 0 && currentCursorOffset < currentValue.length) {
        const newValue = currentValue.slice(0, currentCursorOffset) + currentValue.slice(currentCursorOffset + 1)
        onChangeRef.current(newValue)
        valueRef.current = newValue
      }
      return true
    }

    const isLeftArrowSeq = raw === '\u001B[D' || raw === '\u001BOD'
    if (key.leftArrow || isLeftArrowSeq) {
      if (currentCursorOffset > 0) {
        const nextCursorOffset = currentCursorOffset - 1
        cursorOffsetRef.current = nextCursorOffset
        setCursorOffset(nextCursorOffset)
      }
      return true
    }

    const isRightArrowSeq = raw === '\u001B[C' || raw === '\u001BOC'
    if (key.rightArrow || isRightArrowSeq) {
      if (currentCursorOffset < currentValue.length) {
        const nextCursorOffset = currentCursorOffset + 1
        cursorOffsetRef.current = nextCursorOffset
        setCursorOffset(nextCursorOffset)
      }
      return true
    }

    if (wantsNewline) {
      const newValue = currentValue.slice(0, currentCursorOffset) + '\n' + currentValue.slice(currentCursorOffset)
      onChangeRef.current(newValue)
      valueRef.current = newValue
      const nextCursorOffset = currentCursorOffset + 1
      cursorOffsetRef.current = nextCursorOffset
      setCursorOffset(nextCursorOffset)
      return true
    }

    if (isSubmit || isNewline) {
      if (onSubmitRef.current) {
        onSubmitRef.current(currentValue)
        return true
      }
      // Let parent handlers decide what Enter means when no submit callback is provided.
      return false
    }

    // Insert text at cursor position.
    // Prefer `raw` (sequence) because in some terminals Ink may surface the printable character via
    // `key.sequence` with an empty `input` string.
    if (raw && !raw.startsWith('\u001b') && !key.ctrl && !key.meta) {
      if (reservedChars?.includes(raw)) return false
      const newValue = currentValue.slice(0, currentCursorOffset) + raw + currentValue.slice(currentCursorOffset)
      onChangeRef.current(newValue)
      valueRef.current = newValue
      const nextCursorOffset = currentCursorOffset + raw.length
      cursorOffsetRef.current = nextCursorOffset
      setCursorOffset(nextCursorOffset)
      return true
    }
    return false
  }, [focus, multiline])

  useScopedRoutedInput(scope ?? 'repl', handler, {
    enabled: Boolean(scope) && focus,
    group: 'textInput',
    priority: 100,
  })
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
