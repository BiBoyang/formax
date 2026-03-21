import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import type { ThreadViewModel } from '../core/threadViewModel'

export const TERMINAL_MIN_SIZE = 18
export const TERMINAL_MAX_SIZE = 60
const TERMINAL_DEFAULT_SIZE = 32

type DesktopTerminalBridge = NonNullable<NonNullable<Window['formaxDesktop']>['terminal']>

function clampTerminalHeight(sizePercent: number): number {
  return Math.max(TERMINAL_MIN_SIZE, Math.min(TERMINAL_MAX_SIZE, sizePercent))
}

export type UseTerminalVisibilityArgs = {
  activeThreadCwd: string | null | undefined
  activeThreadId: string | null
  isSettingsOpen: boolean
  selectedCwd: string | null
  sortedThreads: ThreadViewModel[]
  terminalBridge: DesktopTerminalBridge | null
  terminalPanelGroupRef: MutableRefObject<ImperativePanelGroupHandle | null>
}

export function useTerminalVisibility(args: UseTerminalVisibilityArgs) {
  const [terminalVisibleByThreadId, setTerminalVisibleByThreadId] = useState<Record<string, boolean>>({})
  const [residentTerminalThreadId, setResidentTerminalThreadId] = useState<string | null>(null)
  const [terminalHeightPercent, setTerminalHeightPercent] = useState(TERMINAL_DEFAULT_SIZE)

  const terminalVisibleByThreadIdRef = useRef<Record<string, boolean>>({})
  const terminalHeightRef = useRef(TERMINAL_DEFAULT_SIZE)
  const knownThreadIdsRef = useRef<Set<string>>(new Set(args.sortedThreads.map((thread) => thread.id)))
  const lastOpenTerminalHeightRef = useRef(clampTerminalHeight(TERMINAL_DEFAULT_SIZE))
  const isTerminalDraggingRef = useRef(false)

  const activeThreadTerminalVisible = args.activeThreadId ? terminalVisibleByThreadId[args.activeThreadId] === true : false
  const showTerminalPane = Boolean(args.terminalBridge && args.activeThreadId && activeThreadTerminalVisible && !args.isSettingsOpen)
  const terminalPaneThreadId = showTerminalPane && args.activeThreadId ? args.activeThreadId : residentTerminalThreadId
  const canToggleTerminal = Boolean(args.terminalBridge && args.activeThreadId)
  const previousTerminalOpenRef = useRef(showTerminalPane)

  useEffect(() => {
    terminalVisibleByThreadIdRef.current = terminalVisibleByThreadId
  }, [terminalVisibleByThreadId])

  useEffect(() => {
    terminalHeightRef.current = terminalHeightPercent
  }, [terminalHeightPercent])

  useEffect(() => {
    if (!showTerminalPane) return
    lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightPercent)
  }, [showTerminalPane, terminalHeightPercent])

  useEffect(() => {
    if (!args.terminalBridge) {
      setResidentTerminalThreadId(null)
      return
    }
    if (!showTerminalPane || !args.activeThreadId) return
    setResidentTerminalThreadId((previous) => (previous === args.activeThreadId ? previous : args.activeThreadId))
  }, [args.activeThreadId, args.terminalBridge, showTerminalPane])

  useEffect(() => {
    const panelGroup = args.terminalPanelGroupRef.current
    if (!panelGroup) return
    if (previousTerminalOpenRef.current === showTerminalPane) return
    previousTerminalOpenRef.current = showTerminalPane
    const currentLayout = panelGroup.getLayout()
    if (currentLayout.length < 2) return

    if (!showTerminalPane) {
      const currentTerminalHeight = currentLayout[1]
      if (typeof currentTerminalHeight === 'number' && Number.isFinite(currentTerminalHeight) && currentTerminalHeight > 0) {
        lastOpenTerminalHeightRef.current = clampTerminalHeight(currentTerminalHeight)
      }
      panelGroup.setLayout([100, 0])
      return
    }

    const restoredTerminalHeight = clampTerminalHeight(lastOpenTerminalHeightRef.current)
    panelGroup.setLayout([Math.max(35, 100 - restoredTerminalHeight), restoredTerminalHeight])
  }, [args.terminalPanelGroupRef, showTerminalPane])

  const onCloseTerminalPane = useCallback(() => {
    if (!args.activeThreadId) return
    lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightRef.current)
    setTerminalVisibleByThreadId((previous) => {
      if (previous[args.activeThreadId!] !== true) return previous
      return { ...previous, [args.activeThreadId!]: false }
    })
  }, [args.activeThreadId])

  const onToggleTerminal = useCallback(async () => {
    if (!args.terminalBridge || !args.activeThreadId) return

    const currentlyVisible = terminalVisibleByThreadIdRef.current[args.activeThreadId] === true
    if (currentlyVisible) {
      lastOpenTerminalHeightRef.current = clampTerminalHeight(terminalHeightRef.current)
      setTerminalVisibleByThreadId((previous) => ({ ...previous, [args.activeThreadId!]: false }))
      return
    }

    const nextCwd = args.activeThreadCwd ?? args.selectedCwd ?? undefined
    const result = await args.terminalBridge.ensureSession(args.activeThreadId, nextCwd)
    if (!result.exists) return

    const restoredHeight = clampTerminalHeight(lastOpenTerminalHeightRef.current)
    setTerminalHeightPercent(restoredHeight)
    setTerminalVisibleByThreadId((previous) => ({ ...previous, [args.activeThreadId!]: true }))
  }, [args.activeThreadCwd, args.activeThreadId, args.selectedCwd, args.terminalBridge])

  const onTerminalDragStateChange = useCallback((isDragging: boolean) => {
    isTerminalDraggingRef.current = isDragging
  }, [])

  const onTerminalResize = useCallback((sizePercent: number) => {
    if (!isTerminalDraggingRef.current) return
    if (!args.activeThreadId) return
    const activeThreadVisible = terminalVisibleByThreadIdRef.current[args.activeThreadId] === true
    if (!activeThreadVisible || args.isSettingsOpen) return
    if (sizePercent <= 0) return
    const clamped = clampTerminalHeight(sizePercent)
    lastOpenTerminalHeightRef.current = clamped
    setTerminalHeightPercent(clamped)
  }, [args.activeThreadId, args.isSettingsOpen])

  useEffect(() => {
    const currentIds = new Set(args.sortedThreads.map((thread) => thread.id))
    const removedThreadIds = Array.from(knownThreadIdsRef.current).filter((threadId) => !currentIds.has(threadId))
    knownThreadIdsRef.current = currentIds
    if (removedThreadIds.length === 0) return

    if (residentTerminalThreadId && removedThreadIds.includes(residentTerminalThreadId)) {
      setResidentTerminalThreadId(null)
    }

    setTerminalVisibleByThreadId((previous) => {
      let changed = false
      const next: Record<string, boolean> = { ...previous }
      for (const threadId of removedThreadIds) {
        if (threadId in next) {
          delete next[threadId]
          changed = true
        }
      }
      return changed ? next : previous
    })

    if (!args.terminalBridge) return
    for (const threadId of removedThreadIds) {
      void args.terminalBridge.destroySession(threadId).catch(() => undefined)
    }
  }, [args.sortedThreads, args.terminalBridge, residentTerminalThreadId])

  useEffect(() => {
    if (!args.terminalBridge) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.shiftKey || event.altKey) return
      const isTrigger = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j'
      if (!isTrigger) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase()
        const isEditableTarget =
          target.isContentEditable ||
          tagName === 'input' ||
          tagName === 'textarea' ||
          target.getAttribute('role') === 'textbox'
        if (isEditableTarget) return
      }
      event.preventDefault()
      void onToggleTerminal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [args.terminalBridge, onToggleTerminal])

  return {
    canToggleTerminal,
    onCloseTerminalPane,
    onTerminalDragStateChange,
    onTerminalResize,
    onToggleTerminal,
    showTerminalPane,
    terminalHeightPercent,
    terminalPaneThreadId,
  }
}
