import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { shouldStopWheelPropagation } from '../scrollBoundary'
import type { TranscriptItem } from '../../types'

const TURN_INIT_RENDER_LIMIT = 30
const TURN_BATCH_RENDER_SIZE = 20
const HISTORY_BATCH_RENDER_SIZE = 50
const RENDER_WINDOW_CAP = 200
const VIRTUALIZED_TURN_INIT_RENDER_LIMIT = 20
const VIRTUALIZED_TURN_BATCH_RENDER_SIZE = 16
const VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE = 40
const VIRTUALIZED_RENDER_WINDOW_CAP = 120
const NEAR_BOTTOM_THRESHOLD_PX = 32

function shouldRenderTranscriptItem(item: TranscriptItem): boolean {
  if (item.kind !== 'thinking') return true
  return item.status === 'running'
}

function isViewportNearBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX
}

export type TranscriptRow = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
}

export type TranscriptRenderView = {
  visibleLogCount: number
  hiddenInMemoryCount: number
  renderedRows: TranscriptRow[]
}

type UseRenderWindowParams = {
  logs: TranscriptItem[]
  activeThreadId: string | null
  activeTurnId: string | null
  virtualizationEnabled: boolean
  onLoadEarlier?: () => void
  devLoadAllActive: boolean
  showTurnLoading: boolean
}

type UseRenderWindowResult = {
  transcriptRenderView: TranscriptRenderView
  showJumpToBottom: boolean
  scrollAreaRef: RefObject<HTMLDivElement | null>
  bottomRef: RefObject<HTMLDivElement | null>
  renderEarlierMessages: () => void
  handleLoadEarlier: () => void
  jumpToBottom: () => void
  stickToBottom: () => void
}

