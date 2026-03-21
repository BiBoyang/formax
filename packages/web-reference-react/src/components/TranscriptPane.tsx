import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../app/i18n/I18nProvider'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import type { TranscriptItem, ThreadSummary } from '../types'
import { shouldStopWheelPropagation } from './scrollBoundary'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolTranscriptItem } from './tool/ToolTranscriptItem'
import { ComposerDock } from './composer/ComposerDock'
import { TranscriptFeed } from './transcript/TranscriptFeed'

const TURN_INIT_RENDER_LIMIT = 30
const TURN_BATCH_RENDER_SIZE = 20
const HISTORY_BATCH_RENDER_SIZE = 50
const RENDER_WINDOW_CAP = 200
const VIRTUALIZED_TURN_INIT_RENDER_LIMIT = 20
const VIRTUALIZED_TURN_BATCH_RENDER_SIZE = 16
const VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE = 40
const VIRTUALIZED_RENDER_WINDOW_CAP = 120
const NEAR_BOTTOM_THRESHOLD_PX = 32

type OpenIdsAction =
  | { type: 'toggle'; id: string }
  | { type: 'reset' }

function shouldRenderTranscriptItem(item: TranscriptItem): boolean {
  if (item.kind !== 'thinking') return true
  return item.status === 'running'
}

function isViewportNearBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX
}

function openIdsReducer(state: Set<string>, action: OpenIdsAction): Set<string> {
  if (action.type === 'reset') return new Set<string>()
  const next = new Set(state)
  if (next.has(action.id)) {
    next.delete(action.id)
  } else {
    next.add(action.id)
  }
  return next
}

type RpcErrorLike = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}

const RPC_ERROR_DETAILS_CACHE_LIMIT = 80
const rpcErrorDetailsCache = new Map<string, string>()

function encodeCacheKeyPart(value: string): string {
  return `${value.length}:${value}`
}

function getRpcErrorDataCacheKey(data: unknown): string {
  if (data === null) return 'null'
  if (typeof data === 'undefined') return 'undefined'
  if (typeof data === 'object') {
    try {
      return `obj:${JSON.stringify(data)}`
    } catch {
      return `obj-unserializable:${Object.prototype.toString.call(data)}`
    }
  }
  if (typeof data === 'string') return `str:${data}`
  if (typeof data === 'number') return `num:${String(data)}`
  if (typeof data === 'boolean') return `bool:${String(data)}`
  if (typeof data === 'bigint') return `bigint:${String(data)}`
  return `other:${String(data)}`
}

function makeRpcErrorDetailsCacheKey(error: RpcErrorLike): string {
  return [
    encodeCacheKeyPart(error.at),
    encodeCacheKeyPart(error.method),
    encodeCacheKeyPart(error.message),
    encodeCacheKeyPart(error.code == null ? '' : String(error.code)),
    encodeCacheKeyPart(getRpcErrorDataCacheKey(error.data)),
  ].join('')
}

export function formatRpcErrorDetails(error: RpcErrorLike): string {
  const cacheKey = makeRpcErrorDetailsCacheKey(error)
  const cached = rpcErrorDetailsCache.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const serialized = JSON.stringify(error, null, 2)
  if (rpcErrorDetailsCache.size >= RPC_ERROR_DETAILS_CACHE_LIMIT) {
    const oldestKey = rpcErrorDetailsCache.keys().next().value
    if (typeof oldestKey === 'string') {
      rpcErrorDetailsCache.delete(oldestKey)
    }
  }
  rpcErrorDetailsCache.set(cacheKey, serialized)
  return serialized
}

