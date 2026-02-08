import { Plus, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ThreadSummary } from '../types'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'

export type LeftRailProps = {
  connectionStatus: 'disconnected' | 'connecting' | 'connected'
  bridgeUrl: string
  onBridgeUrlChange: (value: string) => void
  threads: ThreadSummary[]
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  onStartThread: () => void
  onRefreshThreads: () => void
}

function statusVariant(status: LeftRailProps['connectionStatus']): 'secondary' | 'outline' | 'destructive' {
  if (status === 'connected') return 'secondary'
  if (status === 'connecting') return 'outline'
  return 'destructive'
}

function threadTitle(thread: ThreadSummary): string {
  return thread.label || thread.lastUserPrompt || `Thread ${thread.id.slice(0, 8)}`
}

export function LeftRail(props: LeftRailProps) {
  const {
    connectionStatus,
    bridgeUrl,
    onBridgeUrlChange,
    threads,
    activeThreadId,
    onSelectThread,
    onStartThread,
    onRefreshThreads,
  } = props

  return (
    <aside className="left-rail">
      <Card className="h-full gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-sm font-semibold">Formax App Server</h1>
          <Badge variant={statusVariant(connectionStatus)}>{connectionStatus}</Badge>
        </div>

        <Separator />

        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="bridge-url">Bridge URL</Label>
            <Input id="bridge-url" value={bridgeUrl} onChange={(event) => onBridgeUrlChange(event.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" onClick={onStartThread}>
              <Plus className="size-3.5" />
              New Thread
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onRefreshThreads}>
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <Separator />

        <div className="px-4 py-2 text-xs font-medium text-muted-foreground">Threads</div>
        <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
          <div className="space-y-1 px-1">
            {threads.length === 0 ? <div className="empty px-2 py-4">No threads yet.</div> : null}
            {threads.map((thread) => (
              <Button
                key={thread.id}
                type="button"
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start rounded-lg border px-3 py-2 text-left',
                  thread.id === activeThreadId
                    ? 'border-primary/35 bg-primary/10 hover:bg-primary/15'
                    : 'border-transparent hover:bg-muted',
                )}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="grid min-w-0 gap-0.5">
                  <div className="truncate text-sm font-medium">{threadTitle(thread)}</div>
                  <div className="truncate text-xs text-muted-foreground">{thread.id.slice(0, 8)}</div>
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </aside>
  )
}
