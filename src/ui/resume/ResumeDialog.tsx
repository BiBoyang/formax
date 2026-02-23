import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../components/ui/TextInput.js'
import { ApprovalHeader } from '../../components/ui/ApprovalHeader.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getInputToken, getVerticalArrowKeyDelta, isReturnKeyToken } from '../../features/repl/keys/keyTokens.js'
import { listResumeDialogSessions, loadResumeDialogPreview, type ResumeSessionSummary } from '../../features/commands/resumeDialogService.js'
import { getTheme } from '../../utils/theme.js'

import { MAX_SESSIONS, MAX_VISIBLE_SESSIONS, RESUME_SCOPE } from './constants.js'
import { dialogReducer, initialDialogState } from './reducer.js'
import type { PreviewRow } from './types.js'
import {
  buildPreviewRows,
  clamp,
  computeResumeListView,
  formatRelativeTime,
  matchesQuery,
  normalizePromptText,
} from './utils.js'

export type ResumeDialogExit = { kind: 'dismissed' }

export function ResumeDialog(args: {
  onExit: (exit: ResumeDialogExit) => void
  onResume: (filePath: string) => void | Promise<void>
  onRename: (filePath: string, label: string) => Promise<void>
  cwd?: string
}): React.ReactNode {
  useScopeActivation(RESUME_SCOPE)
  const theme = useMemo(() => getTheme(), [])
  const cwd = args.cwd ?? process.cwd()

  const [dialog, dispatch] = useReducer(dialogReducer, undefined, initialDialogState)

  const [sessions, setSessions] = useState<ResumeSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)

  const escapeBufferRef = useRef('')
  const escapeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorRef = useRef(0)
  const viewRef = useRef(dialog.view)

  const cursor = dialog.view.cursor
  const includeAllProjects = dialog.view.includeAllProjects
  const showBranch = dialog.view.showBranch
  const previewActive = dialog.view.previewActive
  const searchActive = dialog.view.kind === 'search'
  const searchQuery = dialog.view.kind === 'search' ? dialog.view.query : ''
  const renaming = dialog.view.kind === 'rename'
  const renameValue = dialog.view.kind === 'rename' ? dialog.view.value : ''

  cursorRef.current = cursor
  viewRef.current = dialog.view

  const reloadSessions = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await listResumeDialogSessions({
        cwd,
        includeAllProjects,
        limit: MAX_SESSIONS,
      })
      setSessions(next)
      dispatch({ type: 'SET_CURSOR', cursor: clamp(cursorRef.current, 0, Math.max(0, next.length - 1)) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }, [cwd, includeAllProjects])

  useEffect(() => {
    void reloadSessions()
  }, [reloadSessions])

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => matchesQuery(s, searchQuery))
  }, [searchQuery, sessions])

  useEffect(() => {
    const max = Math.max(0, filteredSessions.length - 1)
    const nextCursor = clamp(cursor, 0, max)
    if (nextCursor !== cursor) dispatch({ type: 'SET_CURSOR', cursor: nextCursor })
  }, [cursor, filteredSessions.length])

  const selected = filteredSessions[cursor] ?? null

  const setPreviewForSelected = useCallback(async () => {
    if (!selected) {
      setPreviewRows(null)
      return
    }
    try {
      const preview = await loadResumeDialogPreview(selected.filePath, { maxMessages: 6 })
      const title = selected.label ?? normalizePromptText(selected.lastUserPrompt)
      setPreviewRows(buildPreviewRows({ title, rows: preview }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPreviewRows([{ key: 'err', text: `Preview unavailable: ${msg}`, dim: true }])
    }
  }, [selected])

  useEffect(() => {
    if (!previewActive) {
      setPreviewRows(null)
      return
    }
    void setPreviewForSelected()
  }, [previewActive, setPreviewForSelected, selected?.filePath])

  const enterRenameMode = useCallback(() => {
    if (!selected) return
    dispatch({
      type: 'ENTER_RENAME',
      value: selected.label ?? normalizePromptText(selected.lastUserPrompt),
    })
  }, [selected])

  const exitRenameMode = useCallback(() => {
    dispatch({ type: 'EXIT_RENAME' })
  }, [])

  const submitRename = useCallback(
    async (labelRaw: string) => {
      const label = String(labelRaw ?? '').trim()
      if (!selected || !label) {
        exitRenameMode()
        return
      }
      await args.onRename(selected.filePath, label)
      exitRenameMode()
      await reloadSessions()
    },
    [args, exitRenameMode, reloadSessions, selected],
  )

  useScopedInput(RESUME_SCOPE, (input, key) => {
    const cleanupEscapeFallback = () => {
      const t = escapeFallbackTimerRef.current
      if (t) clearTimeout(t)
      escapeFallbackTimerRef.current = null
    }

    cleanupEscapeFallback()

    const token = getInputToken({ input, key })
    const keyDelta = getVerticalArrowKeyDelta(key)
    const hasArrowKeyDelta = keyDelta !== 0

    let bufferedDelta = 0
    if (!hasArrowKeyDelta && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending && res.delta === 0) return
      bufferedDelta = res.delta
    }

    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    if (key.escape && !token) {
      // Ink can deliver arrow keys as split chunks; the first chunk can be only ESC with no input/sequence.
      // Buffer it briefly to avoid treating it as a dialog Escape.
      escapeBufferRef.current = '\u001B'
      escapeFallbackTimerRef.current = setTimeout(() => {
        escapeFallbackTimerRef.current = null
        escapeBufferRef.current = ''

        const view = viewRef.current
        if (view.kind === 'rename') {
          dispatch({ type: 'EXIT_RENAME' })
          return
        }
        if (view.kind === 'search') {
          dispatch({ type: 'EXIT_SEARCH' })
          return
        }
        args.onExit({ kind: 'dismissed' })
      }, 25)
      return
    }

    if (renaming) {
      // TextInput consumes typing/enter; Esc is handled above.
      return
    }

    if (searchActive) {
      if (token === '/') {
        dispatch({ type: 'EXIT_SEARCH' })
        return
      }
      return
    }

    if (token === 'a' || token === 'A') {
      dispatch({ type: 'TOGGLE_ALL_PROJECTS' })
      return
    }

    if (token === 'b' || token === 'B') {
      dispatch({ type: 'TOGGLE_BRANCH' })
      return
    }

    if (token === 'p' || token === 'P') {
      dispatch({ type: 'TOGGLE_PREVIEW' })
      return
    }

    if (token === 'r' || token === 'R') {
      enterRenameMode()
      return
    }

    if (token === '/') {
      dispatch({ type: 'ENTER_SEARCH' })
      return
    }

    if (delta !== 0) {
      const max = Math.max(0, filteredSessions.length - 1)
      // Use a ref so rapid arrow repeats don't drop movements under React batching.
      const nextCursor = clamp(cursorRef.current + delta, 0, max)
      cursorRef.current = nextCursor
      dispatch({ type: 'SET_CURSOR', cursor: nextCursor })
      return
    }

    if (isReturnKeyToken({ token, key })) {
      if (!selected) return
      void args.onResume(selected.filePath)
    }
  })

  const view = useMemo(() => {
    return computeResumeListView({ items: filteredSessions, cursor, maxVisible: MAX_VISIBLE_SESSIONS })
  }, [cursor, filteredSessions])

  return (
    <Box flexDirection="column">
      <ApprovalHeader title="Resume Session" />

      {loading ? (
        <Box>
          <Text color={theme.secondaryText}>Loading sessions…</Text>
        </Box>
      ) : loadError ? (
        <Box>
          <Text color={theme.error}>Error: {loadError}</Text>
        </Box>
      ) : filteredSessions.length === 0 ? (
        <Box>
          <Text color={theme.secondaryText}>No sessions found.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {view.hasMoreAbove ? (
            <Text color={theme.secondaryText}>{`↑ ${view.total}`}</Text>
          ) : null}

          {view.visible.map((s, idx) => {
            const absIndex = view.top + idx
            const active = absIndex === cursor
            const prefix = active ? '❯ ' : '  '

            const title = s.label ?? normalizePromptText(s.lastUserPrompt)
            const seconds = formatRelativeTime(s.updatedAt)
            const count = typeof s.messageCount === 'number' ? `${s.messageCount} messages` : '? messages'
            const branch = showBranch && s.meta.gitBranch ? ` · ${s.meta.gitBranch}` : ''
            const details = `${seconds} · ${count}${branch}`

            return (
              <Box key={s.filePath} flexDirection="column">
                <Text color={active ? theme.permission : theme.text}>{prefix}{title}</Text>
                <Text color={theme.secondaryText}>{`  ${details}`}</Text>
                <Box height={1} />
              </Box>
            )
          })}

          {view.hasMoreBelow ? (
            <Text color={theme.secondaryText}>{`↓ ${view.total}`}</Text>
          ) : null}
        </Box>
      )}

      {previewActive && previewRows ? (
        <Box flexDirection="column" marginTop={1}>
          {previewRows.map((r) => (
            <Text key={r.key} color={r.dim ? theme.secondaryText : theme.text}>
              {r.text}
            </Text>
          ))}
        </Box>
      ) : null}

      {searchActive ? (
        <Box marginTop={1}>
          <Text>Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={(query) => dispatch({ type: 'SET_SEARCH_QUERY', query })}
            cursorStyle="bar"
            reservedChars={['/']}
            scope={RESUME_SCOPE}
          />
        </Box>
      ) : renaming ? (
        <Box marginTop={1}>
          <Text>Rename: </Text>
          <TextInput
            value={renameValue}
            onChange={(value) => dispatch({ type: 'SET_RENAME_VALUE', value })}
            onSubmit={(v) => void submitRename(v)}
            cursorStyle="bar"
            scope={RESUME_SCOPE}
          />
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.secondaryText}>
          {'A to show all projects · B to toggle branch · P to preview · R to rename · / to search · Esc to cancel'}
        </Text>
      </Box>
    </Box>
  )
}
