import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { getWebSupportedSlashCommandSpecs, type WebSupportedSlashCommandSpec } from '../../app/core/commandSupport'
import { resolveCommandRouting } from '../../semantics'

const WEB_SUPPORTED_SLASH_COMMANDS = getWebSupportedSlashCommandSpecs()

function filterSlashCommandSpecs(
  specs: readonly WebSupportedSlashCommandSpec[],
  query: string,
): WebSupportedSlashCommandSpec[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return Array.from(specs)

  return specs
    .map((spec) => {
      const normalizedCommand = spec.command.slice(1).toLowerCase()
      if (normalizedCommand.startsWith(normalizedQuery)) {
        return { spec, rank: 0 as const }
      }
      if (normalizedCommand.includes(normalizedQuery)) {
        return { spec, rank: 1 as const }
      }
      return null
    })
    .filter((entry): entry is { spec: WebSupportedSlashCommandSpec; rank: 0 | 1 } => entry != null)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.spec.command.localeCompare(b.spec.command)
    })
    .map((entry) => entry.spec)
}

function buildSlashCommandInput(currentInput: string, command: string): string {
  const leadingWhitespaceMatch = currentInput.match(/^\s*/)
  const leadingWhitespace = leadingWhitespaceMatch?.[0] ?? ''
  const trimmedStart = currentInput.slice(leadingWhitespace.length)
  if (!trimmedStart.startsWith('/')) {
    return `${command} `
  }

  const firstWhitespaceIndex = trimmedStart.search(/\s/)
  if (firstWhitespaceIndex === -1) {
    return `${leadingWhitespace}${command} `
  }

  const args = trimmedStart.slice(firstWhitespaceIndex).trimStart()
  if (!args) {
    return `${leadingWhitespace}${command} `
  }
  return `${leadingWhitespace}${command} ${args}`
}

type UseSlashCommandStateParams = {
  inputText: string
  onInputTextChange: (value: string) => void
}

export type UseSlashCommandStateResult = {
  composerRootRef: RefObject<HTMLDivElement | null>
  slashQuery: string | null
  slashCommandSpecs: WebSupportedSlashCommandSpec[]
  isSlashMenuVisible: boolean
  slashSelectionIndex: number
  setSlashSelectionIndex: Dispatch<SetStateAction<number>>
  applySlashCommandSelection: (command: string) => void
  toggleSlashMenu: () => void
  closeSlashMenu: () => void
}

export function useSlashCommandState(params: UseSlashCommandStateParams): UseSlashCommandStateResult {
  const [isSlashMenuPinnedOpen, setIsSlashMenuPinnedOpen] = useState(false)
  const [isSlashAutoOpenSuppressed, setIsSlashAutoOpenSuppressed] = useState(false)
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0)
  const composerRootRef = useRef<HTMLDivElement | null>(null)

  const commandRouting = useMemo(
    () => resolveCommandRouting(params.inputText),
    [params.inputText],
  )
  const slashQuery = useMemo(() => {
    if (!commandRouting.isSlashCommandAfterTrim) return null
    if ((commandRouting.commandArgs ?? '').length > 0) return null
    return (commandRouting.commandName ?? '').slice(1)
  }, [commandRouting.commandArgs, commandRouting.commandName, commandRouting.isSlashCommandAfterTrim])

  const slashCommandSpecs = useMemo(() => {
    if (isSlashMenuPinnedOpen && slashQuery == null) {
      return WEB_SUPPORTED_SLASH_COMMANDS
    }
    return filterSlashCommandSpecs(WEB_SUPPORTED_SLASH_COMMANDS, slashQuery ?? '')
  }, [isSlashMenuPinnedOpen, slashQuery])

  const isSlashMenuVisible = isSlashMenuPinnedOpen || (slashQuery != null && !isSlashAutoOpenSuppressed)

  useEffect(() => {
    if (!isSlashAutoOpenSuppressed) return
    if (slashQuery == null) {
      setIsSlashAutoOpenSuppressed(false)
      return
    }
    if (params.inputText.trim() === (commandRouting.commandName ?? '')) {
      return
    }
    setIsSlashAutoOpenSuppressed(false)
  }, [commandRouting.commandName, isSlashAutoOpenSuppressed, params.inputText, slashQuery])

  useEffect(() => {
    if (slashCommandSpecs.length === 0) {
      setSlashSelectionIndex(0)
      return
    }
    setSlashSelectionIndex((previous) => Math.min(previous, slashCommandSpecs.length - 1))
  }, [slashCommandSpecs.length])

  useEffect(() => {
    if (!isSlashMenuPinnedOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (composerRootRef.current?.contains(target)) return
      setIsSlashMenuPinnedOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isSlashMenuPinnedOpen])

  const focusComposerInput = useCallback(() => {
    const input = composerRootRef.current?.querySelector('textarea')
    input?.focus()
  }, [])

  const applySlashCommandSelection = useCallback((command: string) => {
    params.onInputTextChange(buildSlashCommandInput(params.inputText, command))
    setIsSlashMenuPinnedOpen(false)
    setIsSlashAutoOpenSuppressed(true)
    window.requestAnimationFrame(() => {
      focusComposerInput()
    })
  }, [focusComposerInput, params.inputText, params.onInputTextChange])

  const toggleSlashMenu = useCallback(() => {
    setSlashSelectionIndex(0)
    setIsSlashMenuPinnedOpen((previous) => !previous)
    window.requestAnimationFrame(() => {
      focusComposerInput()
    })
  }, [focusComposerInput])

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuPinnedOpen(false)
    setIsSlashAutoOpenSuppressed(true)
  }, [])

  return {
    composerRootRef,
    slashQuery,
    slashCommandSpecs,
    isSlashMenuVisible,
    slashSelectionIndex,
    setSlashSelectionIndex,
    applySlashCommandSelection,
    toggleSlashMenu,
    closeSlashMenu,
  }
}
