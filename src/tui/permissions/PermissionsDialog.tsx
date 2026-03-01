import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import {
  createPermissionsDialogService,
  type LoadedPermissions,
  type PermissionListKind,
} from '../../features/commands/permissionsDialogService.js'
import { getTheme } from '../theme.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getInputToken, getVerticalArrowKeyDelta, isReturnKeyToken } from '../../features/repl/keys/keyTokens.js'
import type { PermissionTab, SaveScope } from './constants.js'
import { SAVE_SCOPE_OPTIONS } from './constants.js'
import { dialogReducer, initialDialogState, type DialogState } from './reducer.js'
import {
  buildListItems,
  clamp,
  formatScopeLabel,
  formatWorkspaceSourceLabel,
  nextTab,
  persistWorkspaceDirFromInput,
  type PermissionsListItem,
} from './utils.js'
import { ConfirmDeleteView, DialogFrame, FooterHint, ListView, SaveScopeView, SearchRow, TabsBar, TextEntryView, WorkspaceRootsView } from './ui.js'

const SCOPE = 'overlay:permissions' as const

export function PermissionsDialog({ onExit }: { onExit: () => void }): React.ReactNode {
  useScopeActivation(SCOPE)

  const theme = useMemo(() => getTheme(), [])
  const originalWorkingDir = useMemo(() => process.cwd(), [])
  const service = useMemo(
    () => createPermissionsDialogService({ cwd: originalWorkingDir, env: process.env }),
    [originalWorkingDir],
  )
  const [reloadKey, setReloadKey] = useState(0)

  const [permissions, setPermissions] = useState<LoadedPermissions>(() => ({
    allow: [],
    ask: [],
    deny: [],
    workspace: { additionalDirectories: [] },
    warnings: [],
  }))

  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await service.load()
      if (!alive) return
      setPermissions(loaded)
    })()
    return () => {
      alive = false
    }
  }, [reloadKey, service])

  const [state, dispatch] = useReducer(dialogReducer, undefined, initialDialogState)

  const listItems = useMemo((): PermissionsListItem[] => {
    return buildListItems({ tab: state.tab, permissions, searchQuery: state.searchQuery })
  }, [permissions, state.searchQuery, state.tab])

  const listCursorMax = Math.max(0, listItems.length - 1)
  const listCursor = clamp(state.cursor, 0, listCursorMax)

  const cancelToList = useCallback(() => dispatch({ type: 'CANCEL_VIEW' }), [])

  const commitRule = useCallback(
    async (rule: string, kind: PermissionListKind, scope: SaveScope) => {
      await service.persistRule({ scope, kind, rule })
      setReloadKey((n) => n + 1)
    },
    [service],
  )

  const commitWorkspaceDir = useCallback(
    async (dir: string) => {
      await service.persistWorkspaceDir({ scope: 'projectLocal', dir })
      setReloadKey((n) => n + 1)
    },
    [service],
  )

  const deleteRule = useCallback(
    async (args: { rule: string; kind: PermissionListKind; scope: SaveScope }) => {
      await service.deleteRule({ scope: args.scope, kind: args.kind, rule: args.rule })
      setReloadKey((n) => n + 1)
    },
    [service],
  )

  const deleteWorkspaceDir = useCallback(
    async (args: { dir: string; scope: SaveScope }) => {
      await service.deleteWorkspaceDir({ scope: args.scope, dir: args.dir })
      setReloadKey((n) => n + 1)
    },
    [service],
  )

  const escapeBufferRef = useRef('')
  const stateRef = useRef<DialogState>(state)
  const listItemsRef = useRef<PermissionsListItem[]>(listItems)
  const listCursorRef = useRef(listCursor)
  const listCursorMaxRef = useRef(listCursorMax)

  stateRef.current = state
  listItemsRef.current = listItems
  listCursorRef.current = listCursor
  listCursorMaxRef.current = listCursorMax

  useScopedInput(SCOPE, (input, key) => {
    const s = stateRef.current
    const token = getInputToken({ input, key })
    const isEnter = isReturnKeyToken({ token, key })

    if (key.escape) {
      escapeBufferRef.current = ''
      if (s.view === 'list') onExit()
      else cancelToList()
      return
    }

    const keyDelta = getVerticalArrowKeyDelta(key)
    const hasArrowKeyDelta = keyDelta !== 0

    // In some environments/tests, arrow escape sequences can arrive split across multiple
    // `useInput` calls, or multiple arrows can be batched into one chunk. Buffer/parse ESC
    // sequences so Up/Down work reliably.
    let bufferedDelta = 0
    if (!hasArrowKeyDelta && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      bufferedDelta = res.delta
    }

    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    if (s.view === 'list') {
      if (key.tab || token === '\t') {
        dispatch({ type: 'SET_TAB', tab: nextTab(s.tab, 1) })
        return
      }

      if (token === '/') {
        dispatch({ type: 'TOGGLE_SEARCH' })
        return
      }

      if (delta !== 0) {
        const max = listCursorMaxRef.current
        const next = clamp(listCursorRef.current + delta, 0, max)
        listCursorRef.current = next
        dispatch({ type: 'MOVE_LIST_CURSOR', next })
        return
      }

      if (isEnter) {
        const cursor = listCursorRef.current
        const item = listItemsRef.current[cursor]
        if (item.type === 'add') {
          dispatch({ type: 'OPEN_ADD' })
          return
        } else if (item.type === 'rule') {
          dispatch({ type: 'OPEN_DELETE_RULE', kind: item.kind, entry: item.entry })
          return
        } else {
          dispatch({ type: 'OPEN_DELETE_DIR', entry: item.entry })
          return
        }
      }

      return
    }

    if (s.view === 'confirmDeleteRule' || s.view === 'confirmDeleteDir') {
      const cursor = s.confirmCursor
      if (delta !== 0) {
        const next = (cursor ^ 1) as 0 | 1
        dispatch({ type: 'MOVE_CONFIRM_CURSOR', next })
        return
      }

      if (isEnter) {
        if (cursor === 1) {
          cancelToList()
          return
        }

        if (s.view === 'confirmDeleteRule') {
          void deleteRule({ rule: s.entry.rule, kind: s.kind, scope: s.entry.scope })
          cancelToList()
          return
        }

        void deleteWorkspaceDir({ dir: s.entry.dir, scope: s.entry.scope })
        cancelToList()
        return
      }

      return
    }

    if (s.view === 'addRule') return

    if (s.view === 'addDirectory') return

    const max = Math.max(0, SAVE_SCOPE_OPTIONS.length - 1)
    const cursor = clamp(s.saveScopeCursor, 0, max)

    if (delta !== 0) {
      dispatch({ type: 'MOVE_SAVE_SCOPE_CURSOR', next: clamp(cursor + delta, 0, max) })
      return
    }

    if (isEnter) {
      void commitRule(s.rule, s.kind, SAVE_SCOPE_OPTIONS[cursor].scope)
      cancelToList()
      return
    }
  })

  const searchEnabled = state.view === 'list' && state.searching
  const onSearchChange = useCallback((value: string) => dispatch({ type: 'SET_SEARCH_QUERY', query: value }), [])

  const content = useMemo((): React.ReactNode => {
    if (state.view === 'confirmDeleteRule') {
      const rule = state.entry.rule
      const scopeLabel = formatScopeLabel(state.entry.scope)
      return (
        <ConfirmDeleteView
          theme={theme}
          title="Delete allowed tool?"
          details={
            <Box flexDirection="column">
              <Text bold>{rule}</Text>
              <Text color={theme.secondaryText}>From {scopeLabel}</Text>
            </Box>
          }
          prompt="Are you sure you want to delete this permission rule?"
          cursor={state.confirmCursor}
        />
      )
    }

    if (state.view === 'confirmDeleteDir') {
      const dir = state.entry.dir
      const sourceLabel = formatWorkspaceSourceLabel(state.entry)
      return (
        <ConfirmDeleteView
          theme={theme}
          title="Delete workspace directory?"
          details={
            <Box flexDirection="column">
              <Text bold>{dir}</Text>
              <Text color={theme.secondaryText}>From {sourceLabel}</Text>
            </Box>
          }
          prompt="Are you sure you want to remove this directory from the workspace?"
          cursor={state.confirmCursor}
        />
      )
    }

    if (state.view === 'saveRule') {
      const items = SAVE_SCOPE_OPTIONS.map((opt) => ({ key: opt.scope, label: opt.label }))
      const cursor = clamp(state.saveScopeCursor, 0, Math.max(0, items.length - 1))
      return (
        <SaveScopeView
          theme={theme}
          title="Where should this rule be saved?"
          items={items}
          cursor={cursor}
        />
      )
    }

    if (state.view === 'addRule') {
      return (
        <TextEntryView
          theme={theme}
          title="Enter permission rule"
          value={state.ruleInput}
          onChange={(v) => dispatch({ type: 'SET_RULE_INPUT', value: v })}
          onSubmit={() => dispatch({ type: 'SUBMIT_RULE' })}
          scope={SCOPE}
          placeholder="e.g., Bash(ls:*)"
        />
      )
    }

    if (state.view === 'addDirectory') {
      return (
        <TextEntryView
          theme={theme}
          title="Add directory to workspace"
          value={state.dirInput}
          onChange={(v) => dispatch({ type: 'SET_DIR_INPUT', value: v })}
          onSubmit={(raw) => {
            void persistWorkspaceDirFromInput(raw, commitWorkspaceDir)
            dispatch({ type: 'SUBMIT_DIR' })
          }}
          scope={SCOPE}
          placeholder="e.g., ~/src or ./my-project"
        />
      )
    }

    return (
      <Box flexDirection="column">
        {searchEnabled ? <SearchRow query={state.searchQuery} onChange={onSearchChange} scope={SCOPE} /> : null}
        <Box marginTop={searchEnabled ? 1 : 0}>
          {state.tab === 'workspace' ? (
            <Box flexDirection="column" width="100%">
              <WorkspaceRootsView theme={theme} roots={[{ label: `${originalWorkingDir} (Original working directory)` }]} />
              <Box marginTop={1}>
                <ListView theme={theme} items={listItems} cursor={listCursor} />
              </Box>
            </Box>
          ) : (
            <ListView theme={theme} items={listItems} cursor={listCursor} />
          )}
        </Box>
      </Box>
    )
  }, [listCursor, listItems, onSearchChange, searchEnabled, state, theme])

  return (
    <DialogFrame theme={theme}>
      <Box flexDirection="column">
        <TabsBar theme={theme} activeTab={state.tab} />
        <Box marginTop={1} marginBottom={1}>{content}</Box>
        <FooterHint theme={theme} text="↑↓ to navigate · Enter to select · Tab to switch · Esc to go back" />
      </Box>
    </DialogFrame>
  )
}
