import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
import { Textarea } from './ui/textarea'
import type { TranscriptItem } from '../types'

export type TranscriptPaneProps = {
  activeThreadId: string | null
  activeTurnId: string | null
  logs: TranscriptItem[]
  inputText: string
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  onInputTextChange: (value: string) => void
  onSend: (event: FormEvent) => void
  onInterrupt: () => void
}

function previewText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return '(empty thinking)'
  if (compact.length <= 160) return compact
  return `${compact.slice(0, 160)}...`
}

function connectionVariant(status: TranscriptPaneProps['connectionStatus']): 'secondary' | 'outline' | 'destructive' {
  if (status === 'connected') return 'secondary'
  if (status === 'connecting') return 'outline'
  return 'destructive'
}

function ThinkingItem({ item }: { item: Extract<TranscriptItem, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="max-w-full gap-3 border-dashed bg-muted/50 px-3 py-3 shadow-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Thinking</Badge>
            {item.turnId ? <span>turn {item.turnId.slice(0, 8)}</span> : null}
            <span>{item.text.length} chars</span>
          </div>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="h-7 px-2 text-xs">
              {open ? (
                <>
                  Hide
                  <ChevronDown className="size-3.5" />
                </>
              ) : (
                <>
                  Show
                  <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          </CollapsibleTrigger>
        </div>

        {!open ? <p className="text-xs text-muted-foreground">{previewText(item.text)}</p> : null}

        <CollapsibleContent className="space-y-2 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <Separator />
          <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 text-xs whitespace-pre-wrap">
            {item.text || '(empty thinking)'}
          </pre>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

export function TranscriptPane(props: TranscriptPaneProps) {
  const {
    activeThreadId,
    activeTurnId,
    logs,
    inputText,
    connectionStatus,
    onInputTextChange,
    onSend,
    onInterrupt,
  } = props

  return (
    <main className="center-pane">
      <header className="pane-header">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Active thread:</span>
          <strong>{activeThreadId ? activeThreadId.slice(0, 8) : 'none'}</strong>
          {activeTurnId ? (
            <Badge variant="secondary" className="font-mono">
              turn {activeTurnId.slice(0, 8)}
            </Badge>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!activeTurnId} onClick={onInterrupt}>
          Interrupt
        </Button>
      </header>

      <section className="transcript">
        <ScrollArea className="h-full">
          <div className="grid gap-3 p-4">
            {logs.length === 0 ? <div className="empty">Start a thread and send a turn.</div> : null}
            {logs.map((item) =>
              item.kind === 'log' ? (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-md border px-3 py-2 text-xs',
                    item.level === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
                    item.level === 'warn' && 'border-amber-200 bg-amber-50 text-amber-800',
                    item.level === 'info' && 'border-border bg-muted/50 text-muted-foreground',
                  )}
                >
                  {item.text}
                </div>
              ) : item.kind === 'thinking' ? (
                <ThinkingItem key={item.id} item={item} />
              ) : (
                <div key={item.id} className={cn('flex', item.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <Card
                    className={cn(
                      'max-w-[78%] px-3 py-2 shadow-none',
                      item.role === 'user' ? 'bg-primary/10 border-primary/20' : 'bg-muted/60',
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{item.text}</p>
                  </Card>
                </div>
              ),
            )}
          </div>
        </ScrollArea>
      </section>

      <form className="composer" onSubmit={onSend}>
        <div className="space-y-2 rounded-lg border bg-background/80 p-3 shadow-xs">
          <Textarea
            value={inputText}
            onChange={(event) => onInputTextChange(event.target.value)}
            placeholder="Type a prompt for turn/start..."
            className="min-h-14 max-h-44 border-0 p-0 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for newline</p>
            <Badge variant={connectionVariant(connectionStatus)}>{connectionStatus}</Badge>
          </div>
        </div>
        <div className="flex items-end justify-end">
          <Button type="submit" disabled={!activeThreadId || connectionStatus !== 'connected'}>
            Send
          </Button>
        </div>
      </form>
    </main>
  )
}