export type TranscriptPaneProps = {
  activeThread?: ThreadSummary | undefined
  activeThreadId: string | null
  activeTurnId?: string | null
  virtualizationEnabled?: boolean

  logs: TranscriptItem[]
  composerLocked?: boolean
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  mode: 'normal' | 'acceptEdits' | 'plan'
  onModeChange: (value: 'normal' | 'acceptEdits' | 'plan') => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
  historyMore?: boolean
  historyLoading?: boolean
  onLoadEarlier?: () => void
  devLoadAllActive?: boolean
  isSending?: boolean
  isInterrupting?: boolean
  lastRpcError?: RpcErrorLike | null
  longTextRequireCmdEnter?: boolean
}

function logLevelBadge(level: 'info' | 'warn' | 'error'): 'secondary' | 'outline' | 'destructive' {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'outline'
  return 'secondary'
}

function ThinkingItem(props: {
  item: Extract<TranscriptItem, { kind: 'thinking' }>
}) {
  const { t } = useI18n()
  const { item } = props
  if (item.status !== 'running') return null
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="ui-text-meta ui-text-muted tracking-tight animate-pulse">{t('transcript.runningThinking')}</div>
    </div>
  )
}

function TurnFooterItem({ item }: { item: Extract<TranscriptItem, { kind: 'turn_footer' }> }) {
  const { t } = useI18n()
  const styleByStatus = {
    completed: 'text-muted-foreground',
    failed: 'text-red-600',
    interrupted: 'text-amber-700',
  } as const
  const labelByStatus = {
    completed: t('transcript.turn.completed'),
    failed: t('transcript.turn.failed'),
    interrupted: t('transcript.turn.interrupted'),
  } as const
  return (
    <div className="flex items-center gap-2 py-1 pl-1">
      <span className={cn('ui-text-meta font-medium', styleByStatus[item.status])}>{labelByStatus[item.status]}</span>
      <span className="ui-text-micro text-muted-foreground/70 font-mono">{item.turnId.slice(0, 8)}</span>
      {item.message ? <span className="ui-text-micro text-muted-foreground/70 truncate max-w-[320px]">{item.message}</span> : null}
    </div>
  )
}

type TranscriptItemRowProps = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
  activeThreadCwd?: string
  toolOpen: boolean
  onToggleTool: (id: string) => void
}

