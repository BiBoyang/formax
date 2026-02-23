import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import {
  createConfigDialogService,
  type ConfigDialogService,
  type ConfigDialogSettingId,
} from '../../features/commands/configDialogService.js'
import { getTheme } from '../../utils/theme.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getInputToken, getVerticalArrowKeyDelta, isReturnKeyToken } from '../../features/repl/keys/keyTokens.js'
import type { ConfigState, ConfigTab } from './constants.js'
import { CONFIG_ROWS, INITIAL_CONFIG_STATE, OUTPUT_STYLE_OPTIONS, TABS } from './constants.js'
import { dialogReducer, initialDialogState, type DialogState } from './reducer.js'
import {
  ConfigDialogFrame,
  ConfigTabsBar,
  FooterHint,
  OutputStyleSelectionView,
  SettingsListView,
  StatusView,
  UsageView,
} from './ui.js'

const SCOPE = 'overlay:config' as const

export type ConfigDialogExit =
  | { kind: 'dismissed' }
  | { kind: 'changed'; message: string }

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

function formatChangeMessage(id: ConfigDialogSettingId, value: unknown): string {
  if (id === 'outputStyle') {
    const label = OUTPUT_STYLE_OPTIONS.find((o) => o.id === String(value))?.label ?? 'Default'
    return `Set output style to ${label}`
  }
  if (id === 'thinkingMode') return `Set thinking mode to ${Boolean(value)}`
  return `Set verbose output to ${Boolean(value)}`
}

function isConfigDialogSettingId(id: string): id is ConfigDialogSettingId {
  return id === 'outputStyle' || id === 'thinkingMode' || id === 'verboseOutput'
}

export function ConfigDialog(args: {
  onExit: (exit: ConfigDialogExit) => void
  service?: ConfigDialogService
  cwd?: string
  env?: NodeJS.ProcessEnv
}): React.ReactNode {
  useScopeActivation(SCOPE)

  const theme = useMemo(() => getTheme(), [])
  const cwd = args.cwd ?? process.cwd()
  const env = args.env ?? process.env
  const service = useMemo(
    () => args.service ?? createConfigDialogService({ cwd, env }),
    [args.service, cwd, env],
  )

  const [configState, setConfigState] = useState<ConfigState>(INITIAL_CONFIG_STATE)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(dialogReducer, undefined, initialDialogState)

  const escapeBufferRef = useRef('')
  const stateRef = useRef<DialogState>(state)
  const listCursorRef = useRef(0)
  const listCursorMaxRef = useRef(0)
  const listRowsRef = useRef<Array<{ row: (typeof CONFIG_ROWS)[number]; value: string | boolean; sourceLabel: string }>>(
    [],
  )
  const lastExitRef = useRef<ConfigDialogExit>({ kind: 'dismissed' })

  stateRef.current = state
  if (state.view === 'list') listCursorRef.current = state.cursor

  const reloadFromDisk = useCallback(async () => {
    setLoadError(null)
    setConfigState(await service.load())
  }, [service])

  useEffect(() => {
    void (async () => {
      try {
        await reloadFromDisk()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setLoadError(msg)
      }
    })()
  }, [reloadFromDisk])

  const currentRows = useMemo(() => {
    const rows = CONFIG_ROWS.filter((row) => row.tab === state.tab).map((row) => {
      const sourceLabel = configState.sources[row.id] ?? 'Default'
      return {
        row,
        value: row.getValue(configState),
        sourceLabel,
      }
    })

    listRowsRef.current = rows
    listCursorMaxRef.current = Math.max(0, rows.length - 1)

    return rows
  }, [configState, state.tab])

  const persistSetting = useCallback(
    async (id: ConfigDialogSettingId, value: unknown) => {
      try {
        await service.persist({ id, value })
        lastExitRef.current = { kind: 'changed', message: formatChangeMessage(id, value) }
        await reloadFromDisk()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setLoadError(msg)
      }
    },
    [reloadFromDisk, service],
  )

  useScopedInput(SCOPE, (input, key) => {
    const s = stateRef.current

    const token = getInputToken({ input, key })
    const keyDelta = getVerticalArrowKeyDelta(key)
    const hasArrowKeyDelta = keyDelta !== 0

    // In some environments/tests, arrow escape sequences can arrive split across multiple
    // `useInput` calls, or multiple arrows can be batched into one chunk. Buffer/parse ESC
    // sequences so Up/Down work reliably.
    let bufferedDelta = 0
    if (!hasArrowKeyDelta && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending && res.delta === 0) return
      bufferedDelta = res.delta
    }

    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    // Important: handle `key.escape` after buffering ESC sequences, otherwise environments that
    // deliver arrow sequences split across callbacks can misinterpret a partial ESC as "Escape".
    // In practice, Ink provides `key.escape` with an empty `input` for a real Escape keypress,
    // while split escape-sequences arrive as non-empty `token` chunks.
    if (key.escape && !token) {
      escapeBufferRef.current = ''
      if (s.view === 'list') args.onExit(lastExitRef.current)
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

      if (isReturnKeyToken({ token, key }) || token === ' ') {
        const rowItem = listRowsRef.current[listCursorRef.current]
        if (!rowItem) return
        const row = rowItem.row
        if (!isConfigDialogSettingId(row.id)) return

        if (row.kind === 'toggle') {
          const current = Boolean(configState.values[row.id] ?? row.getValue(configState))
          void persistSetting(row.id, !current)
          return
        }

        if (row.kind === 'select') {
          switch (row.id) {
            case 'outputStyle':
              dispatch({ type: 'OPEN_OUTPUT_STYLE_SELECT' })
              return
            default:
              return
          }
        }
      }

      return
    }

    if (s.view === 'outputStyleSelect') {
      const max = Math.max(0, OUTPUT_STYLE_OPTIONS.length - 1)
      if (delta !== 0) {
        dispatch({ type: 'MOVE_CURSOR', next: clamp(s.cursor + delta, 0, max) })
        return
      }

      if (isReturnKeyToken({ token, key }) || token === ' ') {
        const selected = OUTPUT_STYLE_OPTIONS[s.cursor]
        if (!selected) return
        void persistSetting('outputStyle', selected.id)
        dispatch({ type: 'CLOSE_SUB_VIEW' })
      }

      return
    }
  })

  const content = (() => {
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

    if (loadError) {
      return (
        <Box marginTop={1}>
          <Text color={theme.error}>Error: {loadError}</Text>
        </Box>
      )
    }

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
