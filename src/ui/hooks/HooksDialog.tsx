import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { createNodeFileStore } from '../../adapters/fs/nodeFileStore.js'
import { useInputScope, useScopeActivation, useScopedInput } from '../../features/repl/inputScopeContext.js'
import { consumeBufferedArrow } from '../../features/repl/keys/escapeSequences.js'
import { getTheme } from '../../utils/theme.js'
import type { HookEventName, HookRuleEntry, HookSource } from '../../hooks/types.js'
import type { HookMatcherSummary, HooksBySource } from '../../hooks/store.js'
import { eventUsesMatcher, loadHooksBySource } from '../../hooks/store.js'
import { deleteHookCommand, persistHookCommand } from '../../hooks/settingsStore.js'
import { HOOK_EVENTS, isEnabledHookEventName, MATCHER_VALUES, SAVE_SCOPE_OPTIONS } from './constants.js'
import { dialogReducer, initialDialogState, type DialogState } from './reducer.js'
import { clamp, formatSourceLabel, groupHookEntriesByMatcher } from './utils.js'
import { AddHookView, AddMatcherView, ConfirmDeleteView, EventListView, HookListView, MatcherListView, SaveHookView } from './ui.js'

const SCOPE = 'overlay:hooks' as const
const INPUT_SCOPE = 'prompt:hooks-input' as const

type MatcherListItem =
  | { type: 'add' }
  | { type: 'matcher'; source: HookSource; matcher: string }

type HookListItem =
  | { type: 'add' }
  | { type: 'hook'; entry: HookRuleEntry }

function emptyHooksBySource(): HooksBySource {
  return {
    projectLocal: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
    project: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
    user: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
    matchersBySource: {
      projectLocal: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
      project: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
      user: { PreToolUse: [], PermissionRequest: [], PostToolUse: [], UserPromptSubmit: [], SessionStart: [], Stop: [] },
    },
    warnings: [],
  }
}

