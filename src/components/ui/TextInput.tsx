import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Text, useInput } from 'ink'
import { getTheme } from '../../utils/theme'
import type { InputScopeId } from '../../features/repl/inputScopeContext'
import { useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { consumeBufferedArrow, consumeBufferedHorizontal } from '../../features/repl/keys/escapeSequences.js'

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
}): 'backspace' | null {
  // In practice, terminals/keyboards vary wildly in how they report "delete".
  // For Formax UI inputs, we keep semantics simple and consistent:
  // treat both Backspace and Delete-like sequences as "delete previous char".
  //
  // This matches the "delete_or_backspace" expectation users have in the REPL/overlays,
  // and avoids subtle differences across terminals (and across Ink versions).
  if (raw === '\u001B[3~') return 'backspace'

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
  const scopeRef = useRef(scope)
  const escapeBufferRef = useRef('')
  const bareEscapePendingRef = useRef(false)

  // Keep refs in sync before Ink can process the next input event.
  // `useEffect` can be too late (after a paint) and lead to stale handlers when props change quickly
  // (e.g. slash suggestions update `onSubmit` while the user hits Enter immediately).
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useLayoutEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  useLayoutEffect(() => {
    scopeRef.current = scope
  }, [scope])

  // Keep cursor in-bounds without forcing it to the end.
  // This avoids surprising cursor jumps when the user edits in the middle while the input is controlled.
  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
    cursorOffsetRef.current = cursorOffset
  }, [cursorOffset])

  const handler = useCallback((input: string, key: any) => {
    if (!focus) return false

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    // Prefer `input` when available: Ink can batch multiple keystrokes into a single handler call
    // where `input` contains multiple characters but `key.sequence` only reflects the last one.
    // Falling back to `key.sequence` preserves support for terminals where printable chars arrive
    // with an empty `input` string.
    const rawInput = typeof input === 'string' ? input : ''
    const rawSeq = typeof seq === 'string' ? seq : ''
    const raw = (rawInput.length > 0 ? rawInput : rawSeq) || ''
    const keyName = typeof key?.name === 'string' ? (key.name as string) : ''
    const currentValue = valueRef.current
    const currentCursorOffset = cursorOffsetRef.current
    const isSubmit = key.return || input === '\r' || seq === '\r'
    const isNewline = input === '\n' || seq === '\n'
    const wantsNewline = multiline && (isNewline || (isSubmit && Boolean(key.shift)))

    // Tab is reserved for higher-level navigation (e.g. mode/menus). Treat it as non-text input here.
    if (key.tab || input === '\t') return false

    // Some environments deliver Escape as a key event with an empty `input`/`sequence`,
    // then deliver the rest of an escape sequence in subsequent chunks (e.g. '[', 'Z').
    // Track that case so we can buffer the follow-up bytes without dropping normal typing.
    if (!raw && Boolean(key.escape)) {
      bareEscapePendingRef.current = true
      return false
    }

    if (bareEscapePendingRef.current) {
      if (raw === '[' || raw === 'O') {
        bareEscapePendingRef.current = false
        escapeBufferRef.current = '\u001B'
      } else {
        bareEscapePendingRef.current = false
      }
    }

    // In ink-testing-library (and in some terminals), escape sequences can arrive split across
    // multiple `useInput` calls (e.g. "\u001B", "[", "D"). Buffer left/right/delete sequences so
    // cursor movement works reliably in tests and in the UI.
    //
    // Important: if Ink reports a real Escape key press (`key.escape`) and there's no buffered
    // sequence in-progress, don't intercept it here—let higher-level handlers close dialogs.
    if (escapeBufferRef.current || raw.startsWith('\u001B')) {
      const buffer = escapeBufferRef.current
      const hadBufferedEscape = Boolean(buffer)

      // First, try the horizontal/delete sequences that this component "owns".
      const horiz = consumeBufferedHorizontal({ buffer, chunk: raw })
      if (horiz.pending && horiz.delta === 0 && horiz.deletes === 0) {
        escapeBufferRef.current = horiz.nextBuffer
        return false
      }

      if (horiz.delta !== 0 || horiz.deletes !== 0) {
        escapeBufferRef.current = horiz.nextBuffer

        // Apply horizontal movement.
        if (horiz.delta !== 0) {
          const next = Math.max(0, Math.min(currentCursorOffset + horiz.delta, currentValue.length))
          cursorOffsetRef.current = next
          setCursorOffset(next)
        }

        // Apply delete(s). For TextInput we treat delete as "delete previous char" (backspace).
        if (horiz.deletes > 0) {
          let nextValue = currentValue
          let nextCursor = cursorOffsetRef.current
          for (let i = 0; i < horiz.deletes; i += 1) {
            if (nextValue.length === 0 || nextCursor <= 0) continue
            nextValue = nextValue.slice(0, nextCursor - 1) + nextValue.slice(nextCursor)
            nextCursor = Math.max(0, nextCursor - 1)
          }
          if (nextValue !== currentValue) {
            onChangeRef.current(nextValue)
            valueRef.current = nextValue
            cursorOffsetRef.current = nextCursor
            setCursorOffset(nextCursor)
          }
        }

        return true
      }

      // Then, swallow split Up/Down sequences so they don't get inserted as literal "[A" text.
      // We deliberately don't consume them (return false) so higher-level menus can handle them.
      const vert = consumeBufferedArrow({ buffer, chunk: raw })
      if (vert.pending && vert.delta === 0) {
        escapeBufferRef.current = vert.nextBuffer
        return false
      }

      if (vert.delta !== 0) {
        escapeBufferRef.current = vert.nextBuffer
        return false
      }

      // Unknown/unsupported escape sequence (or a lone ESC). Clear the buffer so normal input isn't blocked.
      escapeBufferRef.current = ''
      // If the sequence was split across multiple chunks, swallow this chunk so it doesn't get
      // inserted as literal text (e.g. Shift+Tab delivered as ESC, '[', 'Z' would otherwise add 'Z').
      if (hadBufferedEscape) return false
    }

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
      // When scoped, always consume Enter/Newline so it doesn't bubble to higher-level handlers
      // (lists/hotkeys) in the same scope.
      return Boolean(scopeRef.current)
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
