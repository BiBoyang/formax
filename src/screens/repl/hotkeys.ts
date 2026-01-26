import { useInput } from 'ink'
import { useScopedRoutedInput } from '../../features/repl/inputScopeContext'
import { nextReplMode, type ReplMode } from '../../features/repl/mode'
import type { ReplController } from '../../features/repl/useReplController'
import type { Msg } from '../../components/tool/ToolMessage'
import type { ToolRegistry } from '../../tools/registry'
import type { UserInputManager } from '../../tools/runtime/userInputManager'
import { findLastContiguousExploreTaskGroup } from './messageItems'

export function useReplHotkeys(args: {
  onExit?: () => void
  actions: ReplController['actions']

  ensurePlanPath: () => void
  setMode: (next: ReplMode | ((prev: ReplMode) => ReplMode)) => void

  isPromptMode: boolean
  userInput: UserInputManager | null
  toolRegistry?: ToolRegistry

  allMessages: Msg[]

  showDetailedTranscript: boolean
  setShowDetailedTranscript: (next: boolean) => void
  showExploreAgentsPanel: boolean
  setShowExploreAgentsPanel: (next: boolean) => void
  setDetailedTranscriptTargetId: (next: string | null) => void
  setShowThinking: (next: boolean | ((prev: boolean) => boolean)) => void

  state: {
    agentsDialogOpen: boolean
    permissionsDialogOpen: boolean
    hooksDialogOpen: boolean
    isLoading: boolean
    thinkingText: string
    transientMessages: Msg[]
  }

  slashSuggestions: Array<{ command?: string }>
  selectedSlash: { command?: string } | null
  setSlashSelectionTouched: (next: boolean) => void
  setSlashIndex: (next: number | ((prev: number) => number)) => void
  setInput: (next: string) => void
}): void {
  const {
    onExit,
    actions,
    ensurePlanPath,
    setMode,
    isPromptMode,
    allMessages,
    showDetailedTranscript,
    setShowDetailedTranscript,
    showExploreAgentsPanel,
    setShowExploreAgentsPanel,
    setDetailedTranscriptTargetId,
    setShowThinking,
    state,
    slashSuggestions,
    selectedSlash,
    setSlashSelectionTouched,
    setSlashIndex,
    setInput,
  } = args

  useInput(
    (inputKey, key) => {
      if (key.ctrl && inputKey === 'c') {
        actions.abort()
        onExit ? onExit() : process.exit(0)
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
        if (isPromptMode) return true

        if (state.isLoading && state.thinkingText.trim()) {
          setShowThinking((v) => !v)
          return true
        }

        if (showDetailedTranscript) {
          setShowDetailedTranscript(false)
          return true
        }

        if (showExploreAgentsPanel) {
          setShowExploreAgentsPanel(false)
          return true
        }

        const lastMsg = allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
        const wantsExplorePanel =
          lastMsg?.role === 'assistant' && /^\d+\s+Explore agents\s+finished\b/.test(lastMsg.content || '')

        if (wantsExplorePanel) {
          const lastExploreGroup = findLastContiguousExploreTaskGroup(allMessages)
          if (lastExploreGroup && lastExploreGroup.tasks.length >= 2) {
            setShowExploreAgentsPanel(true)
            return true
          }
        }

        const lastTaskWithTranscript = [...allMessages].reverse().find((m) => {
          if (m.role !== 'tool') return false
          if (m.toolInfo?.name !== 'Task') return false
          return Array.isArray(m.toolInfo?.transcriptLines) && m.toolInfo.transcriptLines.length > 0
        })

        if (lastTaskWithTranscript) {
          setDetailedTranscriptTargetId(lastTaskWithTranscript.id)
          setShowDetailedTranscript(true)
        }
        return true
      }

    if (key.escape) {
      if (state.agentsDialogOpen) return true
      if (state.permissionsDialogOpen) return true
      if (state.hooksDialogOpen) return true
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
