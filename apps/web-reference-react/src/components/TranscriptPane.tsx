import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MessageSquare, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
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

type RpcErrorLike = {
  at: string
  method: string
  message: string
  code?: number
  data?: unknown
}

export type TranscriptPaneProps = {
  activeThread?: ThreadSummary | undefined
  activeThreadId: string | null
  activeTurnId?: string | null

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
  open: boolean
  onToggle: () => void
}) {
  const { item, open, onToggle } = props
  const summary = item.text.trim().split('\n')[0]?.trim() || 'thinking'
  const compactSummary = summary.length > 90 ? `${summary.slice(0, 90)}...` : summary
  if (item.status === 'running') {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse" />
        <div className="text-[11px] text-muted-foreground tracking-tight animate-pulse">{'thinking'}</div>
      </div>
    )
  }
  return (
    <div className="rounded-md border bg-muted/15">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={onToggle}
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-[11px] text-muted-foreground">thinking</span>
        </div>
        <span className="max-w-[320px] truncate text-[11px] text-muted-foreground/80">{compactSummary}</span>
      </button>
      {open ? (
        <div className="border-t bg-background/70 px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {item.text}
        </div>
      ) : null}
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
      <span className={cn('text-[11px] font-medium', styleByStatus[item.status])}>{labelByStatus[item.status]}</span>
      <span className="text-[10px] text-muted-foreground/70 font-mono">{item.turnId.slice(0, 8)}</span>
      {item.message ? <span className="text-[10px] text-muted-foreground/70 truncate max-w-[320px]">{item.message}</span> : null}
    </div>
  )
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThreadId,
    activeTurnId = null,
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
    isSending = false,
    isInterrupting = false,
    lastRpcError = null,
  } = props

  const [isNearBottom, setIsNearBottom] = useState(true)
  const [autoStick, setAutoStick] = useState(true)
  const [renderLimit, setRenderLimit] = useState(TURN_INIT_RENDER_LIMIT)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const [openToolIds, setOpenToolIds] = useState<Record<string, boolean>>({})
  const [openThinkingIds, setOpenThinkingIds] = useState<Record<string, boolean>>({})
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const previousActiveTurnIdRef = useRef<string | null>(activeTurnId)

  // Filter out INFO logs for product view (User Feedback: "Not a log panel")
  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      // Always show non-log items (user, assistant, tool, thinking)
      if (item.kind !== 'log') return true
      // Only show warn/error logs, hide info logs
      return item.level === 'warn' || item.level === 'error'
    })
  }, [logs])

  const showTurnLoading = Boolean(activeThreadId) &&
    connectionStatus === 'connected' &&
    !isInterrupting &&
    (isSending || Boolean(activeTurnId))

  const hiddenInMemoryCount = Math.max(0, filteredLogs.length - renderLimit)
  const renderedLogs = hiddenInMemoryCount > 0 ? filteredLogs.slice(-renderLimit) : filteredLogs
  const showJumpToBottom = filteredLogs.length > 0 && !isNearBottom

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    if (!viewport) {
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
      setAutoStick(true)
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
    setIsNearBottom(true)
  }

  const handleViewportScroll = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const bottomDistance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const nearBottom = bottomDistance <= 32
    setIsNearBottom(nearBottom)
    if (nearBottom) {
      viewport.style.overflowAnchor = 'auto'
      setAutoStick(true)
    } else if (autoStick) {
      viewport.style.overflowAnchor = 'none'
      setAutoStick(false)
    } else {
      viewport.style.overflowAnchor = 'none'
    }
  }

  const handleBoundaryWheel = (event: WheelEvent) => {
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
  }

  useEffect(() => {
    if (!autoStick) return
    const raf = window.requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
    return () => {
      window.cancelAnimationFrame(raf)
    }
  }, [autoStick, filteredLogs.length, showTurnLoading])

  useEffect(() => {
    const root = scrollAreaRef.current
    if (!root) return
    const viewport = root.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')
    if (!viewport) return
    viewportRef.current = viewport
    viewport.style.overflowAnchor = autoStick ? 'auto' : 'none'
    viewport.addEventListener('scroll', handleViewportScroll, { passive: true })
    viewport.addEventListener('wheel', handleBoundaryWheel, { passive: true })
    handleViewportScroll()
    return () => {
      viewport.removeEventListener('scroll', handleViewportScroll)
      viewport.removeEventListener('wheel', handleBoundaryWheel)
    }
  }, [activeThreadId, autoStick, filteredLogs.length])

  const handleSend = (event: FormEvent) => {
    setAutoStick(true)
    onSend(event)
  }

  const increaseRenderLimit = (delta: number, preserveAnchor: boolean, maxLimit: number) => {
    if (delta <= 0) return
    const viewport = viewportRef.current
    const beforeTop = viewport?.scrollTop ?? 0
    const beforeHeight = viewport?.scrollHeight ?? 0
    setRenderLimit((previous) => Math.min(maxLimit, previous + delta))
    if (!viewport) return
    if (!preserveAnchor) return
    window.requestAnimationFrame(() => {
      const afterHeight = viewport.scrollHeight
      viewport.scrollTop = beforeTop + Math.max(0, afterHeight - beforeHeight)
    })
  }

  const renderEarlierMessages = () => {
    if (hiddenInMemoryCount <= 0) return
    increaseRenderLimit(HISTORY_BATCH_RENDER_SIZE, true, filteredLogs.length)
  }

  useEffect(() => {
    setRenderLimit(TURN_INIT_RENDER_LIMIT)
  }, [activeThreadId])

  const handleLoadEarlier = () => {
    increaseRenderLimit(HISTORY_BATCH_RENDER_SIZE, true, filteredLogs.length)
    onLoadEarlier?.()
  }

  useEffect(() => {
    if (activeTurnId && activeTurnId !== previousActiveTurnIdRef.current) {
      setRenderLimit(TURN_INIT_RENDER_LIMIT)
    }
    previousActiveTurnIdRef.current = activeTurnId
  }, [activeTurnId])

  useEffect(() => {
    if (!activeTurnId) return
    const target = Math.min(filteredLogs.length, RENDER_WINDOW_CAP)
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
      increaseRenderLimit(TURN_BATCH_RENDER_SIZE, true, target)
    })
    return () => {
      cancel(handle)
    }
  }, [activeTurnId, autoStick, filteredLogs.length, renderLimit])

  return (
    <main data-testid="center-pane" className="center-pane flex-1 min-w-0 overflow-x-hidden flex flex-col bg-background">
      {/* Transcript Area */}
      <section className="transcript flex-1 overflow-hidden relative">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="flex min-w-0 flex-col gap-3 p-4 pb-12 max-w-3xl mx-auto w-full">
            {historyMore ? (
              <div className="flex justify-center">
                <Button type="button" variant="ghost" size="sm" disabled={historyLoading} onClick={handleLoadEarlier}>
                  {historyLoading ? 'Loading earlier messages...' : 'Load earlier messages'}
                </Button>
              </div>
            ) : null}

            {hiddenInMemoryCount > 0 ? (
              <div className="flex justify-center">
                <Button type="button" variant="ghost" size="sm" onClick={renderEarlierMessages}>
                  {`Render earlier messages (${hiddenInMemoryCount} hidden)`}
                </Button>
              </div>
            ) : null}
            
            {renderedLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/20" />
                    <span className="text-sm">Start a thread to begin</span>
                </div>
            ) : null}

            {(() => {
              let lastKnownTurnId: string | undefined
              return renderedLogs.map((item, index) => {
                const turnGroupStart = Boolean(item.turnId) && item.turnId !== lastKnownTurnId
                if (item.turnId) {
                  lastKnownTurnId = item.turnId
                }

                return (
                  <div
                    key={item.id}
                    data-turn-group-start={turnGroupStart ? 'true' : undefined}
                    className={cn(
                      'min-w-0',
                      turnGroupStart && index > 0 ? 'mt-3 pt-1' : null,
                    )}
                  >
                    {item.kind === 'log' ? (
                      <div className={cn('rounded-lg border px-3 py-2 text-xs bg-muted/20')}>
                        <div className="mb-1 flex items-center gap-2">
                          <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 text-[10px] uppercase font-bold tracking-wider">{item.level}</Badge>
                        </div>
                        <div className="text-muted-foreground font-mono text-[11px] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</div>
                      </div>
                    ) : item.kind === 'thinking' ? (
                      <ThinkingItem
                        item={item}
                        open={Boolean(openThinkingIds[item.id])}
                        onToggle={() => setOpenThinkingIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                      />
                    ) : item.kind === 'turn_footer' ? (
                      <TurnFooterItem item={item} />
                    ) : item.kind === 'tool_call' ? (
                      <ToolTranscriptItem
                        item={item}
                        open={Boolean(openToolIds[item.id])}
                        onToggle={() => setOpenToolIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                      />
                    ) : (
                      <div className={cn('flex w-full mb-1', item.role === 'user' ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[85%] transition-all duration-300',
                            item.role === 'user'
                              ? 'rounded-[14px] bg-[#F4F4F7] px-3 py-1 text-foreground selection:bg-primary/20'
                              : 'text-foreground py-2'
                          )}
                        >
                          {item.role === 'assistant' ? (
                            <MarkdownRenderer text={item.text} cacheKey={item.id} className="text-[14px] leading-relaxed" />
                          ) : (
                            <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-0.5">
                              {item.text}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            })()}

            {showTurnLoading ? (
              <div data-testid="turn-loading" className="py-1">
                <LoadingStatusLine text="Thinking" cycleWords />
              </div>
            ) : null}

            {lastRpcError ? (
              <Collapsible open={showErrorDetails} onOpenChange={setShowErrorDetails}>
                <Card className="gap-2 rounded-xl border-destructive/30 bg-destructive/5 px-3 py-3 shadow-none mx-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-destructive font-medium">
                      Rpc Error: {lastRpcError.message}
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="xs" className="h-6 px-2 text-xs hover:bg-destructive/10">
                        {showErrorDetails ? 'Hide' : 'Details'}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <pre className="mt-2 max-h-52 overflow-auto rounded border bg-background/50 p-2 text-[10px] whitespace-pre-wrap font-mono">
                      {JSON.stringify(lastRpcError, null, 2)}
                    </pre>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ) : null}
            <div ref={bottomRef} className="h-4" />
          </div>
        </ScrollArea>
      </section>

      {!composerLocked ? (
        <div data-testid="composer" className="composer p-4 pb-8">
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {showJumpToBottom ? (
              <div className="flex justify-end px-2">
                <Button
                  type="button"
                  aria-label="Jump to bottom"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 rounded-full shadow-sm"
                  onClick={() => scrollToBottom('smooth')}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
            <form
              className="group relative flex flex-col rounded-[26px] border border-border bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:ring-1 focus-within:ring-ring/10 focus-within:border-ring/20 transition-all duration-200"
              onSubmit={handleSend}
            >
              <Textarea
                  value={inputText}
                  onChange={(event) => onInputTextChange(event.target.value)}
                  placeholder="Ask for follow-up changes"
                  className="min-h-[90px] max-h-[300px] w-full resize-none border-none bg-transparent px-5 pt-5 pb-0 text-[15px] leading-relaxed placeholder:text-muted-foreground/40 focus-visible:ring-0 shadow-none"
                  onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (activeThreadId && connectionStatus === 'connected' && !inputText.trim()) return;
                          if (activeThreadId && connectionStatus === 'connected' && !isSending) {
                              handleSend(e as unknown as FormEvent);
                          }
                      }
                  }}
              />

              <div className="flex items-center justify-between px-3 h-12">
                <div className="flex items-center gap-3">
                  <Select value={mode} onValueChange={(value) => onModeChange(value as 'normal' | 'acceptEdits' | 'plan')}>
                    <SelectTrigger aria-label="Execution mode" className="h-8 w-[180px] border-border/60 bg-background text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Ask before edits</SelectItem>
                      <SelectItem value="acceptEdits">Auto edit</SelectItem>
                      <SelectItem value="plan">Plan mode</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">Enter to send, Shift+Enter for newline</div>
                </div>
                <div className="flex items-center gap-1 pr-1">
                  {isSending || isInterrupting ? (
                    <Button
                      type="button"
                      aria-label="Interrupt turn"
                      variant="destructive"
                      size="icon"
                      disabled={isInterrupting}
                      className="h-8 w-8 rounded-full shrink-0 shadow-sm"
                      onClick={onInterrupt}
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      aria-label="Send message"
                      disabled={!activeThreadId || connectionStatus !== 'connected' || !inputText.trim()}
                      size="icon"
                      className={cn(
                        'h-8 w-8 rounded-full shrink-0 shadow-none transition-all duration-200 border-0',
                        !inputText.trim() ? 'bg-[#E5E5E5] text-white' : 'bg-muted-foreground text-background hover:bg-foreground',
                      )}
                    >
                      <ArrowUp className="h-4.5 w-4.5" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <div data-testid="composer-locked" className="h-4" />
      )}
    </main>
  )
}