export function HooksDialog({ onExit }: { onExit: () => void }): React.ReactNode {
  useScopeActivation(SCOPE)
  const { push: pushScope, pop: popScope } = useInputScope()

  const theme = useMemo(() => getTheme(), [])
  const fileStore = useMemo(() => createNodeFileStore(), [])
  const originalWorkingDir = useMemo(() => process.cwd(), [])
  const [reloadKey, setReloadKey] = useState(0)

  const [hooksBySource, setHooksBySource] = useState<HooksBySource>(() => emptyHooksBySource())

  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await loadHooksBySource({ fileStore, cwd: originalWorkingDir, env: process.env })
      if (!alive) return
      setHooksBySource(loaded)
    })()
    return () => {
      alive = false
    }
  }, [fileStore, originalWorkingDir, reloadKey])

  const [state, dispatch] = useReducer(dialogReducer, undefined, initialDialogState)

  const stateRef = useRef<DialogState>(state)
  stateRef.current = state

  const matcherListItems = useMemo(
    (): { items: MatcherListItem[]; rows: Array<{ source: HookSource; matcher: string; hooksCount: number }> } => {
    const view = state.view
    if (view.kind !== 'matcherList') return { items: [], rows: [] }

    const sources: HookSource[] = ['projectLocal', 'project', 'user']
    const rows = sources.flatMap((source) => {
      const summaries: HookMatcherSummary[] = hooksBySource.matchersBySource?.[source]?.[view.event] ?? []
      if (summaries.length > 0) return summaries.map((s) => ({ source, matcher: s.matcher, hooksCount: s.hooksCount }))

      const entries = hooksBySource[source][view.event]
      return groupHookEntriesByMatcher(entries).map((g) => ({
        source,
        matcher: g.matcher,
        hooksCount: g.entries.length,
      }))
    })
    const items: MatcherListItem[] = [{ type: 'add' }, ...rows.map((r) => ({ type: 'matcher' as const, source: r.source, matcher: r.matcher }))]
    return { items, rows }
  }, [hooksBySource, state.view],
  )

  const hookListItems = useMemo((): { items: HookListItem[]; entries: HookRuleEntry[] } => {
    const view = state.view
    if (view.kind !== 'hookList') return { items: [], entries: [] }

    const sources: HookSource[] = ['projectLocal', 'project', 'user']
    const raw = eventUsesMatcher(view.event)
      ? hooksBySource[view.source][view.event]
      : sources.flatMap((source) => hooksBySource[source][view.event])
    const entries = raw.filter((e) => String(e.matcher ?? '').trim() === String(view.matcher ?? '').trim())

    const items: HookListItem[] = [{ type: 'add' }, ...entries.map((entry) => ({ type: 'hook' as const, entry }))]
    return { items, entries }
  }, [hooksBySource, state.view])

  const matcherItemsRef = useRef<MatcherListItem[]>(matcherListItems.items)
  const hookItemsRef = useRef<HookListItem[]>(hookListItems.items)

  matcherItemsRef.current = matcherListItems.items
  hookItemsRef.current = hookListItems.items

  const escapeBufferRef = useRef('')

  const close = useCallback(() => onExit(), [onExit])
  const back = useCallback(() => dispatch({ type: 'POP_VIEW' }), [])

  const handleInputScopeEscape = useCallback(
    (_input: string, key: any) => {
      if (key.escape) back()
    },
    [back],
  )

  // IMPORTANT: only depend on `view.kind` here.
  // `addMatcher/addHook` views update their `view` object on every keystroke (controlled input).
  // If we depend on the whole `view`, we'd pop/push INPUT_SCOPE per keystroke → flicker + dropped keys.
  useLayoutEffect(() => {
    const viewKind = state.view.kind
    const wantsInputScope = viewKind === 'addMatcher' || viewKind === 'addHook'
    if (!wantsInputScope) {
      popScope(INPUT_SCOPE)
      return
    }

    pushScope(INPUT_SCOPE)
    return () => popScope(INPUT_SCOPE)
  }, [popScope, pushScope, state.view.kind])

  const eventCursorMax = Math.max(0, HOOK_EVENTS.length - 1)
  const matcherCursorMax = Math.max(0, matcherListItems.items.length - 1)
  const hookCursorMax = Math.max(0, hookListItems.items.length - 1)

  const cursorMaxForView = (s: DialogState): number => {
    switch (s.view.kind) {
      case 'eventList':
        return eventCursorMax
      case 'matcherList':
        return matcherCursorMax
      case 'hookList':
        return hookCursorMax
      case 'saveHook':
        return Math.max(0, SAVE_SCOPE_OPTIONS.length - 1)
      case 'confirmDeleteHook':
        return 1
      default:
        return 0
    }
  }

  const moveCursor = useCallback(
    (delta: number) => {
      const s = stateRef.current
      const max = cursorMaxForView(s)
      const currentCursor = 'cursor' in s.view ? (s.view as any).cursor : 0
      dispatch({ type: 'MOVE_CURSOR', cursor: clamp(currentCursor + delta, 0, max) })
    },
    [eventCursorMax, hookCursorMax, matcherCursorMax],
  )

  const normalizeMatcher = (raw: string): string => String(raw ?? '').trim()

  const openHookList = useCallback((event: HookEventName, source: HookSource, matcher: string) => {
    dispatch({
      type: 'PUSH_VIEW',
      view: { kind: 'hookList', event, source, matcher: normalizeMatcher(matcher), cursor: 0, banner: null },
    })
  }, [])

  const openMatcherList = useCallback(
    (event: HookEventName) => {
      if (!eventUsesMatcher(event)) {
        // Claude docs: matcher is optional for matcher-less events (e.g. UserPromptSubmit).
        // UI parity: skip the matcher screens entirely and go straight to the hook list.
        openHookList(event, 'projectLocal', '*')
        return
      }
      dispatch({ type: 'PUSH_VIEW', view: { kind: 'matcherList', event, cursor: 0, banner: null } })
    },
    [openHookList],
  )

  const openAddMatcher = useCallback((event: HookEventName) => {
    dispatch({ type: 'PUSH_VIEW', view: { kind: 'addMatcher', event, matcherInput: '' } })
  }, [])

  const openAddHook = useCallback((event: HookEventName, matcher: string) => {
    dispatch({ type: 'PUSH_VIEW', view: { kind: 'addHook', event, matcher: normalizeMatcher(matcher), commandInput: '' } })
  }, [])

  const openSaveHook = useCallback((event: HookEventName, matcher: string, command: string) => {
    dispatch({
      type: 'PUSH_VIEW',
      view: { kind: 'saveHook', event, matcher: normalizeMatcher(matcher), command: String(command ?? '').trim(), cursor: 0 },
    })
  }, [])

  const confirmDeleteHook = useCallback((args: { event: HookEventName; matcher: string; command: string; source: HookSource }) => {
    dispatch({
      type: 'PUSH_VIEW',
      view: {
        kind: 'confirmDeleteHook',
        event: args.event,
        matcher: normalizeMatcher(args.matcher),
        command: String(args.command ?? '').trim(),
        source: args.source,
        cursor: 0,
      },
    })
  }, [])

  useScopedInput(
    INPUT_SCOPE,
    handleInputScopeEscape,
    {
      enabled: state.view.kind === 'addMatcher' || state.view.kind === 'addHook',
    },
  )

  useScopedInput(
    SCOPE,
    (input, key) => {
    const s = stateRef.current

    const seq = (key as unknown as { sequence?: string } | undefined)?.sequence
    const token = (typeof seq === 'string' && seq.length > 0 ? seq : input) || ''
    const keyName = typeof (key as any)?.name === 'string' ? String((key as any).name) : ''
    const isEnter = Boolean(key.return) || keyName === 'return' || token === '\r' || token === '\n'

    if (key.escape || keyName === 'escape') {
      if (s.view.kind === 'eventList') close()
      else back()
      return
    }

    const isUpArrowKey = keyName === 'up' || Boolean((key as any)?.upArrow)
    const isDownArrowKey = keyName === 'down' || Boolean((key as any)?.downArrow)

    let bufferedUp = false
    let bufferedDown = false
    if (!isUpArrowKey && !isDownArrowKey && token) {
      const res = consumeBufferedArrow({ buffer: escapeBufferRef.current, chunk: token })
      escapeBufferRef.current = res.nextBuffer
      if (res.pending) return
      bufferedUp = res.arrow === 'up'
      bufferedDown = res.arrow === 'down'
    }

    const isUp = isUpArrowKey || bufferedUp || token === '\u001B[A' || token === '\u001BOA'
    const isDown = isDownArrowKey || bufferedDown || token === '\u001B[B' || token === '\u001BOB'

    if (s.view.kind === 'addMatcher' || s.view.kind === 'addHook') return

    if (isUp) {
      moveCursor(-1)
      return
    }
    if (isDown) {
      moveCursor(1)
      return
    }

    if (s.view.kind === 'confirmDeleteHook') {
      const view = s.view
      if (isEnter) {
        if (view.cursor === 1) {
          back()
          return
        }
        void (async () => {
          await deleteHookCommand({
            fileStore,
            cwd: originalWorkingDir,
            source: view.source,
            eventName: view.event,
            matcher: view.matcher,
            command: view.command,
            env: process.env,
          })
          setReloadKey((n) => n + 1)
          dispatch({ type: 'POP_VIEW' })
          dispatch({ type: 'SET_BANNER', banner: `Deleted hook from ${formatSourceLabel(view.source)} settings.` })
        })()
      }
      return
    }

    if (s.view.kind === 'saveHook') {
      const view = s.view
      if (isEnter) {
        const scope = SAVE_SCOPE_OPTIONS[view.cursor]?.scope
        if (!scope) return

        void (async () => {
          await persistHookCommand({
            fileStore,
            cwd: originalWorkingDir,
            source: scope,
            eventName: view.event,
            matcher: view.matcher,
            command: view.command,
            env: process.env,
          })
          setReloadKey((n) => n + 1)

          const eventIdx = Math.max(0, HOOK_EVENTS.findIndex((e) => e.id === view.event))
          const usesMatcher = eventUsesMatcher(view.event)
          dispatch({
            type: 'RESET_NAV',
            stack: usesMatcher
              ? [
                  { kind: 'eventList', cursor: eventIdx, banner: null },
                  { kind: 'matcherList', event: view.event, cursor: 0, banner: null },
                ]
              : [{ kind: 'eventList', cursor: eventIdx, banner: null }],
            view: {
              kind: 'hookList',
              event: view.event,
              source: scope,
              matcher: view.matcher,
              cursor: 0,
              banner: `Saved to ${scope}.`,
            },
          })
        })()
      }
      return
    }

    if (!isEnter) return

    if (s.view.kind === 'eventList') {
      const cursor = clamp(s.view.cursor, 0, eventCursorMax)
      const item = HOOK_EVENTS[cursor]
      if (!item) return

      if (!item.enabled) {
        dispatch({ type: 'SET_BANNER', banner: 'Not supported yet in Formax. Only the first five events are wired.' })
        return
      }

      if (!isEnabledHookEventName(item.id)) return
      openMatcherList(item.id)
      return
    }

    if (s.view.kind === 'matcherList') {
      const cursor = clamp(s.view.cursor, 0, matcherCursorMax)
      const item = matcherItemsRef.current[cursor]
      if (!item) return
      if (item.type === 'add') {
        openAddMatcher(s.view.event)
        return
      }
      openHookList(s.view.event, item.source, item.matcher)
      return
    }

    if (s.view.kind === 'hookList') {
      const cursor = clamp(s.view.cursor, 0, hookCursorMax)
      const item = hookItemsRef.current[cursor]
      if (!item) return
      if (item.type === 'add') {
        openAddHook(s.view.event, s.view.matcher)
        return
      }
      confirmDeleteHook({
        event: s.view.event,
        matcher: s.view.matcher,
        command: item.entry.command,
        source: item.entry.source,
      })
      return
    }
  },
  {
    enabled: state.view.kind !== 'addMatcher' && state.view.kind !== 'addHook',
  },
  )

  const view = state.view

  const content = (() => {
    if (view.kind === 'eventList') {
      const banner = view.banner || hooksBySource.warnings[0] || null
      return <EventListView theme={theme} events={HOOK_EVENTS} cursor={clamp(view.cursor, 0, eventCursorMax)} banner={banner} />
    }

    if (view.kind === 'matcherList') {
      return (
        <MatcherListView
          theme={theme}
          eventName={view.event}
          matchers={matcherListItems.rows}
          cursor={clamp(view.cursor, 0, matcherCursorMax)}
          banner={view.banner}
        />
      )
    }

    if (view.kind === 'addMatcher') {
      return (
        <AddMatcherView
          theme={theme}
          eventName={view.event}
          inputText={view.matcherInput}
          matcherValues={MATCHER_VALUES}
          inputScope={INPUT_SCOPE}
          onChange={(value) => dispatch({ type: 'SET_MATCHER_INPUT', value })}
          onSubmit={(value) => {
            const matcher = value.trim()
            if (!matcher) {
              dispatch({ type: 'POP_VIEW' })
              dispatch({ type: 'SET_BANNER', banner: 'Matcher cannot be empty. Use "*" to match all tools.' })
              return
            }
            openAddHook(view.event, matcher)
          }}
        />
      )
    }

    if (view.kind === 'hookList') {
      return (
        <HookListView
          theme={theme}
          eventName={view.event}
          matcher={view.matcher}
          showMatcher={eventUsesMatcher(view.event)}
          hooks={hookListItems.entries}
          cursor={clamp(view.cursor, 0, hookCursorMax)}
          banner={view.banner}
        />
      )
    }

    if (view.kind === 'addHook') {
      return (
        <AddHookView
          theme={theme}
          eventName={view.event}
          matcherName={view.matcher}
          showMatcher={eventUsesMatcher(view.event)}
          inputText={view.commandInput}
          inputScope={INPUT_SCOPE}
          onChange={(value) => dispatch({ type: 'SET_COMMAND_INPUT', value })}
          onSubmit={(value) => {
            const cmd = value.trim()
            if (!cmd) return
            // Ensure the next view can receive Enter/arrow keys immediately.
            popScope(INPUT_SCOPE)
            openSaveHook(view.event, view.matcher, cmd)
          }}
        />
      )
    }

    if (view.kind === 'saveHook') {
      return (
        <SaveHookView
          theme={theme}
          eventName={view.event}
          matcherName={view.matcher}
          showMatcher={eventUsesMatcher(view.event)}
          hookCommand={view.command}
          cursor={view.cursor}
        />
      )
    }

    if (view.kind === 'confirmDeleteHook') {
      return (
        <ConfirmDeleteView
          theme={theme}
          command={view.command}
          eventName={view.event}
          matcherName={view.matcher}
          showMatcher={eventUsesMatcher(view.event)}
          source={view.source}
          cursor={view.cursor}
        />
      )
    }

    return null
  })()

  return content
}
