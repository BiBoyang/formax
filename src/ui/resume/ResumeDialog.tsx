import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from '../../components/ui/TextInput.js'
import { ApprovalHeader } from '../../tools/presenters/ApprovalHeader.js'
import { useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getTheme } from '../../utils/theme.js'
import type { SessionSummary } from '../../features/repl/sessionSave/reader.js'
import { listRecentSessions, readSessionPreview } from '../../features/repl/sessionSave/reader.js'

const SCOPE = 'overlay:resume' as const
const MAX_VISIBLE = 15
const MAX_SESSIONS = 200

type PreviewRow = { key: string; text: string; dim?: boolean }

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

function formatRelativeTime(then: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - then.getTime())
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec || 1} seconds ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minutes ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hours ago`
  const day = Math.floor(hr / 24)
  return `${day} days ago`
}

function normalizePromptText(value: string | null): string {
  const t = typeof value === 'string' ? value.trim() : ''
  return t ? t : 'No prompt'
}

function matchesQuery(summary: SessionSummary, queryRaw: string): boolean {
  const q = queryRaw.trim().toLowerCase()
  if (!q) return true
  const parts = [
    summary.label ?? '',
    summary.lastUserPrompt ?? '',
    summary.meta.gitBranch ?? '',
    summary.meta.cwd ?? '',
    summary.meta.cwdReal ?? '',
  ]
  return parts.some((p) => String(p).toLowerCase().includes(q))
}

function buildPreviewRows(args: {
  title: string
  rows: Array<{ role: string; text: string }>
}): PreviewRow[] {
  const out: PreviewRow[] = [{ key: 'title', text: args.title, dim: true }]
  for (let i = 0; i < args.rows.length; i++) {
    const r = args.rows[i]
    const prefix = r.role === 'user' ? '> ' : r.role === 'assistant' ? '⏺ ' : ''
    out.push({ key: `${i}-${r.role}`, text: `${prefix}${r.text}` })
  }
  return out
}

export type ResumeDialogExit = { kind: 'dismissed' }

export function ResumeDialog(args: {
  onExit: (exit: ResumeDialogExit) => void
  onResume: (filePath: string) => void | Promise<void>
  onRename: (filePath: string, label: string) => Promise<void>
  cwd?: string
}): React.ReactNode {
  useScopeActivation(SCOPE)
  const theme = useMemo(() => getTheme(), [])
  const cwd = args.cwd ?? process.cwd()

  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [includeAllProjects, setIncludeAllProjects] = useState(false)
  const [showBranch, setShowBranch] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [searchActive, setSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewActive, setPreviewActive] = useState(false)
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const escapeBufferRef = useRef('')
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  const reloadSessions = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const next = await listRecentSessions({
        cwd,
        includeAllProjects,
        limit: MAX_SESSIONS,
      })
      setSessions(next)
      setCursor((prev) => clamp(prev, 0, Math.max(0, next.length - 1)))
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
    const nextCursor = clamp(cursorRef.current, 0, max)
    if (nextCursor !== cursorRef.current) setCursor(nextCursor)
  }, [filteredSessions.length])

  const selected = filteredSessions[cursor] ?? null

  const setPreviewForSelected = useCallback(async () => {
    if (!selected) {
      setPreviewRows(null)
      return
    }
    try {
      const preview = await readSessionPreview(selected.filePath, { maxMessages: 6 })
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
    setRenaming(true)
    setRenameValue(selected.label ?? normalizePromptText(selected.lastUserPrompt))
  }, [selected])

  const exitRenameMode = useCallback(() => {
    setRenaming(false)
    setRenameValue('')
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

  useScopedInput(SCOPE, (input, key) => {
    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''

    const isUpArrow = keyName === 'up' || Boolean((key as any)?.upArrow)
    const isDownArrow = keyName === 'down' || Boolean((key as any)?.downArrow)

    let bufferedDelta = 0
    if (!isUpArrow && !isDownArrow && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending && res.delta === 0) return
      bufferedDelta = res.delta
    }

    const keyDelta = isUpArrow ? -1 : isDownArrow ? 1 : 0
    const delta = keyDelta !== 0 ? keyDelta : bufferedDelta

    if (key.escape && !token) {
      escapeBufferRef.current = ''
      if (renaming) {
        exitRenameMode()
        return
      }
      if (searchActive) {
        setSearchActive(false)
        setSearchQuery('')
        return
      }
      args.onExit({ kind: 'dismissed' })
      return
    }

    if (renaming) {
      // TextInput consumes typing/enter; Esc is handled above.
      return
    }

    if (searchActive) {
      if (token === '/') {
        setSearchActive(false)
        setSearchQuery('')
        return
      }
      return
    }

    if (token === 'a' || token === 'A') {
      setIncludeAllProjects((v) => !v)
      return
    }

    if (token === 'b' || token === 'B') {
      setShowBranch((v) => !v)
      return
    }

    if (token === 'p' || token === 'P') {
      setPreviewActive((v) => !v)
      return
    }

    if (token === 'r' || token === 'R') {
      enterRenameMode()
      return
    }

    if (token === '/') {
      setSearchActive(true)
      setSearchQuery('')
      return
    }

    if (delta !== 0) {
      const max = Math.max(0, filteredSessions.length - 1)
      setCursor((prev) => clamp(prev + delta, 0, max))
      return
    }

    if (key.return || token === '\r' || token === '\n') {
      if (!selected) return
      void args.onResume(selected.filePath)
    }
  })

  const view = useMemo(() => {
    const items = filteredSessions
    const maxTop = Math.max(0, items.length - MAX_VISIBLE)
    let top = 0
    if (cursor <= 0) top = 0
    else if (cursor > MAX_VISIBLE - 1) top = clamp(cursor - (MAX_VISIBLE - 1), 0, maxTop)

    const visible = items.slice(top, top + MAX_VISIBLE)
    const hasMoreAbove = top > 0
    const hasMoreBelow = top + MAX_VISIBLE < items.length

    return { top, visible, hasMoreAbove, hasMoreBelow, total: items.length }
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
            onChange={setSearchQuery}
            cursorStyle="bar"
            reservedChars={['/']}
            scope={SCOPE}
          />
        </Box>
      ) : renaming ? (
        <Box marginTop={1}>
          <Text>Rename: </Text>
          <TextInput
            value={renameValue}
            onChange={setRenameValue}
            onSubmit={(v) => void submitRename(v)}
            cursorStyle="bar"
            scope={SCOPE}
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
