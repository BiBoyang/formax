import { useInput } from 'ink'
import { useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { nextReplMode, type ReplMode } from '../../features/repl/mode'
import type { ReplController } from '../../features/repl/useReplController'
import type { Msg } from '../../components/tool/ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import type { UserInputManager } from '../../tools/runtime/userInputManager'

export function handleCtrlCKeypress(args: {
  onExit?: () => void
  ctrlCArmedUntilMs: number | null
  setCtrlCArmedUntilMs: (next: number | null) => void
  setInput: (next: string) => void
  setSlashIndex: (next: number | ((prev: number) => number)) => void
  setSlashSelectionTouched: (next: boolean) => void
  nowMs?: number
  windowMs?: number
}): 'armed' | 'exit' {
  const windowMs = args.windowMs ?? 2000
  const now = args.nowMs ?? Date.now()

  if (args.ctrlCArmedUntilMs !== null && now < args.ctrlCArmedUntilMs) {
    args.onExit ? args.onExit() : process.exit(0)
    return 'exit'
  }

  // Clear prompt so suggestions disappear and the hint is visible (matches CC).
  args.setInput('')
  args.setSlashIndex(0)
  args.setSlashSelectionTouched(false)
  args.setCtrlCArmedUntilMs(now + windowMs)
  return 'armed'
}

export function useReplHotkeys(args: {
  onExit?: () => void
  actions: ReplController['actions']

  ensurePlanPath: () => void
  setMode: (next: ReplMode | ((prev: ReplMode) => ReplMode)) => void

  isPromptMode: boolean
  userInput: UserInputManager | null
  toolRegistry?: ToolRegistry

  allMessages: Msg[]

  expandedTranscriptOpen: boolean
  setExpandedTranscriptOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  expandedTranscriptHideHistory: boolean
  setExpandedTranscriptHideHistory: (next: boolean | ((prev: boolean) => boolean)) => void

  state: {
    agentsDialogOpen: boolean
    permissionsDialogOpen: boolean
    hooksDialogOpen: boolean
    configDialogOpen?: boolean
    isLoading: boolean
    thinkingText: string
    transientMessages: Msg[]
  }

  slashSuggestions: Array<{ command?: string }>
  selectedSlash: { command?: string } | null
  setSlashSelectionTouched: (next: boolean) => void
  setSlashIndex: (next: number | ((prev: number) => number)) => void
  setInput: (next: string) => void

  ctrlCArmedUntilMs: number | null
  setCtrlCArmedUntilMs: (next: number | null) => void
}): void {
  const {
    onExit,
    actions,
    ensurePlanPath,
    setMode,
    isPromptMode,
    expandedTranscriptOpen,
    setExpandedTranscriptOpen,
    setExpandedTranscriptHideHistory,
    state,
    slashSuggestions,
    selectedSlash,
    setSlashSelectionTouched,
    setSlashIndex,
    setInput,
    ctrlCArmedUntilMs,
    setCtrlCArmedUntilMs,
  } = args

  useInput(
    (inputKey, key) => {
      if (key.ctrl && inputKey === 'c') {
        // Match CC: first Ctrl+C arms exit (and clears the prompt), second exits.
        // This does NOT change REPL mode (e.g. accept edits stays accept edits).
        // NOTE: Intentionally does NOT abort the in-flight run; Esc remains the interrupt gesture.
        handleCtrlCKeypress({
          onExit,
          ctrlCArmedUntilMs,
          setCtrlCArmedUntilMs,
          setInput,
          setSlashIndex,
          setSlashSelectionTouched,
        })
        return
      }
    },
    { isActive: true },
  )

  useScopedRoutedInput(
    'repl',
    (inputKey, key) => {
      if (key.ctrl && inputKey === 'o') {
        if (state.agentsDialogOpen) return true
        if (state.permissionsDialogOpen) return true
        if (state.hooksDialogOpen) return true
        if (state.configDialogOpen) return true
        if (isPromptMode) return true

        setExpandedTranscriptOpen(!expandedTranscriptOpen)
        actions.resetTranscriptSurface()
        return true
      }

      if (key.ctrl && inputKey === 'e') {
        if (!expandedTranscriptOpen) return false
        if (state.agentsDialogOpen) return true
        if (state.permissionsDialogOpen) return true
        if (state.hooksDialogOpen) return true
        if (state.configDialogOpen) return true
        if (isPromptMode) return true

        setExpandedTranscriptHideHistory((prev) => !prev)
        return true
      }

      if (key.escape) {
        if (state.agentsDialogOpen) return true
        if (state.permissionsDialogOpen) return true
        if (state.hooksDialogOpen) return true
        if (state.configDialogOpen) return true
        actions.abort()
        return true
      }

      if (isPromptMode) return false

      if (key.shift && key.tab) {
        setMode((m) => {
          const next = nextReplMode(m)
          if (next === 'plan') ensurePlanPath()
          return next
        })
        return true
      }

      return false
    },
    { group: 'command', priority: 0 },
  )

  useScopedRoutedInput(
    'repl',
    (inputKey, key) => {
      if (isPromptMode) return false
      if (slashSuggestions.length === 0) return false

      if (key.downArrow) {
        setSlashSelectionTouched(true)
        setSlashIndex((i) => Math.min(i + 1, slashSuggestions.length - 1))
        return true
      }

      if (key.upArrow) {
        setSlashSelectionTouched(true)
        setSlashIndex((i) => Math.max(i - 1, 0))
        return true
      }

      if (key.tab || inputKey === '\t') {
        if (selectedSlash?.command) {
          setInput(selectedSlash.command)
          setSlashIndex(0)
        }
        return true
      }

      return false
    },
    { group: 'selector', priority: 10 },
  )
}
