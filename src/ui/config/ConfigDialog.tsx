import React, { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '../../utils/theme.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import type { ConfigState, ConfigTab } from './constants.js'
import { CONFIG_ROWS, INITIAL_CONFIG_STATE, OUTPUT_STYLE_OPTIONS, TABS, THEME_OPTIONS } from './constants.js'
import { dialogReducer, initialDialogState, type DialogState } from './reducer.js'
import {
  ConfigDialogFrame,
  ConfigTabsBar,
  FooterHint,
  OutputStyleSelectionView,
  SettingsListView,
  StatusView,
  ThemeSelectionView,
  UsageView,
} from './ui.js'

const SCOPE = 'overlay:config' as const

function nextTab(current: ConfigTab, direction: number): ConfigTab {
  const idx = TABS.indexOf(current)
  if (idx === -1) return TABS[0]
  const nextIdx = (idx + direction + TABS.length) % TABS.length
  return TABS[nextIdx]
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

export function ConfigDialog({ onExit }: { onExit: () => void }): React.ReactNode {
  useScopeActivation(SCOPE)

  const theme = useMemo(() => getTheme(), [])
  const [configState, setConfigState] = useState<ConfigState>(INITIAL_CONFIG_STATE)
  const [state, dispatch] = useReducer(dialogReducer, undefined, initialDialogState)

  const escapeBufferRef = useRef('')
  const stateRef = useRef<DialogState>(state)
  const listCursorRef = useRef(0)
  const listCursorMaxRef = useRef(0)
  const listRowsRef = useRef<Array<{ row: (typeof CONFIG_ROWS)[number]; value: string | boolean }>>([])

  stateRef.current = state
  if (state.view === 'list') listCursorRef.current = state.cursor

  const currentRows = useMemo(() => {
    const rows = CONFIG_ROWS.filter((row) => row.tab === state.tab).map((row) => ({
      row,
      value: row.getValue(configState),
    }))

    listRowsRef.current = rows
    listCursorMaxRef.current = Math.max(0, rows.length - 1)

    return rows
  }, [configState, state.tab])

  const applyConfig = useCallback((id: string, value: unknown) => {
    setConfigState((prev) => ({
      ...prev,
      values: { ...prev.values, [id]: value },
    }))
  }, [])

  useScopedInput(SCOPE, (input, key) => {
    const s = stateRef.current

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''

    const isUpArrow = keyName === 'up' || Boolean((key as any)?.upArrow)
    const isDownArrow = keyName === 'down' || Boolean((key as any)?.downArrow)

    // In some environments/tests, arrow escape sequences can arrive split across multiple
    // `useInput` calls, or multiple arrows can be batched into one chunk. Buffer/parse ESC
    // sequences so Up/Down work reliably.
    let bufferedDelta = 0
    if (!isUpArrow && !isDownArrow && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending && res.delta === 0) return
      bufferedDelta = res.delta
    }

    const keyDelta = isUpArrow ? -1 : isDownArrow ? 1 : 0
    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    // Important: handle `key.escape` after buffering ESC sequences, otherwise environments that
    // deliver arrow sequences split across callbacks can misinterpret a partial ESC as "Escape".
    // In practice, Ink provides `key.escape` with an empty `input` for a real Escape keypress,
    // while split escape-sequences arrive as non-empty `token` chunks.
    if (key.escape && !token) {
      escapeBufferRef.current = ''
      if (s.view === 'list') onExit()
      else dispatch({ type: 'CLOSE_SUB_VIEW' })
      return
    }

    if (s.view === 'list') {
      if (key.tab || token === '\t') {
        dispatch({ type: 'SET_TAB', tab: nextTab(s.tab, 1) })
        return
      }

      if (delta !== 0) {
        const max = listCursorMaxRef.current
        const next = clamp(listCursorRef.current + delta, 0, max)
        listCursorRef.current = next
        dispatch({ type: 'MOVE_CURSOR', next })
        return
      }

      if (key.return || token === '\r' || token === '\n' || token === ' ') {
        const rowItem = listRowsRef.current[listCursorRef.current]
        if (!rowItem) return
        const row = rowItem.row

        if (row.kind === 'toggle') {
          applyConfig(row.id, !Boolean(row.getValue(configState)))
          return
        }

        if (row.kind === 'select') {
          switch (row.id) {
            case 'theme':
              dispatch({ type: 'OPEN_THEME_SELECT' })
              return
            case 'outputStyle':
              dispatch({ type: 'OPEN_OUTPUT_STYLE_SELECT' })
              return
            case 'defaultPermissionMode': {
              const current = String((configState.values.defaultPermissionMode as string) ?? 'dont_ask')
              applyConfig('defaultPermissionMode', current === 'dont_ask' ? 'default' : 'dont_ask')
              return
            }
            case 'notifications': {
              const current = String((configState.values.notifications as string) ?? 'auto')
              applyConfig('notifications', current === 'auto' ? 'off' : 'auto')
              return
            }
            default:
              return
          }
        }
      }

      return
    }

    if (s.view === 'themeSelect') {
      const max = Math.max(0, THEME_OPTIONS.length - 1)
      if (delta !== 0) {
        dispatch({ type: 'MOVE_CURSOR', next: clamp(s.cursor + delta, 0, max) })
        return
      }

      if (key.return || token === '\r' || token === '\n' || token === ' ') {
        const selected = THEME_OPTIONS[s.cursor]
        if (!selected) return
        applyConfig('theme', selected.id)
        dispatch({ type: 'CLOSE_SUB_VIEW' })
      }

      return
    }

    if (s.view === 'outputStyleSelect') {
      const max = Math.max(0, OUTPUT_STYLE_OPTIONS.length - 1)
      if (delta !== 0) {
        dispatch({ type: 'MOVE_CURSOR', next: clamp(s.cursor + delta, 0, max) })
        return
      }

      if (key.return || token === '\r' || token === '\n' || token === ' ') {
        const selected = OUTPUT_STYLE_OPTIONS[s.cursor]
        if (!selected) return
        applyConfig('outputStyle', selected.id)
        dispatch({ type: 'CLOSE_SUB_VIEW' })
      }

      return
    }
  })

  const content = (() => {
    if (state.view === 'themeSelect') {
      return (
        <ThemeSelectionView
          theme={theme}
          options={THEME_OPTIONS}
          cursor={state.cursor}
          currentThemeId={String(configState.values.theme)}
        />
      )
    }

    if (state.view === 'outputStyleSelect') {
      return (
        <OutputStyleSelectionView
          theme={theme}
          options={OUTPUT_STYLE_OPTIONS}
          cursor={state.cursor}
          currentStyleId={String(configState.values.outputStyle)}
        />
      )
    }

    if (state.tab === 'status') return <StatusView theme={theme} />
    if (state.tab === 'usage') return <UsageView theme={theme} />

    if (currentRows.length === 0) {
      return (
        <Box marginTop={1}>
          <Text color={theme.secondaryText}>No settings available for this tab.</Text>
        </Box>
      )
    }

    return <SettingsListView theme={theme} rows={currentRows} cursor={state.cursor} />
  })()

  const footerText = (() => {
    if (state.view === 'outputStyleSelect') return 'Enter to confirm · Esc to cancel'
    if (state.view !== 'list') return 'Esc to cancel'
    if (state.tab === 'config') return 'Enter/Space to change · Esc to cancel'
    return 'Esc to cancel'
  })()

  return (
    <ConfigDialogFrame theme={theme}>
      {state.view === 'list' ? <ConfigTabsBar theme={theme} activeTab={state.tab} /> : null}
      {content}
      <FooterHint theme={theme} text={footerText} />
    </ConfigDialogFrame>
  )
}
