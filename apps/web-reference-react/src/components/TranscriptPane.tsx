import { ArrowUp, MessageSquare, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ScrollArea } from './ui/scroll-area'
import { Textarea } from './ui/textarea'
import type { TranscriptItem, ThreadSummary } from '../types'

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
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
  isSending?: boolean
  isInterrupting?: boolean
  lastRpcError?: RpcErrorLike | null
}

function logLevelBadge(level: 'info' | 'warn' | 'error'): 'secondary' | 'outline' | 'destructive' {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'outline'
  return 'secondary'
}

function ThinkingItem({ item }: { item: Extract<TranscriptItem, { kind: 'thinking' }> }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="text-[11px] text-muted-foreground animate-pulse tracking-tight">
        {item.text || 'Thinking...'}
      </div>
    </div>
  )
}

function ToolItem({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  return (
    <div className="flex items-center gap-2 py-1.5 first:pt-0">
      <div className="text-[11px] text-muted-foreground font-medium tracking-tight">
        {item.toolName} <span className="lowercase font-normal text-muted-foreground/70">{item.phase}</span>
      </div>
    </div>
  )
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThreadId,
    logs,
    inputText,
    connectionStatus,
    onInputTextChange,
    onSend,
    onInterrupt,
    isSending = false,
    isInterrupting = false,
    lastRpcError = null,
  } = props

  const [autoStick] = useState(true)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Filter out INFO logs for product view (User Feedback: "Not a log panel")
  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      // Always show non-log items (user, assistant, tool, thinking)
      if (item.kind !== 'log') return true
      // Only show warn/error logs, hide info logs
      return item.level === 'warn' || item.level === 'error'
    })
  }, [logs])

  useEffect(() => {
    if (!autoStick) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [autoStick, filteredLogs.length])

  return (
    <main className="center-pane flex-1 min-w-0 flex flex-col bg-background">
      {/* Transcript Area */}
      <section className="transcript flex-1 overflow-hidden relative">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-6 p-4 pb-12 max-w-3xl mx-auto w-full">
            
            {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                    <MessageSquare className="h-8 w-8 text-muted-foreground/20" />
                    <span className="text-sm">Start a thread to begin</span>
                </div>
            ) : null}

            {filteredLogs.map((item) =>
              item.kind === 'log' ? (
                <div key={item.id} className={cn('rounded-lg border px-3 py-2 text-xs bg-muted/20')}>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={logLevelBadge(item.level)} className="h-4 px-1 text-[10px] uppercase font-bold tracking-wider">{item.level}</Badge>
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px] whitespace-pre-wrap break-words">{item.text}</div>
                </div>
              ) : item.kind === 'thinking' ? (
                <ThinkingItem key={item.id} item={item} />
              ) : item.kind === 'tool' ? (
                <ToolItem key={item.id} item={item} />
              ) : (
                <div key={item.id} className={cn('flex w-full mb-1', item.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] transition-all duration-300',
                      item.role === 'user'
                        ? 'rounded-[14px] bg-[#F4F4F7] px-3 py-1 text-foreground selection:bg-primary/20'
                        : 'text-foreground py-2'
                    )}
                  >
                    <div className={cn("text-[14px] leading-relaxed whitespace-pre-wrap", item.role === 'assistant' ? "markdown-body" : "px-0.5")}>
                        {item.text}
                    </div>
                  </div>
                </div>
              ),
            )}

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

      {/* Composer Area */}
      <div className="composer p-4 pb-8">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <form
            className="group relative flex flex-col rounded-[26px] border border-border bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:ring-1 focus-within:ring-ring/10 focus-within:border-ring/20 transition-all duration-200"
            onSubmit={onSend}
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
                            onSend(e as unknown as FormEvent);
                        }
                    }
                }}
            />
            
            <div className="flex items-center justify-between px-3 h-12">
              <div className="text-xs text-muted-foreground">Enter to send, Shift+Enter for newline</div>
              <div className="flex items-center gap-1 pr-1">
                {isSending || isInterrupting ? (
                  <Button
                    type="button"
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
    </main>
  )
}