export function useRenderWindow(params: UseRenderWindowParams): UseRenderWindowResult {
  const turnInitRenderLimit = params.virtualizationEnabled ? VIRTUALIZED_TURN_INIT_RENDER_LIMIT : TURN_INIT_RENDER_LIMIT
  const turnBatchRenderSize = params.virtualizationEnabled ? VIRTUALIZED_TURN_BATCH_RENDER_SIZE : TURN_BATCH_RENDER_SIZE
  const historyBatchRenderSize = params.virtualizationEnabled ? VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE : HISTORY_BATCH_RENDER_SIZE
  const renderWindowCap = params.virtualizationEnabled ? VIRTUALIZED_RENDER_WINDOW_CAP : RENDER_WINDOW_CAP

  const [isNearBottom, setIsNearBottom] = useState(true)
  const [autoStick, setAutoStick] = useState(true)
  const [renderLimit, setRenderLimit] = useState(turnInitRenderLimit)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const autoStickRef = useRef(autoStick)
  const autoStickStateRef = useRef(autoStick)
  const scrollRafHandleRef = useRef<number | null>(null)
  const scrollFallbackHandleRef = useRef<number | null>(null)
  const previousActiveTurnIdRef = useRef<string | null>(params.activeTurnId)

  const transcriptRenderView = useMemo<TranscriptRenderView>(() => {
    const visibleItems: TranscriptItem[] = []
    for (const item of params.logs) {
      if (shouldRenderTranscriptItem(item)) {
        visibleItems.push(item)
      }
    }

    const visibleLogCount = visibleItems.length
    const hiddenInMemoryCount = Math.max(0, visibleLogCount - renderLimit)
    const renderStart = Math.max(0, visibleLogCount - renderLimit)
    const renderedRows: TranscriptRow[] = []

    let lastKnownTurnId: string | undefined

    for (let visibleIndex = renderStart; visibleIndex < visibleItems.length; visibleIndex += 1) {
      const item = visibleItems[visibleIndex]
      if (!item) continue
      const turnGroupStart = Boolean(item.turnId) && item.turnId !== lastKnownTurnId
      if (item.turnId) {
        lastKnownTurnId = item.turnId
      }
      renderedRows.push({
        item,
        turnGroupStart,
        showTurnGap: turnGroupStart && renderedRows.length > 0,
      })
    }

    return {
      visibleLogCount,
      hiddenInMemoryCount,
      renderedRows,
    }
  }, [params.logs, renderLimit])
  const showJumpToBottom = transcriptRenderView.visibleLogCount > 0 && !isNearBottom

  const setAutoStickState = useCallback((next: boolean) => {
    autoStickRef.current = next
    if (autoStickStateRef.current === next) return
    autoStickStateRef.current = next
    setAutoStick(next)
  }, [])

  const setNearBottomState = useCallback((next: boolean) => {
    setIsNearBottom((previous) => (previous === next ? previous : next))
  }, [])

  const syncViewportScrollState = useCallback((viewport: HTMLElement, nearBottom: boolean, syncNearBottom = true) => {
    viewport.style.overflowAnchor = nearBottom ? 'auto' : 'none'
    if (syncNearBottom) {
      setNearBottomState(nearBottom)
    }
    setAutoStickState(nearBottom)
  }, [setAutoStickState, setNearBottomState])

  useEffect(() => {
    return () => {
      if (scrollRafHandleRef.current != null) {
        window.cancelAnimationFrame(scrollRafHandleRef.current)
        scrollRafHandleRef.current = null
      }
      if (scrollFallbackHandleRef.current != null) {
        window.clearTimeout(scrollFallbackHandleRef.current)
        scrollFallbackHandleRef.current = null
      }
    }
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    if (!viewport) {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
      setAutoStickState(true)
      setNearBottomState(true)
      return
    }
    viewport.style.overflowAnchor = 'auto'
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
    setAutoStickState(true)
    setNearBottomState(true)
  }, [setAutoStickState, setNearBottomState])

  const flushScrollFrame = useCallback(() => {
    if (scrollRafHandleRef.current != null) {
      window.cancelAnimationFrame(scrollRafHandleRef.current)
      scrollRafHandleRef.current = null
    }
    if (scrollFallbackHandleRef.current != null) {
      window.clearTimeout(scrollFallbackHandleRef.current)
      scrollFallbackHandleRef.current = null
    }
    const nextViewport = viewportRef.current
    if (!nextViewport) return
    const nearBottom = isViewportNearBottom(nextViewport)
    syncViewportScrollState(nextViewport, nearBottom)
  }, [syncViewportScrollState])

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const nearBottom = isViewportNearBottom(viewport)
    syncViewportScrollState(viewport, nearBottom, false)
    if (scrollRafHandleRef.current != null || scrollFallbackHandleRef.current != null) return
    scrollRafHandleRef.current = window.requestAnimationFrame(() => {
      flushScrollFrame()
    })
    // jsdom and throttled tabs may defer RAF indefinitely; keep scroll state eventually consistent.
    scrollFallbackHandleRef.current = window.setTimeout(() => {
      flushScrollFrame()
    }, 48)
  }, [flushScrollFrame, syncViewportScrollState])

  const handleBoundaryWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (
      shouldStopWheelPropagation({
        deltaY: event.deltaY,
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      })
    ) {
      event.stopPropagation()
    }
  }, [])

  useEffect(() => {
    if (!autoStick) return
    const raf = window.requestAnimationFrame(() => {
      if (!autoStickRef.current) return
      scrollToBottom('auto')
    })
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [autoStick, scrollToBottom, transcriptRenderView.visibleLogCount, params.showTurnLoading])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.style.overflowAnchor = autoStick ? 'auto' : 'none'
  }, [autoStick])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewportRef.current = viewport
    viewport.style.overflowAnchor = autoStickStateRef.current ? 'auto' : 'none'
    viewport.addEventListener('scroll', handleViewportScroll, { passive: true })
    viewport.addEventListener('wheel', handleBoundaryWheel, { passive: true })
    syncViewportScrollState(viewport, isViewportNearBottom(viewport))
    return () => {
      if (scrollRafHandleRef.current != null) {
        window.cancelAnimationFrame(scrollRafHandleRef.current)
        scrollRafHandleRef.current = null
      }
      if (scrollFallbackHandleRef.current != null) {
        window.clearTimeout(scrollFallbackHandleRef.current)
        scrollFallbackHandleRef.current = null
      }
      viewport.removeEventListener('scroll', handleViewportScroll)
      viewport.removeEventListener('wheel', handleBoundaryWheel)
      if (viewportRef.current === viewport) {
        viewportRef.current = null
      }
    }
  }, [params.activeThreadId, handleBoundaryWheel, handleViewportScroll, syncViewportScrollState])

  const increaseRenderLimit = useCallback((delta: number, preserveAnchor: boolean, maxLimit: number) => {
    if (delta <= 0) return
    const viewport = viewportRef.current
    const beforeTop = viewport?.scrollTop ?? 0
    const beforeHeight = viewport?.scrollHeight ?? 0
    setRenderLimit((previous) => {
      const boundedNext = Math.min(maxLimit, previous + delta)
      return Math.max(previous, boundedNext)
    })
    if (!viewport) return
    if (!preserveAnchor) return
    window.requestAnimationFrame(() => {
      const afterHeight = viewport.scrollHeight
      viewport.scrollTop = beforeTop + Math.max(0, afterHeight - beforeHeight)
    })
  }, [])

  const renderEarlierMessages = useCallback(() => {
    if (transcriptRenderView.hiddenInMemoryCount <= 0) return
    increaseRenderLimit(historyBatchRenderSize, true, transcriptRenderView.visibleLogCount)
  }, [
    transcriptRenderView.hiddenInMemoryCount,
    transcriptRenderView.visibleLogCount,
    historyBatchRenderSize,
    increaseRenderLimit,
  ])

  const resetRenderLimit = useCallback(() => {
    setRenderLimit((previous) => (previous === turnInitRenderLimit ? previous : turnInitRenderLimit))
  }, [turnInitRenderLimit])

  useEffect(() => {
    resetRenderLimit()
  }, [params.activeThreadId, resetRenderLimit])

  const handleLoadEarlier = useCallback(() => {
    increaseRenderLimit(historyBatchRenderSize, true, transcriptRenderView.visibleLogCount)
    params.onLoadEarlier?.()
  }, [historyBatchRenderSize, increaseRenderLimit, params.onLoadEarlier, transcriptRenderView.visibleLogCount])

  const jumpToBottom = useCallback(() => {
    scrollToBottom('smooth')
  }, [scrollToBottom])

  useEffect(() => {
    if (!params.devLoadAllActive) return
    if (transcriptRenderView.hiddenInMemoryCount > 0) {
      increaseRenderLimit(
        transcriptRenderView.hiddenInMemoryCount,
        true,
        transcriptRenderView.visibleLogCount,
      )
    }
  }, [
    params.devLoadAllActive,
    transcriptRenderView.hiddenInMemoryCount,
    transcriptRenderView.visibleLogCount,
    increaseRenderLimit,
  ])

  useEffect(() => {
    if (params.activeTurnId && params.activeTurnId !== previousActiveTurnIdRef.current) {
      resetRenderLimit()
    }
    previousActiveTurnIdRef.current = params.activeTurnId
  }, [params.activeTurnId, resetRenderLimit])

  useEffect(() => {
    if (!params.activeTurnId) return
    const target = Math.min(transcriptRenderView.visibleLogCount, renderWindowCap)
    if (renderLimit >= target) return
    const schedule = (callback: () => void): number => {
      const withIdle = window as Window & {
        requestIdleCallback?: (cb: IdleRequestCallback) => number
      }
      if (typeof withIdle.requestIdleCallback === 'function') {
        return withIdle.requestIdleCallback(() => callback())
      }
      return window.setTimeout(callback, 0)
    }
    const cancel = (handle: number) => {
      const withIdle = window as Window & {
        cancelIdleCallback?: (id: number) => void
      }
      if (typeof withIdle.cancelIdleCallback === 'function') {
        withIdle.cancelIdleCallback(handle)
        return
      }
      window.clearTimeout(handle)
    }
    const handle = schedule(() => {
      increaseRenderLimit(turnBatchRenderSize, true, target)
    })
    return () => {
      cancel(handle)
    }
  }, [
    params.activeTurnId,
    transcriptRenderView.visibleLogCount,
    renderLimit,
    renderWindowCap,
    turnBatchRenderSize,
    increaseRenderLimit,
  ])

  const stickToBottom = useCallback(() => {
    setAutoStickState(true)
  }, [setAutoStickState])

  return {
    transcriptRenderView,
    showJumpToBottom,
    scrollAreaRef,
    bottomRef,
    renderEarlierMessages,
    handleLoadEarlier,
    jumpToBottom,
    stickToBottom,
  }
}
