import { useInput } from 'ink'
import { useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { nextReplMode, type ReplMode } from '../../features/repl/mode'
import { getInputToken, isCtrlChord, isDeleteOrBackspaceToken, isShiftTabToken } from '../../features/repl/keys/keyTokens'
import type { ReplController } from '../../features/repl/useReplController'
import type { Msg } from '../../components/tool/ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import type { UserInputManager } from '../../tools/runtime/userInputManager'

type ReplHotkeyUiState = {
  agentsDialogOpen: boolean
  permissionsDialogOpen: boolean
  hooksDialogOpen: boolean
  configDialogOpen?: boolean
  isLoading: boolean
  thinkingText: string
  transientMessages: Msg[]
}

function hasBlockingOverlay(state: ReplHotkeyUiState): boolean {
  if (state.agentsDialogOpen) return true
  if (state.permissionsDialogOpen) return true
  if (state.hooksDialogOpen) return true
  if (state.configDialogOpen) return true
  return false
}

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
  onToggleExpandedTranscript?: () => void
  setExpandedTranscriptOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  expandedTranscriptHideHistory: boolean
  setExpandedTranscriptHideHistory: (next: boolean | ((prev: boolean) => boolean)) => void

  state: ReplHotkeyUiState

  slashSuggestions: Array<{ command?: string }>
  selectedSlash: { command?: string } | null
  setSlashSelectionTouched: (next: boolean) => void
  setSlashIndex: (next: number | ((prev: number) => number)) => void
  input: string
  setInput: (next: string) => void
  queuedMessageCount?: number
  onRecallQueuedMessage?: () => void
  bashModeActive: boolean
  setBashModeActive: (next: boolean) => void

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
    onToggleExpandedTranscript,
    setExpandedTranscriptOpen,
    setExpandedTranscriptHideHistory,
    state,
    slashSuggestions,
    selectedSlash,
    setSlashSelectionTouched,
    setSlashIndex,
    input,
    setInput,
    queuedMessageCount = 0,
    onRecallQueuedMessage,
    bashModeActive,
    setBashModeActive,
    ctrlCArmedUntilMs,
    setCtrlCArmedUntilMs,
  } = args

  useInput(
    (inputKey, key) => {
      if (isCtrlChord({ input: inputKey, key, chord: 'c' })) {
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
      const token = getInputToken({ input: inputKey, key })
      const expandedToggleBlocked = hasBlockingOverlay(state) || isPromptMode

      if (isCtrlChord({ input: inputKey, key, chord: 'o' })) {
        if (expandedToggleBlocked) return true

        if (onToggleExpandedTranscript) {
          onToggleExpandedTranscript()
        } else {
          setExpandedTranscriptOpen(!expandedTranscriptOpen)
        }
        return true
      }

      if (isCtrlChord({ input: inputKey, key, chord: 'e' })) {
        if (!expandedTranscriptOpen) return false
        if (expandedToggleBlocked) return true

        setExpandedTranscriptHideHistory((prev) => !prev)
        return true
      }

      if (key.escape) {
        if (hasBlockingOverlay(state)) return true
        actions.abort()
        return true
      }

      if (isPromptMode) return false

      // Fallback for terminals/environments where TextInput-level onBackspaceAtStart
      // doesn't fire reliably: allow Backspace/Delete to leave one-shot bash mode when
      // the prompt is empty.
      if (bashModeActive && (input.length === 0 || input === '!')) {
        if (isDeleteOrBackspaceToken({ token, key })) {
          setInput('')
          setBashModeActive(false)
          return true
        }
      }

      if (isShiftTabToken({ token, key })) {
        setMode((m) => {
          const next = nextReplMode(m)
          if (next === 'plan') ensurePlanPath()
          return next
        })
        return true
      }

      // CC-style: pressing `!` enters a one-shot bash mode for a single command.
      // The `!` is a decoration (like `>`), not part of the input value.
      if (!bashModeActive && inputKey === '!' && !key.ctrl && !key.meta && !key.shift && !(key as any).alt) {
        if (input.length === 0) {
          // `!` is a mode trigger/decorator, not part of actual input text.
          // Clear any inserted `!` so Backspace-on-empty can reliably exit bash mode.
          setInput('')
          setBashModeActive(true)
          return true
        }
      }

      return false
    },
    { group: 'command', priority: 0 },
  )

  useScopedRoutedInput(
    'repl',
    (inputKey, key) => {
      if (isPromptMode) return false
      if (state.isLoading && queuedMessageCount > 0 && input.length === 0 && key.upArrow) {
        onRecallQueuedMessage?.()
        return true
      }
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

      const token = getInputToken({ input: inputKey, key })
      if (key.tab || token === '\t') {
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
