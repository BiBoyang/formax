import { ArrowDown, ArrowUp, ChevronsRight, MessageSquare, Pause, Pencil, Square } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ScrollArea } from './ui/scroll-area'
import { Textarea } from './ui/textarea'
import type { TranscriptItem, ThreadSummary } from '../types'
import { LoadingStatusLine } from './LoadingStatusLine'
import { shouldStopWheelPropagation } from './scrollBoundary'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolTranscriptItem } from './tool/ToolTranscriptItem'

const TURN_INIT_RENDER_LIMIT = 30
const TURN_BATCH_RENDER_SIZE = 20
const HISTORY_BATCH_RENDER_SIZE = 50
const RENDER_WINDOW_CAP = 200
const VIRTUALIZED_TURN_INIT_RENDER_LIMIT = 20
const VIRTUALIZED_TURN_BATCH_RENDER_SIZE = 16
const VIRTUALIZED_HISTORY_BATCH_RENDER_SIZE = 40
const VIRTUALIZED_RENDER_WINDOW_CAP = 120

type OpenIdsAction =
  | { type: 'toggle'; id: string }
  | { type: 'reset' }

function shouldRenderTranscriptItem(item: TranscriptItem): boolean {
  if (item.kind !== 'thinking') return true
  return item.status === 'running'
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

type ComposerMode = 'normal' | 'acceptEdits' | 'plan'

const MODE_CYCLE: ComposerMode[] = ['normal', 'acceptEdits', 'plan']

function nextComposerMode(mode: ComposerMode): ComposerMode {
  const idx = MODE_CYCLE.indexOf(mode)
  if (idx < 0) return 'normal'
  return MODE_CYCLE[(idx + 1) % MODE_CYCLE.length] ?? 'normal'
}

function modeMeta(mode: ComposerMode): { label: string; icon: typeof Pencil; toneClass: string } {
  if (mode === 'plan') {
    return {
      label: 'Plan mode',
      icon: Pause,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  if (mode === 'acceptEdits') {
    return {
      label: 'Edit automatically',
      icon: ChevronsRight,
      toneClass: 'text-foreground/70 hover:text-foreground',
    }
  }
  return {
    label: 'Ask before edits',
    icon: Pencil,
    toneClass: 'text-foreground/70 hover:text-foreground',
  }
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
}

function logLevelBadge(level: 'info' | 'warn' | 'error'): 'secondary' | 'outline' | 'destructive' {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'outline'
  return 'secondary'
}

function ThinkingItem(props: {
  item: Extract<TranscriptItem, { kind: 'thinking' }>
}) {
  const { item } = props
  if (item.status !== 'running') return null
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="ui-text-meta ui-text-muted tracking-tight animate-pulse">{'\u2234 Thinking\u2026'}</div>
    </div>
  )
}

function TurnFooterItem({ item }: { item: Extract<TranscriptItem, { kind: 'turn_footer' }> }) {
  const styleByStatus = {
    completed: 'text-muted-foreground',
    failed: 'text-red-600',
    interrupted: 'text-amber-700',
  } as const
  const labelByStatus = {
    completed: 'Turn completed',
    failed: 'Turn failed',
    interrupted: 'Turn interrupted',
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
            <span className="ui-text-micro uppercase tracking-wider text-muted-foreground/80">notice</span>
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

type TranscriptFeedProps = {
  activeThreadCwd?: string
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  hiddenInMemoryCount: number
  onRenderEarlierMessages: () => void
  renderedLogsCount: number
  renderedRows: TranscriptRow[]
  openToolIds: Set<string>
  onToggleTool: (id: string) => void
  showTurnLoading: boolean
  lastRpcError: RpcErrorLike | null
  showErrorDetails: boolean
  onShowErrorDetailsChange: (open: boolean) => void
  scrollAreaRef: { current: HTMLDivElement | null }
  bottomRef: { current: HTMLDivElement | null }
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

const TranscriptFeed = memo(function TranscriptFeed(props: TranscriptFeedProps) {
  const lastRpcErrorDetails = useMemo(
    () => (props.lastRpcError ? formatRpcErrorDetails(props.lastRpcError) : ''),
    [
      props.lastRpcError?.at,
      props.lastRpcError?.method,
      props.lastRpcError?.message,
      props.lastRpcError?.code,
      props.lastRpcError?.data,
    ],
  )

  return (
    <section className="transcript flex-1 overflow-hidden relative">
      <ScrollArea ref={props.scrollAreaRef} className="h-full">
        <div className="flex min-w-0 flex-col gap-3 p-4 pb-12 max-w-3xl mx-auto w-full">
          {props.historyMore ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" disabled={props.historyLoading} onClick={props.onLoadEarlier}>
                {props.historyLoading ? 'Loading earlier messages...' : 'Load earlier messages'}
              </Button>
            </div>
          ) : null}

          {props.hiddenInMemoryCount > 0 ? (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={props.onRenderEarlierMessages}>
                {`Render earlier messages (${props.hiddenInMemoryCount} hidden)`}
              </Button>
            </div>
          ) : null}

          {props.renderedLogsCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
              <MessageSquare className="h-8 w-8 text-muted-foreground/20" />
              <span className="ui-text-base ui-text-muted">Start a thread to begin</span>
            </div>
          ) : null}

          <TranscriptRowsList
            renderedRows={props.renderedRows}
            activeThreadCwd={props.activeThreadCwd}
            openToolIds={props.openToolIds}
            onToggleTool={props.onToggleTool}
          />

          {props.showTurnLoading ? (
            <div data-testid="turn-loading" className="py-1">
              <LoadingStatusLine text="Thinking" cycleWords />
            </div>
          ) : null}

          {props.lastRpcError ? (
            <Collapsible open={props.showErrorDetails} onOpenChange={props.onShowErrorDetailsChange}>
              <Card className="gap-2 rounded-xl border-destructive/30 bg-destructive/5 px-3 py-3 shadow-none mx-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="ui-text-meta text-destructive font-medium">
                    Rpc Error: {props.lastRpcError.message}
                  </div>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="xs" className="h-6 px-2 ui-text-meta hover:bg-destructive/10">
                      {props.showErrorDetails ? 'Hide' : 'Details'}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <pre className="mt-2 max-h-52 overflow-auto rounded border bg-background/50 p-2 ui-text-micro whitespace-pre-wrap font-mono">
                    {lastRpcErrorDetails}
                  </pre>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ) : null}
          <div ref={props.bottomRef} className="h-4" />
        </div>
      </ScrollArea>
    </section>
  )
})

type ComposerDockProps = {
  showJumpToBottom: boolean
  onJumpToBottom: () => void
  inputText: string
  onInputTextChange: (value: string) => void
  mode: ComposerMode
  onModeChange: (value: ComposerMode) => void
  activeThreadId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  isSending: boolean
  isInterrupting: boolean
  onInterrupt: () => void
  onSend: (event: FormEvent) => void
}

const ComposerDock = memo(function ComposerDock(props: ComposerDockProps) {
  const [isImeComposing, setIsImeComposing] = useState(false)
  const modeInfo = modeMeta(props.mode)

  return (
    <div data-testid="composer" className="composer p-4 pb-8">
      <div className="max-w-3xl mx-auto relative">
        {props.showJumpToBottom ? (
          <div className="pointer-events-none absolute left-1/2 -top-12 z-10 -translate-x-1/2">
            <Button
              type="button"
              aria-label="Jump to bottom"
              size="icon"
              variant="outline"
              className="pointer-events-auto h-9 w-9 rounded-full border-border/70 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
              onClick={props.onJumpToBottom}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <form
          className="group relative flex flex-col overflow-hidden rounded-[24px] border border-border/85 bg-card/95 shadow-sm focus-within:border-ring/30 focus-within:shadow-md transition-all duration-200"
          onSubmit={props.onSend}
        >
          <Textarea
            value={props.inputText}
            onChange={(event) => props.onInputTextChange(event.target.value)}
            placeholder="Ask for follow-up changes"
            className="min-h-[72px] max-h-[300px] w-full resize-none border-none bg-transparent px-5 pt-2 pb-1 ui-text-base leading-relaxed placeholder:text-muted-foreground/55 focus-visible:ring-0 shadow-none"
            onCompositionStart={() => setIsImeComposing(true)}
            onCompositionEnd={() => setIsImeComposing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Tab' && event.shiftKey) {
                event.preventDefault()
                props.onModeChange(nextComposerMode(props.mode))
                return
              }
              if (event.key !== 'Enter' || event.shiftKey) return
              const nativeEvent = event.nativeEvent as KeyboardEvent
              if (isImeComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229) return
              event.preventDefault()
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.inputText.trim()) return
              if (props.activeThreadId && props.connectionStatus === 'connected' && !props.isSending) {
                props.onSend(event as unknown as FormEvent)
              }
            }}
          />

          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                aria-label="Execution mode"
                onClick={() => props.onModeChange(nextComposerMode(props.mode))}
                className={cn('h-7 rounded-md px-2 ui-text-base font-medium tracking-tight transition-colors', modeInfo.toneClass)}
                title="Click to cycle mode (Shift+Tab)"
              >
                <modeInfo.icon className="mr-0.5 size-3 shrink-0" />
                <span>{modeInfo.label}</span>
              </Button>
              <div className="hidden lg:block ui-text-base text-muted-foreground/85">
                Shift+Tab switch mode, Enter send, Shift+Enter newline
              </div>
            </div>
            <div className="flex items-center gap-1 pr-1 text-muted-foreground">
              {props.isSending || props.isInterrupting ? (
                <Button
                  type="button"
                  aria-label="Interrupt turn"
                  size="icon"
                  disabled={props.isInterrupting}
                  className="h-7 w-7 rounded-full shrink-0 border-0 bg-black text-white shadow-none hover:bg-black/90"
                  onClick={props.onInterrupt}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  aria-label="Send message"
                  disabled={!props.activeThreadId || props.connectionStatus !== 'connected' || !props.inputText.trim()}
                  size="icon"
                  className={cn(
                    'h-7 w-7 rounded-full shrink-0 border-0 shadow-none transition-colors duration-150 disabled:opacity-100',
                    !props.inputText.trim() ? 'ui-button-disabled text-white hover:ui-button-disabled' : 'bg-black text-white hover:bg-black/90',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    if (!viewport) {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
      setAutoStick(true)
      autoStickRef.current = true
      autoStickStateRef.current = true
      setIsNearBottom(true)
      return
    }
    viewport.style.overflowAnchor = 'auto'
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    } else {
      viewport.scrollTop = viewport.scrollHeight
    }
    setAutoStick(true)
    autoStickRef.current = true
    autoStickStateRef.current = true
    setIsNearBottom(true)
  }, [])

  useEffect(() => {
    autoStickRef.current = autoStick
    autoStickStateRef.current = autoStick
  }, [autoStick])

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
    const bottomDistance = nextViewport.scrollHeight - nextViewport.scrollTop - nextViewport.clientHeight
    const nearBottom = bottomDistance <= 32
    setIsNearBottom((previous) => (previous === nearBottom ? previous : nearBottom))

    if (nearBottom) {
      nextViewport.style.overflowAnchor = 'auto'
      if (!autoStickStateRef.current) {
        autoStickRef.current = true
        autoStickStateRef.current = true
        setAutoStick(true)
      }
      return
    }

    nextViewport.style.overflowAnchor = 'none'
    if (autoStickStateRef.current) {
      autoStickRef.current = false
      autoStickStateRef.current = false
      setAutoStick(false)
    }
  }, [])

  const handleViewportScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const bottomDistance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const nearBottom = bottomDistance <= 32
    viewport.style.overflowAnchor = nearBottom ? 'auto' : 'none'
    if (nearBottom) {
      autoStickRef.current = true
      if (!autoStickStateRef.current) {
        autoStickStateRef.current = true
        setAutoStick(true)
      }
    } else {
      autoStickRef.current = false
      if (autoStickStateRef.current) {
        autoStickStateRef.current = false
        setAutoStick(false)
      }
    }
    if (scrollRafHandleRef.current != null || scrollFallbackHandleRef.current != null) return
    scrollRafHandleRef.current = window.requestAnimationFrame(() => {
      flushScrollFrame()
    })
    // jsdom and throttled tabs may defer RAF indefinitely; keep scroll state eventually consistent.
    scrollFallbackHandleRef.current = window.setTimeout(() => {
      flushScrollFrame()
    }, 48)
  }, [flushScrollFrame])

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
    viewport.style.overflowAnchor = autoStickRef.current ? 'auto' : 'none'
    viewport.addEventListener('scroll', handleViewportScroll, { passive: true })
    viewport.addEventListener('wheel', handleBoundaryWheel, { passive: true })
    const bottomDistance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const nearBottom = bottomDistance <= 32
    setIsNearBottom((previous) => (previous === nearBottom ? previous : nearBottom))
    if (nearBottom) {
      if (!autoStickStateRef.current) {
        autoStickRef.current = true
        autoStickStateRef.current = true
        setAutoStick(true)
      }
      viewport.style.overflowAnchor = 'auto'
    } else {
      if (autoStickStateRef.current) {
        autoStickRef.current = false
        autoStickStateRef.current = false
        setAutoStick(false)
      }
      viewport.style.overflowAnchor = 'none'
    }
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
  }, [activeThreadId, handleBoundaryWheel, handleViewportScroll])

  const handleSend = useCallback((event: FormEvent) => {
    autoStickRef.current = true
    autoStickStateRef.current = true
    setAutoStick(true)
    onSend(event)
  }, [onSend])

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

  useEffect(() => {
    setRenderLimit(turnInitRenderLimit)
  }, [activeThreadId, turnInitRenderLimit])

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
      setRenderLimit(turnInitRenderLimit)
    }
    previousActiveTurnIdRef.current = activeTurnId
  }, [activeTurnId, turnInitRenderLimit])

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

  return (
    <main data-testid="center-pane" className="center-pane flex-1 min-w-0 overflow-x-hidden flex flex-col bg-background">
      <TranscriptFeed
        activeThreadCwd={activeThread?.cwd}
        historyMore={historyMore}
        historyLoading={historyLoading}
        onLoadEarlier={handleLoadEarlier}
        hiddenInMemoryCount={transcriptRenderView.hiddenInMemoryCount}
        onRenderEarlierMessages={renderEarlierMessages}
        renderedLogsCount={transcriptRenderView.renderedRows.length}
        renderedRows={transcriptRenderView.renderedRows}
        openToolIds={openToolIds}
        onToggleTool={toggleToolOpen}
        showTurnLoading={showTurnLoading}
        lastRpcError={lastRpcError}
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
        />
      ) : (
        <div data-testid="composer-locked" className="h-4" />
      )}
    </main>
  )
}