const TranscriptItemRow = memo(function TranscriptItemRow(props: TranscriptItemRowProps) {
  const { t } = useI18n()
  const {
    item,
    turnGroupStart,
    showTurnGap,
    activeThreadCwd,
    toolOpen,
    onToggleTool,
  } = props

  return (
    <div
      data-turn-group-start={turnGroupStart ? 'true' : undefined}
      className={cn(
        'min-w-0 ui-content-auto',
        showTurnGap ? 'mt-3 pt-1' : null,
      )}
    >
      {item.kind === 'log' ? (
        <div className={cn('rounded-lg border px-3 py-2 ui-text-meta bg-muted/20')}>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 ui-text-micro uppercase font-bold tracking-wider">{item.level}</Badge>
          </div>
          <div className="text-muted-foreground font-mono ui-text-meta whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</div>
        </div>
      ) : item.kind === 'notice' ? (
        <div className={cn('rounded-lg border px-3 py-2 ui-text-meta bg-muted/15')}>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 ui-text-micro uppercase font-bold tracking-wider">{item.level}</Badge>
            <span className="ui-text-micro uppercase tracking-wider text-muted-foreground/80">{t('transcript.notice')}</span>
          </div>
          <div className="text-muted-foreground ui-text-meta whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</div>
        </div>
      ) : item.kind === 'thinking' ? (
        <ThinkingItem item={item} />
      ) : item.kind === 'turn_footer' ? (
        <TurnFooterItem item={item} />
      ) : item.kind === 'tool_call' ? (
        <ToolTranscriptItem
          item={item}
          cwd={activeThreadCwd}
          displayDensity="compact"
          open={toolOpen}
          onToggle={() => onToggleTool(item.id)}
        />
      ) : (
        <div className={cn('flex w-full mb-1', item.role === 'user' ? 'justify-end' : 'justify-start')}>
          <div
            className={cn(
              'max-w-[85%] transition-all duration-300',
              item.role === 'user'
                ? 'rounded-[14px] ui-surface-user-bubble px-3 py-1 text-foreground selection:bg-primary/20'
                : 'text-foreground py-2'
            )}
          >
            {item.role === 'assistant' ? (
              <MarkdownRenderer text={item.text} cacheKey={item.id} className="ui-text-base leading-relaxed" />
            ) : (
              <div className="ui-text-base leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-0.5">
                {item.text}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

type TranscriptRow = {
  item: TranscriptItem
  turnGroupStart: boolean
  showTurnGap: boolean
}

type TranscriptRenderView = {
  visibleLogCount: number
  hiddenInMemoryCount: number
  renderedRows: TranscriptRow[]
}

type TranscriptRowsListProps = {
  renderedRows: TranscriptRow[]
  activeThreadCwd?: string
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
}

const TranscriptRowsList = memo(function TranscriptRowsList(props: TranscriptRowsListProps) {
  if (props.renderedRows.length === 0) return null
  return (
    <>
      {props.renderedRows.map((row) => (
        <TranscriptItemRow
          key={row.item.id}
          item={row.item}
          turnGroupStart={row.turnGroupStart}
          showTurnGap={row.showTurnGap}
          activeThreadCwd={props.activeThreadCwd}
          toolOpen={props.openToolIds.has(row.item.id)}
          onToggleTool={props.onToggleTool}
        />
      ))}
    </>
  )
})

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThread,
    activeThreadId,
    activeTurnId = null,
    virtualizationEnabled = false,
    logs,
    composerLocked = false,
    inputText,
    mode,
    onModeChange,
    connectionStatus,
    onInputTextChange,
    onSend,
    onInterrupt,
    historyMore = false,
    historyLoading = false,
    onLoadEarlier,
    devLoadAllActive = false,
    isSending = false,
    isInterrupting = false,
    lastRpcError = null,
    longTextRequireCmdEnter = false,
  } = props
  const turnInitRenderLimit = virtualizationEnabled ? VIRTUALIZED_TURN_INIT_RENDER_LIMIT : TURN_INIT_RENDER_LIMIT
  const turnBatchRenderSize = virtualizationEnabled ? VIRTUALIZED_TURN_BATCH_RENDER_SIZE : TURN_BATCH_RENDER_SIZE
  const historyBatchRenderSize = virtualizationEnabled ? VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE : HISTORY_BATCH_RENDER_SIZE
  const renderWindowCap = virtualizationEnabled ? VIRTUALIZED_RENDER_WINDOW_CAP : RENDER_WINDOW_CAP

  const [isNearBottom, setIsNearBottom] = useState(true)
  const [autoStick, setAutoStick] = useState(true)
  const [renderLimit, setRenderLimit] = useState(turnInitRenderLimit)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [openToolIds, dispatchOpenToolIds] = useReducer(openIdsReducer, new Set<string>())
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const autoStickRef = useRef(autoStick)
  const autoStickStateRef = useRef(autoStick)
  const scrollRafHandleRef = useRef<number | null>(null)
  const scrollFallbackHandleRef = useRef<number | null>(null)
  const previousActiveTurnIdRef = useRef<string | null>(activeTurnId)

  const showTurnLoading = Boolean(activeThreadId) &&
    connectionStatus === 'connected' &&
    !isInterrupting &&
    (isSending || Boolean(activeTurnId))

  const transcriptRenderView = useMemo<TranscriptRenderView>(() => {
    const visibleItems: TranscriptItem[] = []
    for (const item of logs) {
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
  }, [logs, renderLimit])
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
  }, [autoStick, scrollToBottom, transcriptRenderView.visibleLogCount, showTurnLoading])

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
  }, [activeThreadId, handleBoundaryWheel, handleViewportScroll, syncViewportScrollState])

  const handleSend = useCallback((event: FormEvent) => {
    setAutoStickState(true)
    onSend(event)
  }, [onSend, setAutoStickState])

  const toggleToolOpen = useCallback((id: string) => {
    dispatchOpenToolIds({ type: 'toggle', id })
  }, [])

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
  }, [activeThreadId, resetRenderLimit])

  const handleLoadEarlier = useCallback(() => {
    increaseRenderLimit(historyBatchRenderSize, true, transcriptRenderView.visibleLogCount)
    onLoadEarlier?.()
  }, [historyBatchRenderSize, increaseRenderLimit, onLoadEarlier, transcriptRenderView.visibleLogCount])
  const jumpToBottom = useCallback(() => {
    scrollToBottom('smooth')
  }, [scrollToBottom])

  useEffect(() => {
    if (!devLoadAllActive) return
    if (transcriptRenderView.hiddenInMemoryCount > 0) {
      increaseRenderLimit(
        transcriptRenderView.hiddenInMemoryCount,
        true,
        transcriptRenderView.visibleLogCount,
      )
    }
  }, [
    devLoadAllActive,
    transcriptRenderView.hiddenInMemoryCount,
    transcriptRenderView.visibleLogCount,
    increaseRenderLimit,
  ])

  useEffect(() => {
    if (activeTurnId && activeTurnId !== previousActiveTurnIdRef.current) {
      resetRenderLimit()
    }
    previousActiveTurnIdRef.current = activeTurnId
  }, [activeTurnId, resetRenderLimit])

  useEffect(() => {
    if (!activeTurnId) return
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
    activeTurnId,
    transcriptRenderView.visibleLogCount,
    renderLimit,
    renderWindowCap,
    turnBatchRenderSize,
  ])

  const lastRpcErrorDetails = useMemo(
    () => (lastRpcError ? formatRpcErrorDetails(lastRpcError) : ''),
    [lastRpcError?.at, lastRpcError?.method, lastRpcError?.message, lastRpcError?.code, lastRpcError?.data],
  )
  const rowsContent = useMemo(
    () => (
      <TranscriptRowsList
        renderedRows={transcriptRenderView.renderedRows}
        activeThreadCwd={activeThread?.cwd}
        openToolIds={openToolIds}
        onToggleTool={toggleToolOpen}
      />
    ),
    [activeThread?.cwd, openToolIds, toggleToolOpen, transcriptRenderView.renderedRows],
  )

  return (
    <main data-testid="center-pane" className="center-pane flex-1 min-w-0 overflow-x-hidden flex flex-col bg-background">
      <TranscriptFeed
        isWelcomeState={!activeThreadId}
        historyMore={historyMore}
        historyLoading={historyLoading}
        onLoadEarlier={handleLoadEarlier}
        hiddenInMemoryCount={transcriptRenderView.hiddenInMemoryCount}
        onRenderEarlierMessages={renderEarlierMessages}
        renderedLogsCount={transcriptRenderView.renderedRows.length}
        rowsContent={rowsContent}
        showTurnLoading={showTurnLoading}
        lastRpcError={lastRpcError}
        lastRpcErrorDetails={lastRpcErrorDetails}
        showErrorDetails={showErrorDetails}
        onShowErrorDetailsChange={setShowErrorDetails}
        scrollAreaRef={scrollAreaRef}
        bottomRef={bottomRef}
      />

      {!composerLocked ? (
        <ComposerDock
          showJumpToBottom={showJumpToBottom}
          onJumpToBottom={jumpToBottom}
          inputText={inputText}
          onInputTextChange={onInputTextChange}
          mode={mode}
          onModeChange={onModeChange}
          activeThreadId={activeThreadId}
          connectionStatus={connectionStatus}
          isSending={isSending}
          isInterrupting={isInterrupting}
          onInterrupt={onInterrupt}
          onSend={handleSend}
          longTextRequireCmdEnter={longTextRequireCmdEnter}
        />
      ) : (
        <div data-testid="composer-locked" className="h-4" />
      )}
    </main>
  )
}
